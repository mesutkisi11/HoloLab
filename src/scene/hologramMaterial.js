import * as THREE from 'three';

// Tüm hologram malzemelerinin paylaştığı zaman değeri (tarama çizgisi animasyonu için)
export const sharedTime = { value: 0 };

export const HOLO_CYAN = new THREE.Color('#38e8ff');
export const HOLO_ORANGE = new THREE.Color('#ffb347');
export const HOLO_RED = new THREE.Color('#ff5a3c');

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHighlightColor;
  uniform float uHighlight;
  uniform float uFlash;
  uniform float uOpacity;
  uniform float uTime;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);

    // Fresnel: yüzey kameraya ne kadar yan bakıyorsa o kadar parlar (kenar parlaması)
    float fresnel = pow(1.0 - abs(dot(n, v)), 2.2);

    // Yukarı doğru akan ince tarama çizgileri
    float scan = 0.85 + 0.15 * sin(vWorldPos.y * 90.0 - uTime * 4.0);

    vec3 color = mix(uColor, uHighlightColor, uHighlight);
    float alpha = (0.10 + fresnel * 0.9) * uOpacity * scan;
    vec3 rgb = color * (0.55 + fresnel * 1.6 + uHighlight * 0.9 + uFlash * 2.5);

    gl_FragColor = vec4(rgb, alpha);
  }
`;

// Her parça kendi malzemesini alır; böylece tek tek vurgulanabilir
export function createHologramMaterial(color = HOLO_CYAN) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: color.clone() },
      uHighlightColor: { value: HOLO_ORANGE.clone() },
      uHighlight: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 1 },
      uTime: sharedTime,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

// Parça kenarlarına ince çizgi: hologramın "çizim" hissi
export function createEdgeMaterial(color = HOLO_CYAN) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// Tel kafes hayalet (birleşmiş halin silik izi)
export function createGhostMaterial() {
  return new THREE.MeshBasicMaterial({
    color: HOLO_CYAN,
    wireframe: true,
    transparent: true,
    opacity: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
