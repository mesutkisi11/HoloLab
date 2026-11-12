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

export const MODEL_VIEW = { position: new THREE.Vector3(1.1, 0.7, 1.3), target: new THREE.Vector3(0, 0.2, 0) };

// Model ekranı: tek bir modelin sökülüp birleştirildiği sahne.
export function createModelScreen(app, { hud, handVisuals, onBackToGallery, onGrabStart, onGrabRelease }) {
  const { scene, camera, canvas } = app;

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.copy(MODEL_VIEW.target);
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
  let active = false;
  let playTarget = null;
  let playSpeed = 1;
  let slowMo = false;
  let stageScaleTarget = 1;
  let closing = null;
  let grabbedModel = null; // { origin } kavranmış model (çöp için)
  let frozen = false; // çöp animasyonu sırasında sahne dokunulmaz
  let focus = null; // { id, savedTarget, savedPos } yakından gösterilen parça
  const camGoal = { target: new THREE.Vector3(), position: new THREE.Vector3(), active: false };
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
  createMouseControls({ canvas, camera, grab, orbit, ring: targetRing, getPart, isActive: () => active });

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

  const gestureCtx = {
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
    // Modeli kavrama (çöpe atmak için)
    grabModel() {
      if (!current || grabbedModel) return false;
      grabbedModel = { origin: stage.position.clone() };
      stageScaleTarget = 0.85;
      onGrabStart?.(stage);
      return true;
    },
    moveModel(worldPos) {
      if (grabbedModel) stage.position.copy(worldPos);
    },
    releaseModel(velocity, hand) {
      if (!grabbedModel) return;
      const origin = grabbedModel.origin;
      grabbedModel = null;
      stageScaleTarget = 1;
      onGrabRelease?.(current?.def, velocity, hand, {
        root: stage,
        returnHome: () => {
          frozen = false;
          stage.position.copy(origin);
          stage.visible = true;
        },
        freeze: () => (frozen = true),
      });
    },
    isModelGrabbed: () => !!grabbedModel,
    layerBounds: () => current?.choreo.layerBounds() ?? [0, 1],
    layerNameAt: (p) => current?.choreo.layerNameAt(p) ?? null,
    // Parça sökülmüş mü (yerinde değil)?
    isDetached(id) {
      const st = current?.choreo.getStep(id);
      return !!st && st.s < 0.999;
    },
    focus: focusPart,
    unfocus: unfocusPart,
    focusedId: () => focus?.id ?? null,
    hud,
    visuals: handVisuals,
    ring: targetRing,
    grab,
    getPart,
    planeDistance: () => camera.position.distanceTo(orbit.target),
  };
  const gestures = createModelGestures(gestureCtx);

  // Klavye yedeği (Delete): modeli çöpe atmış gibi davran
  function forceTrash() {
    if (!current || !gestureCtx.grabModel()) return;
    gestureCtx.releaseModel({ x: 3, y: 3 }, { palm: { x: 0.9, y: 0.9 } });
  }

  // Parçayı yakından göster: kamera parçaya yaklaşır, diğerleri sönükleşir
  function focusPart(id) {
    const part = getPart(id);
    if (!part || !current) return;
    if (!focus) focus = { savedTarget: orbit.target.clone(), savedPos: camera.position.clone() };
    focus.id = id;
    const box = new THREE.Box3().setFromObject(part);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(orbit.target).normalize();
    camGoal.target.copy(center);
    camGoal.position.copy(center).addScaledVector(dir, Math.max(0.35, size * 2.6));
    camGoal.active = true;
    for (const p of current.parts) {
      const u = p.userData.part.material.uniforms;
      u.uOpacity.value = p === part ? 1 : 0.12;
      p.userData.part.edgeMaterial.opacity = p === part ? 0.6 : 0.04;
    }
    setPartHighlight(part, 1);
    hud.showGesture(part.userData.part.name);
  }

  function unfocusPart() {
    if (!focus || !current) return;
    camGoal.target.copy(focus.savedTarget);
    camGoal.position.copy(focus.savedPos);
    camGoal.active = true;
    for (const p of current.parts) {
      p.userData.part.material.uniforms.uOpacity.value = 1;
      p.userData.part.edgeMaterial.opacity = 0.3;
    }
    focus = null;
  }

  async function resolveChoreography(def, root, parts) {
    if (def.choreoData) return def.choreoData;
    if (def.choreo) {
      const res = await fetch(import.meta.env.BASE_URL + def.choreo);
      return res.json();
    }
    const auto = generateAutoChoreography(root, parts);
    if (!auto) {
      hud.showGesture('Bu model ayrı parçalardan oluşmuyor');
      return { model: root.name, steps: [] };
    }
    return auto;
  }

  async function load(def, { startProgress = 1 } = {}) {
    unload();
    const root = await def.build();
    const ghost = createGhost(root);
    stage.add(root, ghost);
    const parts = collectParts(root);

    const data = await resolveChoreography(def, root, parts);
    const choreo = createChoreography(parts, data);
    const trails = createTrails(scene, parts);

    // Final: tüm parçalar oturunca hologram dalgası + pervane dönüşü
    const finale = { waveT: -1, spinT: -1, spin: data.final?.spin ?? null };
    choreo.on('complete', () => {
      finale.waveT = 0;
      finale.spinT = 0;
    });

    current = { def, root, ghost, parts, choreo, trails, finale, data };
    const urlProgress = new URLSearchParams(location.search).get('p');
    choreo.setProgress(urlProgress !== null ? Number(urlProgress) : startProgress);
    slider.set(choreo.getProgress());
    document.title = `HoloLab · ${def.name}`;
    return current;
  }

  // Galeriden açılış: küçükten büyür, sökülmüş halden birleşir
  async function open(def) {
    setActive(true);
    stage.scale.setScalar(0.15);
    stageScaleTarget = 1;
    stage.rotation.set(0, 0, 0);
    await load(def, { startProgress: 0 });
    playTo(1, 1);
  }

  // Galeriye dönüş: küçülüp kaybolur
  function close() {
    return new Promise((resolve) => {
      stageScaleTarget = 0.01;
      closing = resolve;
    });
  }

  // Silme sonrası: animasyonsuz kapat
  function closeImmediate() {
    frozen = false;
    unload();
    setActive(false);
    stage.position.set(0, 0.28, 0);
    stage.scale.setScalar(1);
  }

  function unload() {
    if (!current) return;
    focus = null;
    camGoal.active = false;
    stage.remove(current.root, current.ghost);
    current.trails.dispose();
    current = null;
  }

  function setActive(v) {
    active = v;
    orbit.enabled = v;
    ring.group.visible = v;
    stage.visible = v;
    slider.show(v);
    if (!v) targetRing.set(null, false);
  }

  function update(dt, time) {
    if (camGoal.active) {
      camera.position.lerp(camGoal.position, 1 - Math.exp(-6 * dt));
      orbit.target.lerp(camGoal.target, 1 - Math.exp(-6 * dt));
      if (camera.position.distanceTo(camGoal.position) < 0.004) camGoal.active = false;
    }
    if (active) orbit.update();
    ring.update(dt);
    targetRing.update(dt);

    if (frozen) return;
    const s = THREE.MathUtils.damp(stage.scale.x, stageScaleTarget, 8, dt);
    stage.scale.setScalar(s);
    if (closing && s < 0.03) {
      const done = closing;
      closing = null;
      unload();
      setActive(false);
      done();
    }

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

    if (!grabbedModel) {
      for (const part of parts) {
        const data = part.userData.part;
        const target = choreo.isMoving(data.id) || focus?.id === data.id ? 1 : 0;
        const next = THREE.MathUtils.damp(data.highlight, target, 12, dt);
        if (Math.abs(next - data.highlight) > 0.001) setPartHighlight(part, next);
      }
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
    if (!active || closing || frozen) return;
    if (tracking) orbit.autoRotate = false;
    gestures.update(hands, dt, time);
  }

  function onKey(key) {
    if (!active) return;
    if (key === 'e') playTo(0, 1);
    if (key === 'a') playTo(1, 1);
    if (key === ' ') {
      const p = current?.choreo.getProgress() ?? 1;
      playTarget = playTarget === null ? (p > 0.5 ? 0 : 1) : null;
      playSpeed = 1;
    }
    if (key === 'arrowright') stepBy(1);
    if (key === 'arrowleft') stepBy(-1);
    if (key === 'f') unfocusPart();
  }

  // Fare yedeği: sökülmüş parçaya çift tık = yakından göster, boşluğa çift tık = çık
  canvas.addEventListener('dblclick', (e) => {
    if (!active) return;
    const id = grab.hoverAt((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    if (id && gestureCtx.isDetached(id)) focusPart(id);
    else unfocusPart();
  });

  return {
    load,
    open,
    close,
    closeImmediate,
    forceTrash,
    unload,
    update,
    onHands,
    onKey,
    setActive,
    playTo,
    stage,
    orbit,
    isActive: () => active,
    get current() {
      return current;
    },
  };
}
