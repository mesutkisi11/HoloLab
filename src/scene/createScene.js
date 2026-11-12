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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02060c');

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(1.1, 0.7, 1.3);
  camera.lookAt(0, 0.05, 0);

  // Bloom: parlak yerlerin etrafına ışık taşması. Hologram hissinin yarısı budur.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
    0.9, // güç
    0.55, // yarıçap
    0.12, // eşik: bundan parlak pikseller taşar
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  const updaters = new Set();

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
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
  };
}
