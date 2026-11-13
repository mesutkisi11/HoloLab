import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sharedTime } from './hologramMaterial.js';
import { createPostPass } from './postPass.js';
import { TIERS, TIER_ORDER, detectTier, saveTier, createFrameMonitor } from './quality.js';

// Renderer + kamera + efekt zinciri. Efekt zinciri kalite seviyesine göre kurulur:
// RenderPass (MSAA'lı) -> Bloom -> OutputPass (renk dönüşümü) -> son görüntü geçişi
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // kenar yumuşatmayı efekt zincirinin MSAA hedefi yapıyor
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#010409');

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 60);
  camera.position.set(0.95, 0.62, 1.15);
  camera.lookAt(0, 0.28, 0);

  let tier = detectTier(renderer);
  let composer = null;
  let bloom = null;
  let post = null;
  let aspectOverride = null;
  const qualityListeners = new Set();

  function viewSize() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (aspectOverride) {
      if (w / h > aspectOverride) w = Math.round(h * aspectOverride);
      else h = Math.round(w / aspectOverride);
    }
    return { w, h };
  }

  function buildComposer() {
    composer?.dispose();
    const settings = TIERS[tier];
    const { w, h } = viewSize();
    const pr = Math.min(window.devicePixelRatio || 1, settings.pixelRatio);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);

    // MSAA: çizgilerin tırtıklı görünmesini engelleyen asıl ayar
    const target = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), {
      type: THREE.HalfFloatType,
      samples: settings.msaa,
    });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));

    bloom = null;
    if (settings.bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.4, 0.62);
      // Bloom'u düşük çözünürlükte hesapla (iç hesap genişliğin yarısını kullanır)
      const scale = settings.bloomScale * 2;
      const baseSetSize = bloom.setSize.bind(bloom);
      bloom.setSize = (bw, bh) => baseSetSize(Math.max(64, bw * scale), Math.max(64, bh * scale));
      bloom.setSize(w * pr, h * pr);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());

    post = null;
    if (settings.post) {
      post = createPostPass();
      post.uniforms.uResolution.value.set(w * pr, h * pr);
      composer.addPass(post);
    }

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setTier(next, { persist = true } = {}) {
    if (!TIERS[next] || next === tier) return;
    tier = next;
    if (persist) saveTier(tier);
    buildComposer();
    monitor.reset();
    for (const fn of qualityListeners) fn(tier, TIERS[tier]);
  }

  // Kareler sürekli yavaşsa bir alt seviyeye in (kaydetmeden: bir dahaki açılışta yine dene)
  const monitor = createFrameMonitor(() => {
    const i = TIER_ORDER.indexOf(tier);
    if (i < TIER_ORDER.length - 1) setTier(TIER_ORDER[i + 1], { persist: false });
  });

  buildComposer();
  window.addEventListener('resize', buildComposer);

  const timer = new THREE.Timer();
  timer.connect(document); // sekme gizlenince büyük zaman sıçramalarını engeller
  const updaters = new Set();
  let fps = 60;

  function frame(timestamp) {
    timer.update(timestamp);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    monitor.push(rawDt);
    if (rawDt > 0) fps = THREE.MathUtils.lerp(fps, 1 / rawDt, 0.05);
    sharedTime.value += dt;
    if (post) post.uniforms.uTime.value = sharedTime.value;
    for (const fn of updaters) fn(dt, sharedTime.value);
    composer.render(dt);
    requestAnimationFrame(frame);
  }

  return {
    renderer,
    scene,
    camera,
    get fps() {
      return fps;
    },
    get tier() {
      return tier;
    },
    tierSettings: () => TIERS[tier],
    setTier,
    // B tuşu: yüksek -> orta -> düşük -> yüksek
    cycleTier() {
      const i = TIER_ORDER.indexOf(tier);
      setTier(TIER_ORDER[(i + 1) % TIER_ORDER.length]);
      return TIERS[tier].label;
    },
    onQualityChange(fn) {
      qualityListeners.add(fn);
    },
    // Kısa süreli görüntü bozulması (çöpe atma, ışınlanma anları için)
    glitch(amount) {
      if (post) post.uniforms.uGlitch.value = amount;
    },
    onUpdate(fn) {
      updaters.add(fn);
      return () => updaters.delete(fn);
    },
    start() {
      frame();
    },
    // null = tam ekran; sayı = sabit en-boy oranı (ör. 9/16), canvas ortalanır
    setAspect(ratio) {
      aspectOverride = ratio;
      buildComposer();
    },
  };
}
