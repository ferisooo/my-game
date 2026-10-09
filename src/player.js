import * as THREE from 'three';
import { PLAY_RADIUS, terrainHeight } from './terrain.js';

const WALK_SPEED = 3.2;
const RUN_SPEED = 7.0;
const ACCELERATION = 10;
const JUMP_SPEED = 5.5;
const GRAVITY = 16;
const TURN_SPEED = 12;

// A simple stylised character built from primitives. Feet sit at the root's origin.
function buildCharacter() {
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const skin = mat('#f1c7a5');
  const tunic = mat('#f6f0e6');
  const pants = mat('#6b7fa8');
  const hair = mat('#4a3328');
  const scarf = mat('#f08aa0');
  const dark = mat('#2b2230');

  const root = new THREE.Group();
  const rig = new THREE.Group(); // bobs while walking
  root.add(rig);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 16), tunic);
  torso.position.y = 1.2;
  rig.add(torso);

  const neckScarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.06, 10, 20), scarf);
  neckScarf.rotation.x = Math.PI / 2;
  neckScarf.position.y = 1.6;
  rig.add(neckScarf);

  const head = new THREE.Group();
  head.position.y = 1.83;
  rig.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin));
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hair,
  );
  hairCap.rotation.x = -0.35;
  head.add(hairCap);
  for (const x of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), dark);
    eye.position.set(x, 0.0, 0.185);
    head.add(eye);
  }

  const limb = (radius, length, material, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
    mesh.position.y = -(length / 2 + radius);
    pivot.add(mesh);
    rig.add(pivot);
    return pivot;
  };
  const legL = limb(0.09, 0.62, pants, -0.12, 0.88);
  const legR = limb(0.09, 0.62, pants, 0.12, 0.88);
  const armL = limb(0.07, 0.48, tunic, -0.33, 1.52);
  const armR = limb(0.07, 0.48, tunic, 0.33, 1.52);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  return { root, rig, head, legL, legR, armL, armR };
}

export class Player {
  constructor(scene) {
    this.position = new THREE.Vector3(0, terrainHeight(0, 0), 0);
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.onGround = true;
    this.walkPhase = 0;
    this.character = buildCharacter();
    scene.add(this.character.root);
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
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (move.lengthSq() > 0.01) {
      const target = Math.atan2(move.x, move.y);
      let delta = target - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.facing += delta * (1 - Math.exp(-TURN_SPEED * dt));
    }

    this.animate(dt, horizontalSpeed);
  }

  animate(dt, speed) {
    const c = this.character;
    c.root.position.copy(this.position);
    c.root.rotation.y = this.facing;

    const stride = THREE.MathUtils.clamp(speed / RUN_SPEED, 0, 1);
    this.walkPhase += dt * (4 + speed * 1.6) * (speed > 0.1 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * (0.25 + stride * 0.6) * Math.min(speed / 1.5, 1);

    if (this.onGround) {
      c.legL.rotation.x = swing;
      c.legR.rotation.x = -swing;
      c.armL.rotation.x = -swing * 0.8;
      c.armR.rotation.x = swing * 0.8;
      c.rig.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * Math.min(speed / 2, 1);
    } else {
      // Tuck legs and lift arms in the air.
      c.legL.rotation.x = THREE.MathUtils.lerp(c.legL.rotation.x, 0.6, 0.15);
      c.legR.rotation.x = THREE.MathUtils.lerp(c.legR.rotation.x, -0.2, 0.15);
      c.armL.rotation.x = THREE.MathUtils.lerp(c.armL.rotation.x, -1.2, 0.15);
      c.armR.rotation.x = THREE.MathUtils.lerp(c.armR.rotation.x, -1.2, 0.15);
      c.rig.position.y = 0;
    }
    c.armL.rotation.z = -0.08;
    c.armR.rotation.z = 0.08;
    c.rig.rotation.x = stride * 0.12; // lean into a run
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
