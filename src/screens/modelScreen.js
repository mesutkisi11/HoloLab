import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHologramRing } from '../scene/hologramRing.js';
import { createGhost } from '../scene/ghost.js';
import { createTargetRing } from '../scene/targetRing.js';
import { sharedWave } from '../scene/hologramMaterial.js';
import { collectParts, setPartHighlight } from '../models/partBuilder.js';
import { createChoreography } from '../choreo/choreography.js';
import { generateAutoChoreography } from '../choreo/autoChoreo.js';
import { createTrails } from '../choreo/trail.js';
import { createPartGrab } from '../interaction/partGrab.js';
import { createMouseControls } from '../interaction/mouseControls.js';
import { createModelGestures } from '../hands/modelGestures.js';
import { createSlider } from '../ui/slider.js';

// Model ekranı: tek bir modelin sökülüp birleştirildiği sahne.
export function createModelScreen(app, { hud, handVisuals, onBackToGallery }) {
  const { scene, camera, canvas } = app;

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0.2, 0);
  orbit.enableDamping = true;
  orbit.autoRotate = true;
  orbit.autoRotateSpeed = 0.6;
  orbit.minDistance = 0.6;
  orbit.maxDistance = 4;

  const ring = createHologramRing(0.75);
  scene.add(ring.group);

  // Model + hayalet "stage" içinde; elle döndürme stage'i çevirir
  const stage = new THREE.Group();
  stage.position.y = 0.28;
  scene.add(stage);

  const targetRing = createTargetRing(scene, camera);
  const slider = createSlider((p) => {
    playTarget = null;
    current?.choreo.setProgress(p);
  });

  let current = null;
  let playTarget = null;
  let playSpeed = 1;
  let slowMo = false;
  const modelBox = new THREE.Box3();
  const spinAxis = new THREE.Vector3();

  const getPart = (id) => current?.parts.find((p) => p.userData.part.id === id) ?? null;
  const grab = createPartGrab({
    get choreo() {
      return current?.choreo;
    },
    get root() {
      return current?.root;
    },
    camera,
  });
  // partGrab "choreo" ve "root" alanlarını getter'la okur; current değişince otomatik güncellenir
  createMouseControls({ canvas, camera, grab, orbit, ring: targetRing, getPart });

  function playTo(target, speed = 1) {
    playTarget = target;
    playSpeed = speed;
  }

  function stepBy(dir) {
    if (!current) return;
    const p = current.choreo.getProgress();
    const points = current.choreo.seatPoints();
    const next = dir > 0 ? points.find((x) => x > p + 0.002) : [...points].reverse().find((x) => x < p - 0.002);
    if (next !== undefined) playTo(next, 1);
  }

  const gestures = createModelGestures({
    getProgress: () => current?.choreo.getProgress() ?? 1,
    setProgress(p) {
      playTarget = null;
      current?.choreo.setProgress(p);
      slider.set(p);
    },
    playTo,
    stepBy,
    explode: () => playTo(0, 3),
    fullAssemble() {
      current?.choreo.clearOverrides();
      playTo(1, 1);
    },
    rotate(dx, dy) {
      stage.rotation.y += dx * 5;
      stage.rotation.x = THREE.MathUtils.clamp(stage.rotation.x + dy * 3, -0.6, 0.6);
    },
    zoom(factor) {
      const offset = camera.position.clone().sub(orbit.target);
      const d = THREE.MathUtils.clamp(offset.length() * factor, orbit.minDistance, orbit.maxDistance);
      camera.position.copy(orbit.target).addScaledVector(offset.normalize(), d);
    },
    setSlowMo: (v) => (slowMo = v),
    isSlowMo: () => slowMo,
    backToGallery: () => onBackToGallery?.(),
    hud,
    visuals: handVisuals,
    ring: targetRing,
    grab,
    getPart,
    planeDistance: () => camera.position.distanceTo(orbit.target),
  });

  async function loadChoreography(def, root, parts) {
    if (def.choreo) {
      const res = await fetch(import.meta.env.BASE_URL + def.choreo);
      return res.json();
    }
    return generateAutoChoreography(root, parts);
  }

  async function load(def) {
    unload();
    const root = def.build();
    const ghost = createGhost(root);
    stage.add(root, ghost);
    const parts = collectParts(root);

    const data = await loadChoreography(def, root, parts);
    const choreo = createChoreography(parts, data);
    const trails = createTrails(scene, parts);

    // Final: tüm parçalar oturunca hologram dalgası + pervane dönüşü
    const finale = { waveT: -1, spinT: -1, spin: data.final?.spin ?? null };
    choreo.on('complete', () => {
      finale.waveT = 0;
      finale.spinT = 0;
    });

    current = { def, root, ghost, parts, choreo, trails, finale };
    const urlProgress = new URLSearchParams(location.search).get('p');
    if (urlProgress !== null) choreo.setProgress(Number(urlProgress));
    slider.set(choreo.getProgress());
    document.title = `HoloLab · ${def.name}`;
  }

  function unload() {
    if (!current) return;
    stage.remove(current.root, current.ghost);
    current.trails.dispose();
    current = null;
  }

  function update(dt, time) {
    orbit.update();
    ring.update(dt);
    targetRing.update(dt);
    if (!current) return;
    const { choreo, parts, trails, root } = current;

    // Otomatik oynatma: hedefe doğru sabit hızla
    if (playTarget !== null) {
      const p = choreo.getProgress();
      const step = (dt / choreo.duration) * playSpeed * (slowMo ? 0.25 : 1);
      const next = p < playTarget ? Math.min(playTarget, p + step) : Math.max(playTarget, p - step);
      choreo.setProgress(next);
      slider.set(next);
      if (next === playTarget) playTarget = null;
    }

    choreo.update(dt);
    grab.update(dt);
    trails.update(dt, choreo.isMoving);

    for (const part of parts) {
      const data = part.userData.part;
      const target = choreo.isMoving(data.id) ? 1 : 0;
      const next = THREE.MathUtils.damp(data.highlight, target, 12, dt);
      if (Math.abs(next - data.highlight) > 0.001) setPartHighlight(part, next);
    }

    updateFinale(dt, root);
    void time;
  }

  function updateFinale(dt, root) {
    const { finale, parts } = current;
    if (finale.waveT >= 0) {
      finale.waveT += dt;
      modelBox.setFromObject(root);
      const t = finale.waveT / 1.2;
      sharedWave.value = THREE.MathUtils.lerp(modelBox.min.y - 0.1, modelBox.max.y + 0.1, t);
      if (t > 1) {
        finale.waveT = -1;
        sharedWave.value = -100;
      }
    }
    if (finale.spinT >= 0 && finale.spin) {
      finale.spinT += dt;
      const k = 1 - finale.spinT / finale.spin.duration;
      if (k <= 0) {
        finale.spinT = -1;
        return;
      }
      spinAxis.fromArray(finale.spin.axis);
      const speed = 30 * Math.sin(Math.PI * (1 - k)) + 30 * k;
      for (const id of finale.spin.parts) {
        parts.find((p) => p.userData.part.id === id)?.rotateOnAxis(spinAxis, speed * dt);
      }
    }
  }

  function onHands(hands, dt, time, tracking) {
    if (tracking) orbit.autoRotate = false;
    gestures.update(hands, dt, time);
  }

  function onKey(key) {
    if (key === 'e') playTo(0, 1);
    if (key === 'a') playTo(1, 1);
    if (key === ' ') {
      const p = current?.choreo.getProgress() ?? 1;
      playTarget = playTarget === null ? (p > 0.5 ? 0 : 1) : null;
      playSpeed = 1;
    }
    if (key === 'arrowright') stepBy(1);
    if (key === 'arrowleft') stepBy(-1);
  }

  return { load, unload, update, onHands, onKey, stage, orbit, get current() { return current; } };
}
