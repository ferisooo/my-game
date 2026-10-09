import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createTerrain } from './terrain.js';
import { createGrass } from './grass.js';
import { createSky } from './sky.js';
import { createPollen } from './particles.js';
import { Player, Input, FollowCamera } from './player.js';

// --- Renderer -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

// --- Dreamy golden-hour mood --------------------------------------------------
// Low sun in front of the starting view so the grass glows with backlight.
const sunDir = new THREE.Vector3(-0.55, 0.2, -0.8).normalize();
const sunColor = new THREE.Color('#ffd7a3').multiplyScalar(1.7);
const skyColor = new THREE.Color('#b9c2ef');
const horizonColor = new THREE.Color('#f6cbbd');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(horizonColor.clone(), 0.011);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);

scene.add(new THREE.HemisphereLight(skyColor, new THREE.Color('#3d5a35'), 1.1));
const sun = new THREE.DirectionalLight(sunColor, 1.6);
sun.position.copy(sunDir).multiplyScalar(50);
scene.add(sun);

// --- World --------------------------------------------------------------------
scene.add(createSky({ sunDir, horizonColor }));
scene.add(createTerrain());
const grass = createGrass({ sunDir, sunColor, skyColor, fog: scene.fog });
scene.add(grass.mesh);
const pollen = createPollen();
scene.add(pollen.mesh);

// --- Player -------------------------------------------------------------------
const player = new Player(scene);
const input = new Input(renderer.domElement);
const followCam = new FollowCamera(camera, Math.atan2(-sunDir.x, -sunDir.z));
player.facing = followCam.yaw + Math.PI; // start facing away from the camera, toward the sun

const overlay = document.getElementById('overlay');
input.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

// --- Post-processing: soft bloom + warm vignette ------------------------------
const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, renderTarget);
composer.setPixelRatio(pixelRatio);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.7, 0.95);
composer.addPass(bloom);
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float d = distance(vUv, vec2(0.5));
        c.rgb *= mix(1.0, 0.72, smoothstep(0.35, 0.85, d)); // vignette
        c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 0.98, 1.02), 0.6); // gentle pink-warm grade
        gl_FragColor = c;
      }
    `,
  }),
);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop ---------------------------------------------------------------------
const timer = new THREE.Timer();

await player.load();
document.getElementById('loading').style.opacity = '0';
setTimeout(() => document.getElementById('loading').remove(), 900);

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  const time = timer.getElapsed();

  player.update(dt, input, followCam.yaw);
  followCam.update(dt, input.consumeLook(), player.position);
  grass.update(time, camera, player.position, player.groundedAmount);
  pollen.update(time, player.position, pixelRatio);

  composer.render();
});

console.log(`Meadow: ${grass.bladeCount.toLocaleString()} grass blades`);
