import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAY_RADIUS, terrainHeight } from './terrain.js';

const WALK_SPEED = 1.8;
const RUN_SPEED = 5.5;
const ACCELERATION = 10;
const JUMP_SPEED = 5.5;
const GRAVITY = 16;
const TURN_SPEED = 12;
const MODEL_URL = '/models/character.glb';
const MODEL_YAW_OFFSET = Math.PI; // the model is authored facing -Z

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.position = new THREE.Vector3(0, terrainHeight(0, 0), 0);
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.onGround = true;
    this.phase = 0; // shared 0..1 gait cycle so walk and run blend without foot sliding
    this.root = new THREE.Group();
    scene.add(this.root);
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const model = gltf.scene;
    model.rotation.y = MODEL_YAW_OFFSET;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds don't follow the animation
      }
    });
    this.root.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((a) => a.name === name);
    this.actions = {
      idle: this.mixer.clipAction(clip('Idle')),
      walk: this.mixer.clipAction(clip('Walk')),
      run: this.mixer.clipAction(clip('Run')),
    };
    for (const action of Object.values(this.actions)) {
      action.play();
      action.setEffectiveWeight(0);
    }
    // Walk/run are driven by our own gait phase; idle plays at normal speed.
    this.actions.walk.timeScale = 0;
    this.actions.run.timeScale = 0;
    this.actions.idle.setEffectiveWeight(1);
  }

  // How "on the grass" the player is, 0..1 — used to bend grass under their feet.
  get groundedAmount() {
    const above = this.position.y - terrainHeight(this.position.x, this.position.z);
    return THREE.MathUtils.clamp(1 - above / 0.8, 0, 1);
  }

  update(dt, input, cameraYaw) {
    // Movement relative to where the camera looks.
    const forward = new THREE.Vector2(-Math.sin(cameraYaw), -Math.cos(cameraYaw));
    const right = new THREE.Vector2(-forward.y, forward.x);
    const move = new THREE.Vector2()
      .addScaledVector(forward, input.forward)
      .addScaledVector(right, input.right);
    if (move.lengthSq() > 1) move.normalize();

    const targetSpeed = input.run ? RUN_SPEED : WALK_SPEED;
    const control = this.onGround ? 1 : 0.35;
    const k = 1 - Math.exp(-ACCELERATION * control * dt);
    this.velocity.x += (move.x * targetSpeed - this.velocity.x) * k;
    this.velocity.z += (move.y * targetSpeed - this.velocity.z) * k;

    if (this.onGround && input.jump) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }
    this.velocity.y -= GRAVITY * dt;

    this.position.addScaledVector(this.velocity, dt);

    // Keep the player inside the meadow.
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > PLAY_RADIUS) {
      this.position.x *= PLAY_RADIUS / r;
      this.position.z *= PLAY_RADIUS / r;
    }

    const ground = terrainHeight(this.position.x, this.position.z);
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.position.y - ground < 0.3 && this.velocity.y <= 0) {
      this.position.y = ground; // stick to the slope when walking downhill
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }

    // Turn to face the direction of travel.
    if (move.lengthSq() > 0.01) {
      const target = Math.atan2(move.x, move.y);
      let delta = target - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.facing += delta * (1 - Math.exp(-TURN_SPEED * dt));
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;
    if (this.mixer) this.animate(dt, Math.hypot(this.velocity.x, this.velocity.z));
  }

  // Blend idle -> walk -> run by speed, keeping both gaits on the same step cycle.
  animate(dt, speed) {
    const { idle, walk, run } = this.actions;
    const walkDur = walk.getClip().duration;
    const runDur = run.getClip().duration;

    let wIdle, wWalk, wRun;
    if (speed <= WALK_SPEED) {
      wWalk = speed / WALK_SPEED;
      wIdle = 1 - wWalk;
      wRun = 0;
    } else {
      wRun = Math.min((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 1);
      wWalk = 1 - wRun;
      wIdle = 0;
    }
    // In the air, freeze mid-stride rather than keep pedalling.
    const cycleRate = this.onGround
      ? THREE.MathUtils.lerp(1 / walkDur, 1 / runDur, wRun) * Math.max(speed / THREE.MathUtils.lerp(WALK_SPEED, RUN_SPEED, wRun), 0.3)
      : 0;
    this.phase = (this.phase + cycleRate * dt) % 1;

    walk.time = this.phase * walkDur;
    run.time = this.phase * runDur;
    idle.setEffectiveWeight(wIdle);
    walk.setEffectiveWeight(wWalk);
    run.setEffectiveWeight(wRun);
    this.mixer.update(dt);
  }
}

// Keyboard + mouse input. Click the canvas to lock the pointer for mouse look.
export class Input {
  constructor(element) {
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    element.addEventListener('click', () => element.requestPointerLock?.());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    element.addEventListener(
      'wheel',
      (e) => {
        this.zoom += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  get forward() {
    return (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
  }
  get right() {
    return (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
  }
  get run() {
    return this.has('ShiftLeft', 'ShiftRight');
  }
  get jump() {
    return this.has('Space');
  }
  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  consumeLook() {
    const look = { x: this.lookX, y: this.lookY, zoom: this.zoom };
    this.lookX = this.lookY = this.zoom = 0;
    return look;
  }
}

// Third-person camera that orbits behind the player.
export class FollowCamera {
  constructor(camera, yaw = 0) {
    this.camera = camera;
    this.yaw = yaw;
    this.pitch = 0.25;
    this.distance = 5;
    this.targetDistance = 5;
    this.target = new THREE.Vector3();
    this.initialized = false;
  }

  update(dt, look, playerPos) {
    this.yaw -= look.x * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * 0.0025, -0.35, 1.2);
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + look.zoom * 0.6, 2.2, 12);
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-8 * dt));

    const desiredTarget = playerPos.clone().add(new THREE.Vector3(0, 1.6, 0));
    if (!this.initialized) {
      this.target.copy(desiredTarget);
      this.initialized = true;
    }
    this.target.lerp(desiredTarget, 1 - Math.exp(-12 * dt));

    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    const pos = this.target.clone().add(offset);

    // Don't let the camera dip under the hills.
    const minY = terrainHeight(pos.x, pos.z) + 0.4;
    if (pos.y < minY) pos.y = minY;

    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
