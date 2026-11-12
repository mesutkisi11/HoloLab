import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sharedTime } from './hologramMaterial.js';

// Renderer + kamera + bloom efekti. Tüm uygulama bu sahneyi kullanır.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  // Orta seviye laptopta akıcı kalsın diye piksel oranını sınırlıyoruz
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02060c');

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(1.1, 0.7, 1.3);
  camera.lookAt(0, 0.05, 0);

  // Bloom: parlak yerlerin etrafına ışık taşması. Hologram hissinin yarısı budur.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 4, window.innerHeight / 4),
    0.45, // güç
    0.4, // yarıçap
    0.35, // eşik: bundan parlak pikseller taşar
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  const updaters = new Set();

  // Otomatik performans modu: kareler uzun sürerse bloom kapanır
  let slowFrames = 0;
  let lowQuality = false;
  const qualityListeners = new Set();
  function watchPerformance(dt) {
    if (lowQuality) return;
    slowFrames = dt > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames > 90) setQuality('low');
  }
  function setQuality(level) {
    lowQuality = level === 'low';
    bloom.enabled = !lowQuality;
    for (const fn of qualityListeners) fn(level);
  }

  let aspectOverride = null;
  function resize() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (aspectOverride) {
      if (w / h > aspectOverride) w = Math.round(h * aspectOverride);
      else h = Math.round(w / aspectOverride);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function frame() {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    watchPerformance(rawDt);
    sharedTime.value += dt;
    for (const fn of updaters) fn(dt, sharedTime.value);
    composer.render();
    requestAnimationFrame(frame);
  }

  return {
    renderer,
    scene,
    camera,
    bloom,
    // Her karede çağrılacak fonksiyonları kaydet
    onUpdate(fn) {
      updaters.add(fn);
      return () => updaters.delete(fn);
    },
    start() {
      frame();
    },
    setQuality,
    isLowQuality: () => lowQuality,
    onQualityChange(fn) {
      qualityListeners.add(fn);
    },
    // null = tam ekran; sayı = sabit en-boy oranı (ör. 9/16), canvas ortalanır
    setAspect(ratio) {
      aspectOverride = ratio;
      resize();
    },
  };
}
