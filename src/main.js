import * as THREE from 'three';
import { createScene } from './scene/createScene.js';
import { createHud } from './ui/hud.js';
import { startCamera } from './hands/camera.js';
import { createTracker } from './hands/tracker.js';
import { createHandState } from './hands/handState.js';
import { createHandVisuals } from './hands/handVisuals.js';
import { createModelScreen, MODEL_VIEW } from './screens/modelScreen.js';
import { createGalleryScreen, GALLERY_CENTER } from './screens/galleryScreen.js';
import { createDesignRegistry } from './gallery/designs.js';
import { createDropZone } from './gallery/dropZone.js';
import { createTrashBin } from './trash/trashBin.js';

const canvas = document.getElementById('scene');
const app = createScene(canvas);
app.canvas = canvas;

const hud = createHud();
const handVisuals = createHandVisuals(app.scene, app.camera);
const registry = createDesignRegistry();

// Kamera görünümleri: galeri ve model için ayrı; geçişte yumuşakça kayar
const GALLERY_VIEW = { position: new THREE.Vector3(0, 0.5, 1.7), target: GALLERY_CENTER.clone() };
let cameraGoal = GALLERY_VIEW;
let cameraMoving = true;

// --- Ekranlar ---
let state = 'gallery'; // 'gallery' | 'model' | 'transition'

const trash = createTrashBin(app, { hud });

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
    cameraGoal = GALLERY_VIEW;
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
  onBackToGallery: backToGallery,
  onGrabStart,
  onGrabRelease,
});

const gallery = createGalleryScreen(app, {
  hud,
  handVisuals,
  registry,
  onOpen: openDesign,
  onGrabStart,
  onGrabRelease,
});

async function openDesign(def) {
  state = 'transition';
  gallery.setVisible(false);
  cameraGoal = MODEL_VIEW;
  cameraMoving = true;
  await modelScreen.open(def);
  state = 'model';
}

async function backToGallery() {
  if (state !== 'model') return;
  state = 'transition';
  await modelScreen.close();
  gallery.setVisible(true);
  cameraGoal = GALLERY_VIEW;
  cameraMoving = true;
  state = 'gallery';
}

createDropZone({
  hud,
  onModel: async (file) => {
    const id = await registry.addFile(file);
    await gallery.rebuild(id);
    if (state === 'model') await backToGallery();
  },
  onChoreo: async (json) => {
    const def = state === 'model' ? modelScreen.current?.def : gallery.selected()?.design;
    if (!def || def.isDemo) return hud.showGesture('Önce yüklenen bir tasarım seç');
    await registry.attachChoreo(def.id, json);
    hud.showGesture('Koreografi yüklendi');
    if (state === 'model') await modelScreen.load(registry.byId(def.id), { startProgress: 0 }).then(() => modelScreen.playTo(1));
  },
});

// --- Başlangıç ---
(async () => {
  await registry.refresh();
  await gallery.rebuild();
  modelScreen.setActive(false);
  // Test için: ?model=N doğrudan N. tasarımı açar
  const direct = new URLSearchParams(location.search).get('model');
  if (direct !== null && registry.list[Number(direct)]) openDesign(registry.list[Number(direct)]);
})();

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'escape') return backToGallery();
  if (key === 'delete' && state === 'model') return modelScreen.forceTrash();
  if (state === 'model') modelScreen.onKey(key);
  else if (state === 'gallery') gallery.onKey(key);
});

// --- El takibi ---
let handInput = null;
let lastSeen = 0;

async function initHands() {
  hud.setStatus('El takibi yükleniyor…');
  try {
    const [video, tracker] = await Promise.all([startCamera(), createTracker()]);
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
  const result = handInput.tracker.detect(handInput.video);
  const { hands, tracking } = handInput.state.analyze(result, time, dt);
  const planeDistance = app.camera.position.distanceTo(state === 'model' ? modelScreen.orbit.target : GALLERY_CENTER);
  handVisuals.update(hands, planeDistance);

  if (tracking) {
    lastSeen = time;
    hud.setStatus('');
  } else if (time - lastSeen > 2) {
    hud.setStatus('Elini kameraya göster');
  }
  // Geri al: silme sonrası 5 sn içinde açık eli kendine doğru çek (el küçülür)
  const h = hands[0];
  if (trash.hasPendingUndo() && h?.isOpen && h.sizeVelocity / Math.max(h.size, 1e-3) < -1.2) {
    trash.triggerUndo();
    return;
  }
  if (trash.isAnimating()) return;
  if (state === 'model') modelScreen.onHands(hands, dt, time, tracking);
  else if (state === 'gallery') gallery.onHands(hands, dt, time);
}

function updateCamera(dt) {
  if (!cameraMoving) return;
  app.camera.position.x = THREE.MathUtils.damp(app.camera.position.x, cameraGoal.position.x, 4, dt);
  app.camera.position.y = THREE.MathUtils.damp(app.camera.position.y, cameraGoal.position.y, 4, dt);
  app.camera.position.z = THREE.MathUtils.damp(app.camera.position.z, cameraGoal.position.z, 4, dt);
  modelScreen.orbit.target.lerp(cameraGoal.target, 1 - Math.exp(-4 * dt));
  app.camera.lookAt(modelScreen.orbit.target);
  if (app.camera.position.distanceTo(cameraGoal.position) < 0.005) cameraMoving = false;
}

app.onUpdate((dt, time) => {
  updateHands(dt, time);
  updateCamera(dt);
  gallery.update(dt, time);
  modelScreen.update(dt, time);
  trash.update(dt);
});

app.start();
