import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { createScene } from './scene/createScene.js';
import { createEnvironment } from './scene/environment.js';
import { sharedFocus } from './scene/hologramMaterial.js';
import { createHud } from './ui/hud.js';
import { startCamera } from './hands/camera.js';
import { createTracker } from './hands/tracker.js';
import { createHandState } from './hands/handState.js';
import { createHandVisuals } from './hands/handVisuals.js';
import { createModelScreen } from './screens/modelScreen.js';
import { createGalleryScreen, GALLERY_CENTER } from './screens/galleryScreen.js';
import { createDesignRegistry } from './gallery/designs.js';
import { createDropZone } from './gallery/dropZone.js';
import { createTrashBin } from './trash/trashBin.js';
import { createSounds } from './audio/sounds.js';
import { createGuide } from './ui/guide.js';
import { createTutorial } from './ui/tutorial.js';
import { createCinematic } from './ui/cinematic.js';

// Büyük yüklenen modellerde ışın testini hızlandır (BVH varsa kullanır, yoksa normal yöntem)
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const canvas = document.getElementById('scene');
const app = createScene(canvas);
app.canvas = canvas;

const env = createEnvironment(app.scene, app.tierSettings());
const hud = createHud();
const sounds = createSounds();
const guide = createGuide({ onTutorial: () => tutorial.show() });
const tutorial = createTutorial({ sounds, openGuide: () => guide.show() });
const handVisuals = createHandVisuals(app.scene, app.camera);
const registry = createDesignRegistry();

app.onQualityChange((tier, settings) => {
  env.setTier(settings);
  hud.showGesture(settings.label);
});

// Galeri kamerası: model ekranında kamerayı model ekranı yönetir
const GALLERY_VIEW = { position: new THREE.Vector3(0, 0.52, 1.75), target: GALLERY_CENTER.clone() };
let cameraMoving = true;

// Galeri modunda ortam: halkalar kapalı, tarama seçili önizleme boyutunda
function galleryEnv() {
  env.setGyroVisible(false);
  env.setModelBounds(new THREE.Box3(new THREE.Vector3(-0.3, 0.08, -0.3), new THREE.Vector3(0.3, 0.68, 0.3)));
}

// --- Ekranlar ---
let state = 'gallery'; // 'gallery' | 'model' | 'transition'

const trash = createTrashBin(app, { hud, sounds });

// Kavrama başlayınca çöp kutusu belirir, model kırmızımsı olur
function onGrabStart(root) {
  trash.show();
  trash.tintGrabbed(root, true);
}

// Kavranan model bırakıldı: kutuya doğru savrulduysa sil, yoksa yerine dön
function onGrabRelease(def, velocity, hand, handle) {
  trash.tintGrabbed(handle.root, false);
  const toBin = !!hand && trash.isThrowTowards(hand.palm, velocity);
  if (!toBin || !def) {
    trash.hide();
    handle.returnHome();
    return;
  }
  handle.freeze?.();
  app.glitch(0.4);
  setTimeout(() => app.glitch(0), 160);
  if (def.isDemo) {
    trash.throwIn(handle.root, { demo: true, onBounce: () => handle.returnHome() });
    return;
  }
  hud.showGesture('Çöpe at');
  trash.throwIn(handle.root, { onDone: () => startPendingDelete(def) });
}

// Silme bekleme süresi: 5 sn içinde geri alınabilir, sonra IndexedDB'den kalıcı silinir
async function startPendingDelete(def) {
  gallery.setPendingHide(def.id);
  if (state === 'model') {
    modelScreen.closeImmediate();
    galleryEnv();
    cameraMoving = true;
    state = 'gallery';
  }
  await gallery.rebuild();
  gallery.setVisible(true);
  trash.startUndo({
    onUndo: async () => {
      gallery.setPendingHide(null);
      await gallery.rebuild(def.id);
    },
    onExpire: async () => {
      await registry.remove(def.id);
      gallery.setPendingHide(null);
      await gallery.rebuild();
      hud.showGesture('Kalıcı olarak silindi');
    },
  });
}

const modelScreen = createModelScreen(app, {
  hud,
  handVisuals,
  sounds,
  env,
  onBackToGallery: backToGallery,
  onGrabStart,
  onGrabRelease,
});

const drop = createDropZone({
  hud,
  onModels: async (files) => {
    const ids = await registry.addFiles(files);
    if (!ids.length) return hud.showGesture('Model dosyası bulunamadı');
    if (state === 'model') await backToGallery();
    await gallery.rebuild(ids[0]);
    hud.showGesture(ids.length > 1 ? `${ids.length} tasarım eklendi` : 'Tasarım eklendi');
  },
  onChoreo: async (json) => {
    const def = state === 'model' ? modelScreen.current?.def : gallery.selected()?.design;
    if (!def || def.isDemo) return hud.showGesture('Önce yüklenen bir tasarım seç');
    await registry.attachChoreo(def.id, json);
    hud.showGesture('Koreografi yüklendi');
    if (state === 'model') {
      await modelScreen.load(registry.byId(def.id), { startProgress: 0 });
      modelScreen.playTo(1);
    }
  },
});

const gallery = createGalleryScreen(app, {
  hud,
  handVisuals,
  sounds,
  registry,
  onOpen: openDesign,
  onAdd: () => drop.openPicker(),
  onGrabStart,
  onGrabRelease,
});

async function openDesign(def) {
  state = 'transition';
  gallery.setVisible(false);
  cameraMoving = false;
  try {
    await modelScreen.open(def);
    state = 'model';
  } catch (err) {
    console.warn('Tasarım açılamadı:', err);
    hud.showGesture('Tasarım açılamadı');
    modelScreen.closeImmediate();
    galleryEnv();
    gallery.setVisible(true);
    cameraMoving = true;
    state = 'gallery';
  }
}

async function backToGallery() {
  if (state !== 'model') return;
  state = 'transition';
  if (cinematic.isOn()) cinematic.toggle();
  await modelScreen.close();
  galleryEnv();
  gallery.setVisible(true);
  cameraMoving = true;
  state = 'gallery';
}

const cinematic = createCinematic(app, modelScreen);

// --- Başlangıç ---
// Ağır işler (model indirme, kenar çizgileri, BVH) yükleme ekranının arkasında biter; sonra donma olmaz
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = '<b>HOLOLAB</b><span>Tasarımlar hazırlanıyor…</span>';
document.body.appendChild(loading);
(async () => {
  await registry.refresh();
  await gallery.rebuild();
  app.renderer.compile(app.scene, app.camera);
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 700);
  hud.setNotice('Örnek montajlar yükleniyor…');
  registry.prepareLibrary(async (done, total) => {
    hud.setNotice(done < total ? `Örnek montajlar yükleniyor ${done}/${total}` : '');
    await registry.refresh();
    await gallery.rebuild(gallery.selected()?.design?.id ?? null);
  });
  // Test için: ?model=N doğrudan N. tasarımı açar
  const direct = new URLSearchParams(location.search).get('model');
  if (direct !== null && registry.list[Number(direct)]) openDesign(registry.list[Number(direct)]);
})();

// Koreografiyi JSON dosyası olarak indir (elle düzenleyip sürükle-bırak ile geri yüklenebilir)
function downloadChoreo() {
  const exp = modelScreen.exportChoreo();
  if (!exp) return;
  const blob = new Blob([JSON.stringify(exp.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${exp.def.id}-choreo.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  hud.showGesture('Koreografi indirildi');
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'u') return drop.openPicker();
  if (key === 's') return hud.showGesture(sounds.toggle() ? 'Ses açık' : 'Ses kapalı');
  if (key === 'b') return app.cycleTier();
  if (key === 'c' && state === 'model') return cinematic.toggle();
  if (key === 'v' && state === 'model') return cinematic.toggleAspect();
  if (key === 'j' && state === 'model') return downloadChoreo();
  if (key === 'escape') {
    if (cinematic.isOn()) return cinematic.toggle();
    return backToGallery();
  }
  if (key === 'delete' && state === 'model') return modelScreen.forceTrash();
  if (state === 'model') modelScreen.onKey(key);
  else if (state === 'gallery') gallery.onKey(key);
});

// --- El takibi ---
let handInput = null;
let lastSeen = -10;
let lastSeq = -1;
let frameHands = { hands: [], tracking: false };

async function initHands() {
  hud.setStatus('El takibi yükleniyor…');
  try {
    const video = await startCamera();
    const tracker = await createTracker(video);
    handInput = { video, tracker, state: createHandState() };
    hud.setStatus('Elini kameraya göster');
  } catch (err) {
    console.warn('El takibi başlatılamadı, fare ile devam:', err);
    hud.setStatus('Kamera yok · fare ile kontrol');
    setTimeout(() => hud.setStatus(''), 3000);
  }
}
initHands();

function updateHands(dt, time) {
  if (!handInput) return;
  // Sadece yeni bir algılama sonucu geldiyse eli yeniden çözümle
  const result = handInput.tracker.latest();
  if (result && result.seq !== lastSeq) {
    lastSeq = result.seq;
    frameHands = handInput.state.analyze(result, result.ts / 1000);
  }
  const { hands, tracking } = frameHands;
  const planeDistance = app.camera.position.distanceTo(state === 'model' ? modelScreen.orbit.target : GALLERY_CENTER);
  handVisuals.update(hands, planeDistance, dt);

  if (tracking) {
    lastSeen = time;
    hud.setStatus('');
    // Rehber açıkken yumruk yapmak rehberi kapatır
    if (guide.isVisible() && hands.some((x) => x.isFist)) guide.hide();
  } else if (time - lastSeen > 2) {
    hud.setStatus('Elini kameraya göster');
  }
  // Eğitim açıkken hareketler sadece eğitimde denenir
  if (tutorial.isVisible()) return tutorial.onHands(hands, time);
  // Geri al: silme sonrası 5 sn içinde açık eli kendine doğru çek (el kameradan uzaklaşır, görüntüde küçülür)
  const h = hands[0];
  if (trash.hasPendingUndo() && h?.isOpen && h.sizeVelocity / Math.max(h.size, 1e-3) < -1.0) {
    trash.triggerUndo();
    return;
  }
  if (trash.isAnimating()) return;
  if (state === 'model') modelScreen.onHands(hands, dt, time, tracking);
  else if (state === 'gallery') gallery.onHands(hands, dt, time);
}

function updateCamera(dt) {
  const target = state === 'model' || state === 'transition' ? modelScreen.orbit.target : GALLERY_CENTER;
  sharedFocus.value = app.camera.position.distanceTo(target);
  if (!cameraMoving || state === 'model') return;
  const k = 1 - Math.exp(-4 * dt);
  app.camera.position.lerp(GALLERY_VIEW.position, k);
  modelScreen.orbit.target.lerp(GALLERY_VIEW.target, k);
  app.camera.lookAt(modelScreen.orbit.target);
  if (app.camera.position.distanceTo(GALLERY_VIEW.position) < 0.003) cameraMoving = false;
}

// Sağ alttaki küçük telemetri: saniyede 4 kez güncellenir
let telemetryTimer = 0;
function updateTelemetry(dt) {
  telemetryTimer -= dt;
  if (telemetryTimer > 0) return;
  telemetryTimer = 0.25;
  const rows = [
    ['FPS', String(Math.round(app.fps))],
    ['GÖRÜNTÜ', app.tierSettings().label.toUpperCase()],
  ];
  if (handInput) {
    const t = handInput.tracker;
    rows.push(['EL', `${t.mode === 'worker' ? 'AYRI İŞ PARÇ.' : 'ANA İŞ PARÇ.'} · ${t.delegate} · ${Math.round(t.inferMs)} ms`]);
  } else rows.push(['EL', 'KAPALI']);
  const stats = modelScreen.stats();
  if (state === 'model' && stats) {
    rows.push(['PARÇA', String(stats.parts)]);
    rows.push(['MONTAJ', `${Math.round(stats.progress * 100)}%`]);
  } else {
    rows.push(['TASARIM', String(registry.list.length)]);
  }
  hud.setTelemetry(rows);
}

app.onUpdate((dt, time) => {
  updateHands(dt, time);
  updateCamera(dt);
  env.update(dt, time);
  gallery.update(dt, time);
  modelScreen.update(dt, time);
  cinematic.update(dt);
  trash.update(dt);
  updateTelemetry(dt);
});

galleryEnv();

app.start();
