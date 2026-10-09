import * as THREE from 'three';

// Soft pastel gradient sky with a glowing low sun.
export function createSky({ sunDir, horizonColor }) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uHorizon: { value: horizonColor },
      uMid: { value: new THREE.Color('#e7b7d4') },
      uZenith: { value: new THREE.Color('#8faee6') },
      uSunColor: { value: new THREE.Color('#fff1d6') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uHorizon;
      uniform vec3 uMid;
      uniform vec3 uZenith;
      uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
        col = mix(col, uZenith, smoothstep(0.2, 0.75, h));
        col = mix(col, uHorizon, smoothstep(0.0, -0.2, h)); // below horizon fades into haze

        float s = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(s, 8.0) * 0.2;    // wide glow
        col += uSunColor * pow(s, 64.0) * 0.8;   // halo
        col += uSunColor * smoothstep(0.9993, 0.9997, s) * 6.0; // disc (blooms)
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
