import * as THREE from 'three';

// Glowing pollen motes drifting around the player. They live in a box that wraps
// around the player, so there are always some nearby.
export function createPollen(count = 1800, boxSize = 40) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * boxSize;
    positions[i * 3 + 1] = Math.random();
    positions[i * 3 + 2] = Math.random() * boxSize;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: boxSize },
      uColor: { value: new THREE.Color('#ffe7b0') },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uBox;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.xz += vec2(sin(uTime * 0.3 + aSeed * 40.0), cos(uTime * 0.25 + aSeed * 30.0)) * 0.8;
        p.xz += vec2(0.8, 0.6) * uTime * 0.4; // drift with the wind
        p.xz = mod(p.xz - uCenter.xz + uBox * 0.5, uBox) - uBox * 0.5 + uCenter.xz;
        p.y = uCenter.y + 0.2 + position.y * 4.0 + sin(uTime * 0.6 + aSeed * 20.0) * 0.4;

        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 50.0);
        vec2 edge = abs(p.xz - uCenter.xz) / (uBox * 0.5);
        vAlpha = twinkle * (1.0 - smoothstep(0.7, 1.0, max(edge.x, edge.y)));
        gl_PointSize = (2.0 + aSeed * 3.0) * uPixelRatio * (12.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor * 2.5, a * a * vAlpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    mesh: points,
    update(time, center, pixelRatio) {
      material.uniforms.uTime.value = time;
      material.uniforms.uCenter.value.copy(center);
      material.uniforms.uPixelRatio.value = pixelRatio;
    },
  };
}
