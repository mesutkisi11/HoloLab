import { createScene } from './scene/createScene.js';
import { demoModels } from './models/index.js';
import { createHud } from './ui/hud.js';
import { startCamera } from './hands/camera.js';
import { createTracker } from './hands/tracker.js';
import { createHandState } from './hands/handState.js';
import { createHandVisuals } from './hands/handVisuals.js';
import { createModelScreen } from './screens/modelScreen.js';

const canvas = document.getElementById('scene');
const app = createScene(canvas);
app.canvas = canvas;

const hud = createHud();
const handVisuals = createHandVisuals(app.scene, app.camera);

const modelScreen = createModelScreen(app, {
  hud,
  handVisuals,
  onBackToGallery: () => hud.showGesture('Galeri (8. adımda)'),
});

// Şimdilik: ?model=1 ile ikinci demo, M tuşu ile geçiş
let modelIndex = Number(new URLSearchParams(location.search).get('model') ?? 0);
modelScreen.load(demoModels[modelIndex]);

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'm') {
    modelIndex = (modelIndex + 1) % demoModels.length;
    modelScreen.load(demoModels[modelIndex]);
    return;
  }
  modelScreen.onKey(key);
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
  handVisuals.update(hands, app.camera.position.distanceTo(modelScreen.orbit.target));

  if (tracking) {
    lastSeen = time;
    hud.setStatus('');
  } else if (time - lastSeen > 2) {
    hud.setStatus('Elini kameraya göster');
  }
  modelScreen.onHands(hands, dt, time, tracking);
}

app.onUpdate((dt, time) => {
  updateHands(dt, time);
  modelScreen.update(dt, time);
});

app.start();
