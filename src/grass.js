import * as THREE from 'three';
import { FIELD_SIZE, terrainHeight } from './terrain.js';
import { fbm, mulberry32, smoothstep } from './noise.js';

// The field is split into square chunks so the GPU can skip chunks behind the camera,
// and far chunks draw fewer, simpler blades.
const CHUNK_SIZE = 8;
const BLADES_PER_M2 = 64;
const HIGH_LOD_DISTANCE = 30;

// Fraction of blades kept at a given distance. Must match keepFraction() in the shader.
const KEEP_NEAR = 12;
const KEEP_FAR = 70;
const KEEP_MIN = 0.18;
function keepFraction(dist) {
  return 1 - (1 - KEEP_MIN) * smoothstep(KEEP_NEAR, KEEP_FAR, dist);
}

// A single blade: pairs of vertices up the height, ending in a pointed tip.
// position.x = side (-1..1), position.y = height along blade (0..1).
function makeBladeGeometry(segments) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    positions.push(-1, t, 0, 1, t, 0);
  }
  positions.push(0, 1, 0);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, last + 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPlayerPos;
  uniform float uPlayerGrounded;
  uniform vec2 uWindDir;

  attribute vec4 aOffset; // xyz = root position, w = draw order (0..1, random)
  attribute vec4 aParams; // x = yaw, y = height, z = lean, w = random

  varying float vT;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vRand;
  varying float vGust;
  varying float vPatch;
  varying float vShadow;
  varying float vViewDepth;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float keepFraction(float dist) {
    return 1.0 - (1.0 - ${KEEP_MIN.toFixed(3)}) * smoothstep(${KEEP_NEAR.toFixed(1)}, ${KEEP_FAR.toFixed(1)}, dist);
  }

  void main() {
    vec3 root = aOffset.xyz;
    float order = aOffset.w;
    float yaw = aParams.x;
    float height = aParams.y;
    float lean = aParams.z;
    float rnd = aParams.w;
    float side = position.x;
    float t = position.y;

    // Thin out distant blades smoothly (no popping) and widen the survivors to fill the gaps.
    float dist = distance(root.xz, cameraPosition.xz);
    float keep = keepFraction(dist);
    height *= 1.0 - smoothstep(keep - 0.05, keep, order);
    float width = 0.045 * (0.8 + rnd * 0.4) * mix(1.0, 2.2, smoothstep(${KEEP_NEAR.toFixed(1)}, ${KEEP_FAR.toFixed(1)}, dist));
    width *= mix(1.0, 0.35, t);

    vec3 facing = vec3(sin(yaw), 0.0, cos(yaw));
    vec3 sideDir = vec3(cos(yaw), 0.0, -sin(yaw));

    // Wind: large rolling gusts plus a small per-blade flutter.
    float gust = vnoise(root.xz * 0.05 - uWindDir * uTime * 0.6);
    gust = smoothstep(0.25, 0.85, gust);
    float flutter = sin(uTime * 2.4 + rnd * 6.2831 + root.x * 0.7 + root.z * 0.3) * 0.07;
    vec2 bend = facing.xz * lean + uWindDir * (0.15 + gust * 0.85 + flutter);

    // Push blades away from the player's feet.
    vec2 away = root.xz - uPlayerPos.xz;
    float awayLen = length(away);
    float push = (1.0 - smoothstep(0.15, 1.1, awayLen)) * uPlayerGrounded;
    bend += (away / max(awayLen, 0.001)) * push * 2.2;

    // Curve the blade along a parabola while roughly preserving its length.
    vec2 b = bend / (1.0 + length(bend) * 0.45);
    float bb = dot(b, b);
    vec2 horiz = b * height * t * t;
    float vert = height * t * sqrt(max(0.08, 1.0 - bb * t * t * 0.55));

    vec3 pos = root + sideDir * side * width + vec3(horiz.x, vert, horiz.y);

    // Normal from the curved blade, rounded across its width so it doesn't look flat.
    vec3 tangent = normalize(vec3(2.0 * b.x * t, 1.0, 2.0 * b.y * t));
    vec3 normal = normalize(cross(sideDir, tangent));
    normal = normalize(normal + sideDir * side * 0.45);

    vT = t;
    vNormal = normal;
    vWorldPos = pos;
    vRand = rnd;
    vGust = gust;
    vPatch = vnoise(root.xz * 0.035);
    // Soft blob shadow under the player that fades as they jump.
    float shadow = mix(0.45, 1.0, smoothstep(0.15, 0.8, awayLen));
    vShadow = mix(shadow, 1.0, clamp((uPlayerPos.y - root.y) / 3.0, 0.0, 1.0));

    vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
    vViewDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform vec3 uTipColorAlt;
  uniform vec3 uTipColorWarm;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying float vT;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vRand;
  varying float vGust;
  varying float vPatch;
  varying float vShadow;
  varying float vViewDepth;

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Colour: dark at the root, bright at the tip, varying per blade and per patch.
    vec3 tip = mix(uTipColor, uTipColorAlt, smoothstep(0.3, 0.8, vPatch));
    tip = mix(tip, uTipColorWarm, smoothstep(0.75, 1.0, vRand) * 0.8);
    vec3 albedo = mix(uBaseColor, tip, smoothstep(0.0, 1.0, vT));
    albedo *= 0.85 + vRand * 0.3;

    // Lighting: wrapped diffuse, soft sky fill, and sunlight glowing through the blades.
    float diffuse = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float ao = mix(0.25, 1.0, pow(vT, 0.8));
    float backlit = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
    vec3 translucency = uSunColor * tip * backlit * vT * vT * 0.8;
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 24.0) * 0.25 * vT;

    vec3 color = albedo * (uSkyColor * 0.45 + uSunColor * diffuse * 0.8) * ao;
    color += translucency + uSunColor * spec;
    color += tip * vGust * vT * 0.12; // gusts flip the blades and catch the light
    color *= vShadow;

    // Dreamy haze, matching FogExp2 on the rest of the scene.
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    color = mix(color, uFogColor, fog);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createGrass({ sunDir, sunColor, skyColor, fog }) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
      uPlayerGrounded: { value: 1 },
      uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
      uBaseColor: { value: new THREE.Color('#12331f') },
      uTipColor: { value: new THREE.Color('#9fdc78') },
      uTipColorAlt: { value: new THREE.Color('#6fcf9a') },
      uTipColorWarm: { value: new THREE.Color('#f2dc8a') },
      uSunDir: { value: sunDir },
      uSunColor: { value: sunColor },
      uSkyColor: { value: skyColor },
      uFogColor: { value: fog.color },
      uFogDensity: { value: fog.density },
    },
  });

  const highTemplate = makeBladeGeometry(6);
  const lowTemplate = makeBladeGeometry(2);

  const group = new THREE.Group();
  const chunks = [];
  const rand = mulberry32(1337);
  const perChunk = Math.round(CHUNK_SIZE * CHUNK_SIZE * BLADES_PER_M2);
  const half = FIELD_SIZE / 2;

  for (let cz = -half; cz < half; cz += CHUNK_SIZE) {
    for (let cx = -half; cx < half; cx += CHUNK_SIZE) {
      const offsets = new Float32Array(perChunk * 4);
      const params = new Float32Array(perChunk * 4);
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < perChunk; i++) {
        const x = cx + rand() * CHUNK_SIZE;
        const z = cz + rand() * CHUNK_SIZE;
        const y = terrainHeight(x, z) - 0.03;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        // Clumps of taller grass so the field isn't uniform.
        const patch = fbm(x * 0.08 + 31, z * 0.08 - 17, 3);
        const height = (0.3 + patch * 0.65) * (0.65 + rand() * 0.7);

        offsets[i * 4] = x;
        offsets[i * 4 + 1] = y;
        offsets[i * 4 + 2] = z;
        offsets[i * 4 + 3] = i / perChunk; // positions are random, so index order is a random subset

        params[i * 4] = rand() * Math.PI * 2;
        params[i * 4 + 1] = height;
        params[i * 4 + 2] = 0.1 + rand() * 0.45;
        params[i * 4 + 3] = rand();
      }

      const offsetAttr = new THREE.InstancedBufferAttribute(offsets, 4);
      const paramsAttr = new THREE.InstancedBufferAttribute(params, 4);
      const center = new THREE.Vector3(cx + CHUNK_SIZE / 2, (minY + maxY) / 2, cz + CHUNK_SIZE / 2);
      const radius = Math.hypot(CHUNK_SIZE / 2, CHUNK_SIZE / 2, (maxY - minY) / 2 + 1.5);

      const makeMesh = (template) => {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = template.index;
        geometry.setAttribute('position', template.attributes.position);
        geometry.setAttribute('aOffset', offsetAttr);
        geometry.setAttribute('aParams', paramsAttr);
        geometry.instanceCount = perChunk;
        geometry.boundingSphere = new THREE.Sphere(center, radius);
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
        return mesh;
      };

      chunks.push({ center, high: makeMesh(highTemplate), low: makeMesh(lowTemplate) });
    }
  }

  const chunkHalfDiagonal = Math.SQRT2 * CHUNK_SIZE * 0.5;

  function update(time, camera, playerPos, grounded) {
    material.uniforms.uTime.value = time;
    material.uniforms.uPlayerPos.value.copy(playerPos);
    material.uniforms.uPlayerGrounded.value = grounded;

    for (const chunk of chunks) {
      const dist = Math.hypot(chunk.center.x - camera.position.x, chunk.center.z - camera.position.z);
      const nearest = Math.max(0, dist - chunkHalfDiagonal);
      const count = Math.min(perChunk, Math.ceil(perChunk * keepFraction(nearest)) + 1);
      const useHigh = nearest < HIGH_LOD_DISTANCE;
      chunk.high.visible = useHigh;
      chunk.low.visible = !useHigh;
      (useHigh ? chunk.high : chunk.low).geometry.instanceCount = count;
    }
  }

  return { mesh: group, update, bladeCount: chunks.length * perChunk };
}
