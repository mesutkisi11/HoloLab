import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createScene } from './scene/createScene.js';
import { createHologramRing } from './scene/hologramRing.js';
import { createGhost } from './scene/ghost.js';
import { demoModels } from './models/index.js';
import { collectParts, setPartHighlight } from './models/partBuilder.js';

const canvas = document.getElementById('scene');
const app = createScene(canvas);

// Geçici fare kontrolü: sürükle = döndür, tekerlek = yakınlaştır (ileride yedek kontrol olacak)
const controls = new OrbitControls(app.camera, canvas);
controls.target.set(0, 0.2, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
controls.minDistance = 0.6;
controls.maxDistance = 4;

const ring = createHologramRing(0.75);
app.scene.add(ring.group);

// Model + hayaleti tek bir "stage" grubunda; halkanın biraz üstünde dursun
const stage = new THREE.Group();
stage.position.y = 0.28;
app.scene.add(stage);

let current = null;

function showModel(index) {
  if (current) stage.remove(current.root, current.ghost);
  const def = demoModels[index];
  const root = def.build();
  const ghost = createGhost(root);
  stage.add(root, ghost);
  current = { index, root, ghost, parts: collectParts(root) };
  document.title = `HoloLab · ${def.name}`;
}
showModel(0);

// M tuşu: demo modeller arasında geçiş (sadece bu adım için)
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm') showModel((current.index + 1) % demoModels.length);
});

// Fare ile üzerine gelinen parçayı vurgula: Raycaster, fareden sahneye ışın atıp neye çarptığını bulur
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-10, -10);
let hovered = null;

window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

app.onUpdate((dt) => {
  controls.update();
  ring.update(dt);

  raycaster.setFromCamera(pointer, app.camera);
  const hit = raycaster.intersectObject(current.root, true).find((h) => h.object.isMesh);
  hovered = hit ? hit.object.userData.partId : null;

  // Vurgu yumuşak geçsin: her karede hedefe doğru biraz yaklaş
  for (const part of current.parts) {
    const data = part.userData.part;
    const target = data.id === hovered ? 1 : 0;
    const next = THREE.MathUtils.damp(data.highlight, target, 12, dt);
    if (Math.abs(next - data.highlight) > 0.001) setPartHighlight(part, next);
  }
});

app.start();
