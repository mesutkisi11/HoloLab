import * as THREE from 'three';

// Hologram renkleri ve tüm hologram malzemelerinin paylaştığı değerler.
// Paylaşılan değer = tek bir { value } nesnesi; değiştirince bütün parçalar aynı anda etkilenir.

export const HOLO_CYAN = new THREE.Color('#29d3ff');
export const HOLO_LINE = new THREE.Color('#86ecff');
export const HOLO_ORANGE = new THREE.Color('#ffae3d');
export const HOLO_RED = new THREE.Color('#ff4d3a');

export const sharedTime = { value: 0 };
// Final parlama dalgasının y konumu (-100 = kapalı)
export const sharedWave = { value: -100 };
// Modelin içinden geçen tarama ışığının y konumu
export const sharedScan = { value: -100 };
// Kameranın baktığı noktaya uzaklığı: daha uzaktaki parçalar daha sönük görünür
export const sharedFocus = { value: 1.5 };

// --- Yüzey (silik cam + kenar parlaması + altıgen mikro desen) ---
const surfaceVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying float vDepth;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vObjPos;
  varying vec3 vObjNormal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    // Desen parçaya yapışık kalsın diye nesne uzayı (ölçekli) kullanılır
    vec3 s = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    vObjPos = position * s;
    vObjNormal = normal;
    vec4 mv = viewMatrix * worldPos;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHighlightColor;
  uniform float uHighlight;
  uniform float uFlash;
  uniform float uOpacity;
  uniform float uModelOpacity;
  uniform float uTime;
  uniform float uWave;
  uniform float uScan;
  uniform float uReveal;
  uniform float uFocusDist;
  uniform float uSeed;
  uniform float uPattern;

  varying vec3 vWorldPos;
  varying float vDepth;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vObjPos;
  varying vec3 vObjNormal;

  // Altıgen ızgara çizgisi: 1 = çizgi üstü, 0 = hücre içi (fwidth ile kenar yumuşatmalı)
  float hexLine(vec2 p) {
    const vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(g);
    float d = 0.5 - max(dot(q, normalize(r)), q.x);
    float w = fwidth(d) * 1.5;
    return 1.0 - smoothstep(0.0, w + 0.015, d);
  }

  void main() {
    // Belirme efekti: uReveal yüksekliğinin üstü henüz "basılmadı"
    float above = vWorldPos.y - uReveal;
    if (above > 0.0) discard;
    float revealBand = smoothstep(-0.05, 0.0, above);

    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float fresnel = pow(1.0 - abs(dot(n, v)), 2.6);

    // Baskın eksene göre düzlem seç, altıgen deseni o düzleme çiz
    vec3 an = abs(vObjNormal);
    vec2 plane = an.y > an.x && an.y > an.z ? vObjPos.xz : (an.x > an.z ? vObjPos.yz : vObjPos.xy);
    float hex = hexLine(plane / 0.016) * uPattern;

    float scan = exp(-pow((vWorldPos.y - uScan) * 55.0, 2.0));
    float wave = exp(-pow((vWorldPos.y - uWave) * 14.0, 2.0));
    float flick = 0.94 + 0.06 * sin(uTime * (9.0 + uSeed * 6.0) + uSeed * 31.0);
    float depthFade = clamp(1.0 - (vDepth - uFocusDist) * 0.8, 0.35, 1.0);

    vec3 base = mix(uColor, uHighlightColor, uHighlight);
    float alpha = 0.018 + fresnel * 0.24 + hex * 0.055 + scan * 0.2 + wave * 0.3 + revealBand * 0.5;
    alpha += uHighlight * 0.05 + uFlash * 0.3;
    alpha *= uOpacity * uModelOpacity * flick * depthFade;

    vec3 rgb = base * (0.6 + fresnel * 0.8 + hex * 0.5 + uHighlight * 0.35 + uFlash * 1.4);
    rgb += mix(base, vec3(0.9, 1.0, 1.0), 0.5) * (scan * 0.9 + revealBand * 1.6 + wave * 0.9);

    gl_FragColor = vec4(rgb, alpha);
  }
`;

// --- Çizgi (teknik çizim kenarları: hologramın asıl "taslak" görüntüsü) ---
const lineVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying float vDepth;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mv = viewMatrix * worldPos;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHighlightColor;
  uniform float uHighlight;
  uniform float uFlash;
  uniform float uOpacity;
  uniform float uModelOpacity;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uWave;
  uniform float uScan;
  uniform float uReveal;
  uniform float uFocusDist;
  uniform float uSeed;

  varying vec3 vWorldPos;
  varying float vDepth;

  void main() {
    float above = vWorldPos.y - uReveal;
    if (above > 0.0) discard;
    float revealBand = smoothstep(-0.06, 0.0, above);

    float scan = exp(-pow((vWorldPos.y - uScan) * 45.0, 2.0));
    float wave = exp(-pow((vWorldPos.y - uWave) * 14.0, 2.0));
    float flick = 0.95 + 0.05 * sin(uTime * (11.0 + uSeed * 5.0) + uSeed * 17.0);
    float depthFade = clamp(1.0 - (vDepth - uFocusDist) * 0.8, 0.3, 1.0);

    vec3 base = mix(uColor, uHighlightColor, uHighlight);
    float a = uIntensity + uHighlight * 0.3 + uFlash * 0.7 + scan * 0.8 + revealBand * 1.1 + wave * 0.6;
    a *= uOpacity * uModelOpacity * depthFade * flick;
    vec3 rgb = base * (1.0 + scan * 0.6 + revealBand * 0.8);
    gl_FragColor = vec4(rgb, a);
  }
`;

const blendSettings = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
};

function baseUniforms(color, highlightColor) {
  return {
    uColor: { value: color.clone() },
    uHighlightColor: { value: highlightColor.clone() },
    uHighlight: { value: 0 },
    uFlash: { value: 0 },
    uOpacity: { value: 1 },
    uModelOpacity: { value: 1 },
    uReveal: { value: 1000 },
    uSeed: { value: Math.random() },
    uTime: sharedTime,
    uWave: sharedWave,
    uScan: sharedScan,
    uFocusDist: sharedFocus,
  };
}

// Her parça kendi malzemesini alır; böylece tek tek vurgulanabilir.
// Program (derlenmiş shader) yine de tüm parçalar arasında paylaşılır.
export function createHologramMaterial(color = HOLO_CYAN) {
  return new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: { ...baseUniforms(color, HOLO_ORANGE), uPattern: { value: 1 } },
    side: THREE.FrontSide,
    ...blendSettings,
  });
}

export function createEdgeMaterial(color = HOLO_LINE, intensity = 0.55) {
  return new THREE.ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: { ...baseUniforms(color, HOLO_ORANGE), uIntensity: { value: intensity } },
    ...blendSettings,
  });
}

// Tel kafes hayalet (birleşmiş halin silik izi): aynı çizgi shader'ı, çok düşük yoğunlukta
export function createGhostMaterial() {
  return createEdgeMaterial(HOLO_CYAN, 0.085);
}

// Yumuşak parlayan daire dokusu (parçacıklar ve imleçler için)
let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}
