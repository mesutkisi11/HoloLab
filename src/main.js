import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createScene } from './scene/createScene.js';
import { createHologramRing } from './scene/hologramRing.js';
import { createGhost } from './scene/ghost.js';
import { sharedWave } from './scene/hologramMaterial.js';
import { demoModels } from './models/index.js';
import { collectParts, setPartHighlight } from './models/partBuilder.js';
import { createChoreography } from './choreo/choreography.js';
import { generateAutoChoreography } from './choreo/autoChoreo.js';
import { createTrails } from './choreo/trail.js';
import { createSlider } from './ui/slider.js';

const canvas = document.getElementById('scene');
const app = createScene(canvas);

// Geçici fare kontrolü: sürükle = döndür, tekerlek = yakınlaştır
const controls = new OrbitControls(app.camera, canvas);
controls.target.set(0, 0.2, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.minDistance = 0.6;
controls.maxDistance = 4;

const ring = createHologramRing(0.75);
app.scene.add(ring.group);

const stage = new THREE.Group();
stage.position.y = 0.28;
app.scene.add(stage);

let current = null;
// Otomatik oynatma hedefi (null = elle kontrol). Space ile ileri/geri oynatılır.
let playTarget = null;

const slider = createSlider((p) => {
  playTarget = null;
  current?.choreo.setProgress(p);
});

async function loadChoreography(def, root, parts) {
  if (def.choreo) {
    const res = await fetch(import.meta.env.BASE_URL + def.choreo);
    return res.json();
  }
  return generateAutoChoreography(root, parts);
}

async function showModel(index) {
  if (current) {
    stage.remove(current.root, current.ghost);
    current.trails.dispose();
  }
  const def = demoModels[index];
  const root = def.build();
  const ghost = createGhost(root);
  stage.add(root, ghost);
  const parts = collectParts(root);

  const data = await loadChoreography(def, root, parts);
  const choreo = createChoreography(parts, data);
  const trails = createTrails(app.scene, parts);

  // Final: tüm parçalar oturunca hologram dalgası + pervane dönüşü
  const finale = { waveStart: -1, spinStart: -1, spin: data.final?.spin ?? null };
  choreo.on('complete', () => {
    finale.waveStart = 0;
    finale.spinStart = 0;
  });

  current = { index, def, root, ghost, parts, choreo, trails, finale };
  // Test için: ?p=0.5 gibi bir URL parametresi ilerlemeyi doğrudan ayarlar
  const urlProgress = new URLSearchParams(location.search).get('p');
  if (urlProgress !== null) choreo.setProgress(Number(urlProgress));
  slider.set(choreo.getProgress());
  document.title = `HoloLab · ${def.name}`;
}
showModel(Number(new URLSearchParams(location.search).get('model') ?? 0));

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'm') showModel((current.index + 1) % demoModels.length);
  if (key === 'e') playTarget = 0; // sök
  if (key === 'a') playTarget = 1; // birleştir
  if (key === ' ') {
    // İlerlemeye göre ters yöne oynat
    const p = current.choreo.getProgress();
    playTarget = playTarget === null ? (p > 0.5 ? 0 : 1) : null;
  }
});

// Fare ile üzerine gelinen parçayı vurgula (Raycaster: fareden ışın atıp neye çarptığını bulur)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-10, -10);
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

const modelBox = new THREE.Box3();
const spinAxis = new THREE.Vector3();

app.onUpdate((dt) => {
  controls.update();
  ring.update(dt);
  if (!current) return;
  const { choreo, parts, trails, root } = current;

  // Otomatik oynatma: progress hedefe doğru sabit hızla ilerler
  if (playTarget !== null) {
    const p = choreo.getProgress();
    const step = dt / choreo.duration;
    const next = p < playTarget ? Math.min(playTarget, p + step) : Math.max(playTarget, p - step);
    choreo.setProgress(next);
    slider.set(next);
    if (next === playTarget) playTarget = null;
  }

  choreo.update(dt);
  trails.update(dt, choreo.isMoving);

  raycaster.setFromCamera(pointer, app.camera);
  const hit = raycaster.intersectObject(root, true).find((h) => h.object.isMesh);
  const hovered = hit ? hit.object.userData.partId : null;

  for (const part of parts) {
    const data = part.userData.part;
    const target = data.id === hovered || choreo.isMoving(data.id) ? 1 : 0;
    const next = THREE.MathUtils.damp(data.highlight, target, 12, dt);
    if (Math.abs(next - data.highlight) > 0.001) setPartHighlight(part, next);
  }

  updateFinale(dt);
});

// Hologram dalgası modelin altından üstüne süpürür; pervaneler hızlanıp yavaşlar
function updateFinale(dt) {
  const { finale, root } = current;
  if (finale.waveStart >= 0) {
    finale.waveStart += dt;
    modelBox.setFromObject(root);
    const t = finale.waveStart / 1.2;
    sharedWave.value = THREE.MathUtils.lerp(modelBox.min.y - 0.1, modelBox.max.y + 0.1, t);
    if (t > 1) {
      finale.waveStart = -1;
      sharedWave.value = -100;
    }
  }
  if (finale.spinStart >= 0 && finale.spin) {
    finale.spinStart += dt;
    const k = 1 - finale.spinStart / finale.spin.duration;
    if (k <= 0) {
      finale.spinStart = -1;
      return;
    }
    spinAxis.fromArray(finale.spin.axis);
    const speed = 30 * Math.sin(Math.PI * Math.min(1, 1 - k)) + 30 * k;
    for (const id of finale.spin.parts) {
      const part = current.parts.find((p) => p.userData.part.id === id);
      part?.rotateOnAxis(spinAxis, speed * dt);
    }
  }
}

app.start();
