import * as THREE from 'three';
import { HOLO_CYAN } from './hologramMaterial.js';

const ringVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSegments;
  varying vec2 vUv;
  void main() {
    // UV'yi merkeze göre açıya çevirip kesikli halka deseni üretiyoruz
    vec2 p = vUv - 0.5;
    float angle = atan(p.y, p.x) / 6.28318 + 0.5;
    float dash = step(0.35, fract(angle * uSegments + uTime * 0.15));
    float r = length(p) * 2.0;
    float edge = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.96, 1.0, r));
    float alpha = edge * (0.25 + 0.75 * dash);
    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`;

// Modelin altında dönen hologram halkaları + polar ızgara
export function createHologramRing(radius = 0.75) {
  const group = new THREE.Group();

  const makeRing = (r, segments, speed) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: HOLO_CYAN.clone() },
        uSegments: { value: segments },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.speed = speed;
    group.add(mesh);
    return mesh;
  };

  const rings = [
    makeRing(radius, 24, 0.5),
    makeRing(radius * 1.25, 8, -0.25),
    makeRing(radius * 0.55, 48, 1.2),
  ];

  const grid = new THREE.PolarGridHelper(radius * 1.6, 16, 6, 64, HOLO_CYAN, HOLO_CYAN);
  grid.material.transparent = true;
  grid.material.opacity = 0.08;
  grid.material.blending = THREE.AdditiveBlending;
  grid.material.depthWrite = false;
  group.add(grid);

  return {
    group,
    update(dt) {
      for (const ring of rings) {
        ring.rotation.z += dt * ring.userData.speed;
        ring.material.uniforms.uTime.value += dt;
      }
    },
  };
}
