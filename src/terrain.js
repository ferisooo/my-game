import * as THREE from 'three';
import { fbm, smoothstep } from './noise.js';

export const FIELD_SIZE = 160; // grass covers a square this wide (metres)
export const PLAY_RADIUS = 70; // how far from the centre the player may walk

// Gentle rolling hills, flatter around spawn, rising into a soft bowl past the meadow.
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const hills = (fbm(x * 0.012 + 10, z * 0.012 - 4, 4) - 0.5) * 14;
  const detail = (fbm(x * 0.06, z * 0.06, 2) - 0.5) * 1.0;
  const spawnFlatten = 0.35 + 0.65 * smoothstep(4, 35, r);
  const bowl = smoothstep(75, 160, r) * 18;
  return hills * spawnFlatten + detail + bowl;
}

export function createTerrain() {
  const size = 600;
  const segments = 400;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const under = new THREE.Color('#1f3f26'); // soil/moss hidden under the grass
  const outer = new THREE.Color('#6f9a6a'); // hazy hills beyond the meadow
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const edge = smoothstep(70, 110, Math.max(Math.abs(x), Math.abs(z)));
    const patch = fbm(x * 0.04, z * 0.04, 2);
    tmp.copy(under).lerp(outer, edge).multiplyScalar(0.8 + patch * 0.4);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geometry, material);
}
