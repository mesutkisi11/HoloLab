import * as THREE from 'three';

// Tüm hologram malzemelerinin paylaştığı zaman değeri (tarama çizgisi animasyonu için)
export const sharedTime = { value: 0 };
// Final parlama dalgasının y konumu (-100 = kapalı)
export const sharedWave = { value: -100 };

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
  uniform float uWave;

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
    float alpha = (0.05 + fresnel * 0.5) * uOpacity * scan;
    vec3 rgb = color * (0.3 + fresnel * 0.5 + uHighlight * 0.6 + uFlash * 2.0);

    // Final dalgası: uWave yüksekliğinden geçen ince parlak bant
    float wave = exp(-pow((vWorldPos.y - uWave) * 14.0, 2.0));
    rgb += color * wave * 1.5;
    alpha += wave * 0.5;

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
      uWave: sharedWave,
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
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// Tel kafes hayalet (birleşmiş halin silik izi)
export function createGhostMaterial() {
  return new THREE.LineBasicMaterial({
    color: HOLO_CYAN,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
