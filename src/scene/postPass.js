import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Son görüntü geçişi: kenarlarda hafif renk kayması (kromatik sapma), vinyet,
// film greni, ince tarama çizgileri ve ara sıra geçen yatay parazit bandı.
// Tek bir tam ekran geçişi olduğu için ucuz.
const PostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0018 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.55 },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uGlitch;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;

      // Parazit bandı: ekranda yavaşça aşağı inen ince yatay şerit, içinde hafif kayma
      float bandY = fract(uTime * 0.07);
      float band = exp(-pow((uv.y - (1.0 - bandY)) * 60.0, 2.0));
      uv.x += band * 0.0025 * sin(uTime * 40.0) + uGlitch * 0.01 * sin(uv.y * 300.0 + uTime * 50.0);

      // Kromatik sapma: merkezden uzaklaştıkça kırmızı ve mavi kanallar hafif ayrışır
      vec2 shift = fromCenter * uAberration * (1.0 + dot(fromCenter, fromCenter) * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + shift).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - shift).b;

      // İnce tarama çizgileri (ekran pikseline bağlı)
      float scan = 0.96 + 0.04 * sin(gl_FragCoord.y * 3.14159);
      col *= scan;
      col += vec3(0.05, 0.25, 0.32) * band * 0.08;

      // Vinyet
      float vig = smoothstep(0.85, 0.2, length(fromCenter * vec2(1.1, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, vig);

      // Gren
      float g = hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostPass() {
  return new ShaderPass(PostShader);
}
