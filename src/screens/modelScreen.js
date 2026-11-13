import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGhost } from '../scene/ghost.js';
import { createTargetRing } from '../scene/targetRing.js';
import { createAssemblyFx } from '../scene/assemblyFx.js';
import { sharedWave } from '../scene/hologramMaterial.js';
import {
  collectParts,
  setPartHighlight,
  setPartOpacity,
  bindModelUniforms,
  partBounds,
} from '../models/partBuilder.js';
import { createChoreography } from '../choreo/choreography.js';
import { generateAutoChoreography } from '../choreo/autoChoreo.js';
import { createTrails } from '../choreo/trail.js';
import { createPartGrab } from '../interaction/partGrab.js';
import { createMouseControls } from '../interaction/mouseControls.js';
import { createModelGestures } from '../hands/modelGestures.js';
import { createSlider } from '../ui/slider.js';
import { createFocusAnnotations } from '../ui/focusAnnotations.js';
import { easeInOutCubic } from '../choreo/easing.js';

const STAGE_Y = 0.28;
// Açılışta kameranın modele baktığı yön (3/4 açı, hafif yukarıdan)
const VIEW_DIR = new THREE.Vector3(0.62, 0.42, 0.66).normalize();

// Model ekranı: tek bir modelin sökülüp birleştirildiği sahne.
export function createModelScreen(app, { hud, handVisuals, sounds, env, onBackToGallery, onGrabStart, onGrabRelease }) {
  const { scene, camera, canvas } = app;

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, STAGE_Y, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.autoRotate = true;
  orbit.autoRotateSpeed = 0.5;
  orbit.minDistance = 0.2;
  orbit.maxDistance = 6;
  orbit.enabled = false;

  // Model + hayalet "stage" içinde; elle döndürme stage'i çevirir
  const stage = new THREE.Group();
  stage.position.y = STAGE_Y;
  scene.add(stage);

  const targetRing = createTargetRing(scene, camera);
  const fx = createAssemblyFx(scene, camera);
  const annotations = createFocusAnnotations(camera, canvas);
  const slider = createSlider((p) => {
    playTarget = null;
    current?.choreo.setProgress(p);
  });
  slider.show(false);

  let current = null;
  let active = false;
  let playTarget = null;
  let playSpeed = 1;
  let playDelay = 0;
  let slowMo = false;
  let closing = null;
  let grabbedModel = null; // { origin } kavranmış model (çöp için)
  let frozen = false; // çöp animasyonu sırasında sahne dokunulmaz
  let focus = null; // { id, savedTarget, savedPos }
  let reveal = null; // { from, to, t, duration, onDone } belirme/kaybolma animasyonu
  let cameraLock = false; // sinematik mod kamerayı yönetirken otomatik kadraj kapalı
  const spin = { x: 0, y: 0 }; // savrulma sonrası dönme hızı (rad/sn)
  const camGoal = { target: new THREE.Vector3(), position: new THREE.Vector3(), active: false, speed: 5 };
  const fit = { box: new THREE.Box3(), center: new THREE.Vector3(0, STAGE_Y, 0), radius: 0.4, dist: 1.6, ready: false };
  const spinAxis = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const getPart = (id) => current?.byId.get(id) ?? null;
  const grab = createPartGrab({
    get choreo() {
      return current?.choreo;
    },
    get root() {
      return current?.root;
    },
    camera,
  });
  createMouseControls({ canvas, camera, grab, orbit, ring: targetRing, getPart, isActive: () => active && !frozen });

  function playTo(target, speed = 1, delay = 0) {
    playTarget = target;
    playSpeed = speed;
    playDelay = delay;
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
    explode() {
      env.setEnergy(1);
      app.glitch(0.6);
      setTimeout(() => app.glitch(0), 140);
      playTo(0, 3);
    },
    fullAssemble() {
      current?.choreo.clearOverrides();
      env.setEnergy(1);
      playTo(1, 1);
    },
    // yawDelta: sürüklemeden gelen dönüş (radyan), dy: dikey sürükleme, twist: el çevirme (radyan)
    rotate(yawDelta, dy, twist = 0) {
      spin.x = 0;
      spin.y = 0;
      stage.rotation.y += yawDelta - twist;
      stage.rotation.x = THREE.MathUtils.clamp(stage.rotation.x + dy * 3, -0.7, 0.7);
    },
    // Bırakılan dönme: elin hızıyla savrulur, sürtünmeyle yavaşlar
    rotateRelease(vx, vy, twistVel = 0) {
      spin.y = THREE.MathUtils.clamp(vx * 7 - twistVel, -14, 14);
      spin.x = THREE.MathUtils.clamp(vy * 3, -4, 4);
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
      if (!current || grabbedModel || reveal) return false;
      unfocusPart();
      grabbedModel = { origin: stage.position.clone() };
      onGrabStart?.(stage);
      return true;
    },
    moveModel(worldPos) {
      if (grabbedModel) stage.position.lerp(worldPos, 0.6);
    },
    releaseModel(velocity, hand) {
      if (!grabbedModel) return;
      const origin = grabbedModel.origin;
      grabbedModel = null;
      onGrabRelease?.(current?.def, velocity, hand, {
        root: stage,
        returnHome: () => {
          frozen = false;
          stage.position.copy(origin);
          stage.scale.setScalar(1);
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
      return !!st && (st.s < 0.999 || !!st.float);
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

  // --- Parçayı yakından incele: kamera yaklaşır, diğerleri söner, ölçü çizgileri çıkar ---
  function focusPart(id) {
    const part = getPart(id);
    if (!part || !current) return;
    if (!focus) focus = { savedTarget: orbit.target.clone(), savedPos: camera.position.clone() };
    focus.id = id;
    const b = current.bounds.get(id);
    const center = part.localToWorld(b.center.clone());
    const dir = camera.position.clone().sub(orbit.target).normalize();
    camGoal.target.copy(center);
    camGoal.position.copy(center).addScaledVector(dir, Math.max(0.22, b.radius * 3.4));
    camGoal.active = true;
    camGoal.speed = 5;
    for (const p of current.parts) setPartOpacity(p, p === part ? 1 : 0.1);
    current.ghost.userData.material.uniforms.uOpacity.value = 0.3;
    setPartHighlight(part, 1);
    annotations.show(part, current.root.userData.mmPerUnit ?? 1000);
    sounds?.click();
  }

  function unfocusPart() {
    if (!focus || !current) return;
    camGoal.target.copy(focus.savedTarget);
    camGoal.position.copy(focus.savedPos);
    camGoal.active = true;
    camGoal.speed = 5;
    for (const p of current.parts) setPartOpacity(p, 1);
    current.ghost.userData.material.uniforms.uOpacity.value = 1;
    annotations.hide();
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
    const shared = bindModelUniforms(root);
    const ghost = createGhost(root, shared);
    stage.add(root, ghost);
    stage.updateMatrixWorld(true);
    const parts = collectParts(root);
    // Her parçanın kendi sınırları (kadraj, bağ çizgileri, inceleme için)
    const bounds = new Map(parts.map((p) => [p.userData.part.id, partBounds(p)]));

    const data = await resolveChoreography(def, root, parts);
    const choreo = createChoreography(parts, data);
    const trails = createTrails(scene, parts);
    fx.attach(choreo.steps, root);

    // Final: tüm parçalar oturunca hologram dalgası + pervane dönüşü
    const finale = { waveT: -1, spinT: -1, spin: data.final?.spin ?? null };
    choreo.on('complete', () => {
      finale.waveT = 0;
      finale.spinT = 0;
      env.triggerScan();
      sounds?.chime();
    });
    choreo.on('seated', (step) => {
      fx.onSeated(step);
      env.setEnergy(0.6);
      sounds?.click();
    });
    choreo.on('unseated', () => sounds?.click());

    current = {
      def,
      root,
      ghost,
      parts,
      byId: new Map(parts.map((p) => [p.userData.part.id, p])),
      bounds,
      shared,
      choreo,
      trails,
      finale,
      data,
    };
    const urlProgress = new URLSearchParams(location.search).get('p');
    choreo.setProgress(urlProgress !== null ? Number(urlProgress) : startProgress);
    choreo.update(0);
    slider.set(choreo.getProgress());
    computeFit(true);
    document.title = `HoloLab · ${def.name}`;
    return current;
  }

  // Galeriden açılış: sökülmüş halde aşağıdan yukarı belirir, sonra birleşerek kurulur
  async function open(def) {
    setActive(true);
    stage.rotation.set(0, 0, 0);
    stage.position.set(0, STAGE_Y, 0);
    stage.scale.setScalar(1);
    spin.x = spin.y = 0;
    await load(def, { startProgress: 0 });
    // Kamera: açılış yönünden modele uç
    camGoal.target.copy(fit.center);
    camGoal.position.copy(fit.center).addScaledVector(VIEW_DIR, fit.dist);
    camGoal.active = true;
    camGoal.speed = 3;
    startReveal(true, 1.1);
    env.triggerScan();
    // Test için ?p=0.5 verilirse o ilerlemede bekle, yoksa birleşerek kurul
    if (new URLSearchParams(location.search).get('p') === null) playTo(1, 1, 0.9);
  }

  // Galeriye dönüş: yukarıdan aşağı kaybolur
  function close() {
    unfocusPart();
    closing = true;
    return new Promise((resolve) => {
      startReveal(false, 0.55, () => {
        unload();
        setActive(false);
        resolve();
      });
    });
  }

  function startReveal(appear, duration, onDone) {
    if (!current) return onDone?.();
    const lo = fit.box.min.y - 0.06;
    const hi = fit.box.max.y + 0.06;
    reveal = { from: appear ? lo : hi, to: appear ? hi : lo, t: 0, duration, onDone };
    current.shared.uReveal.value = reveal.from;
  }

  // Silme sonrası: animasyonsuz kapat
  function closeImmediate() {
    frozen = false;
    unload();
    setActive(false);
    stage.position.set(0, STAGE_Y, 0);
    stage.scale.setScalar(1);
  }

  function unload() {
    if (!current) return;
    annotations.hide();
    focus = null;
    reveal = null;
    camGoal.active = false;
    fx.detach();
    stage.remove(current.root, current.ghost);
    current.trails.dispose();
    current = null;
    closing = null;
  }

  function setActive(v) {
    active = v;
    orbit.enabled = v;
    stage.visible = v;
    slider.show(v);
    env.setGyroVisible(v);
    if (!v) targetRing.set(null, false);
  }

  // Tüm parçaların şu anki kapladığı alan -> kadraj mesafesi
  function computeFit(instant = false) {
    if (!current) return;
    const box = fit.box.makeEmpty();
    for (const part of current.parts) {
      const b = current.bounds.get(part.userData.part.id);
      part.localToWorld(tmp.copy(b.center));
      box.expandByPoint(tmp.clone().addScalar(b.radius));
      box.expandByPoint(tmp.addScalar(-2 * b.radius));
    }
    box.min.y = Math.max(box.min.y, 0.02);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.12, box.getSize(new THREE.Vector3()).length() * 0.5);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.66;
    if (instant || !fit.ready) {
      fit.center.copy(center);
      fit.radius = radius;
      fit.dist = dist;
      fit.ready = true;
    }
    return { center, radius, dist };
  }

  // Patlatınca uzaklaş, birleşince yaklaş: kullanıcının yakınlaştırma oranı korunur
  function autoFrame(dt) {
    const next = computeFit();
    if (!next) return;
    env.setModelBounds(fit.box);
    if (cameraLock || camGoal.active || focus || grabbedModel || frozen) {
      fit.center.copy(next.center);
      fit.radius = next.radius;
      fit.dist = next.dist;
      return;
    }
    const prevDist = fit.dist;
    fit.dist = THREE.MathUtils.damp(fit.dist, next.dist, 2.2, dt);
    fit.radius = next.radius;
    fit.center.x = THREE.MathUtils.damp(fit.center.x, next.center.x, 2.2, dt);
    fit.center.y = THREE.MathUtils.damp(fit.center.y, next.center.y, 2.2, dt);
    fit.center.z = THREE.MathUtils.damp(fit.center.z, next.center.z, 2.2, dt);
    const ratio = fit.dist / Math.max(prevDist, 1e-4);
    const offset = camera.position.clone().sub(orbit.target).multiplyScalar(ratio);
    orbit.target.copy(fit.center);
    camera.position.copy(fit.center).add(offset);
  }

  function update(dt, time) {
    if (!active && !current) return;

    if (camGoal.active) {
      const k = 1 - Math.exp(-camGoal.speed * dt);
      camera.position.lerp(camGoal.position, k);
      orbit.target.lerp(camGoal.target, k);
      if (camera.position.distanceTo(camGoal.position) < 0.003) camGoal.active = false;
    }
    // İnceleme modunda kamera parçanın etrafında yavaşça döner
    if (focus && !camGoal.active && !cameraLock) {
      tmp.copy(camera.position).sub(orbit.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.25);
      camera.position.copy(orbit.target).add(tmp);
    }
    if (active && orbit.enabled) orbit.update();
    targetRing.update(dt);

    if (frozen || !current) return;
    const { choreo, parts, trails, root } = current;

    // Belirme / kaybolma
    if (reveal) {
      reveal.t += dt / reveal.duration;
      const e = easeInOutCubic(Math.min(1, reveal.t));
      current.shared.uReveal.value = THREE.MathUtils.lerp(reveal.from, reveal.to, e);
      if (reveal.t >= 1) {
        const done = reveal.onDone;
        current.shared.uReveal.value = reveal.to > reveal.from ? 1000 : -1000;
        reveal = null;
        done?.();
        if (!current) return;
      }
    }

    // Savrulan model sürtünmeyle yavaşlar
    if (spin.x || spin.y) {
      stage.rotation.y += spin.y * dt;
      stage.rotation.x = THREE.MathUtils.clamp(stage.rotation.x + spin.x * dt, -0.7, 0.7);
      const decay = Math.exp(-1.6 * dt);
      spin.x *= decay;
      spin.y *= decay;
      if (Math.abs(spin.x) + Math.abs(spin.y) < 0.01) spin.x = spin.y = 0;
    }
    // Kavranan model: hafif küçülür
    const targetScale = grabbedModel ? 0.85 : 1;
    stage.scale.setScalar(THREE.MathUtils.damp(stage.scale.x, targetScale, 10, dt));

    // Otomatik oynatma: hedefe doğru sabit hızla
    if (playTarget !== null) {
      if (playDelay > 0) playDelay -= dt;
      else {
        const p = choreo.getProgress();
        const step = (dt / choreo.duration) * playSpeed * (slowMo ? 0.25 : 1);
        const next = p < playTarget ? Math.min(playTarget, p + step) : Math.max(playTarget, p - step);
        choreo.setProgress(next);
        slider.set(next);
        if (next === playTarget) playTarget = null;
      }
    }

    choreo.update(dt);
    grab.update(dt);
    trails.update(dt, choreo.isMoving);
    fx.update(dt, focus ? 0.3 : 1);
    annotations.update();

    // Sesler ve ortam enerjisi: hareket varsa vızıltı, dönen vida varsa tıkırtı
    let moving = 0;
    let screwing = false;
    for (const st of choreo.steps) {
      if (st.locked || (st.s > 0.001 && st.s < 0.999)) {
        moving++;
        if (st.screwTurns && st.s !== st.prevS) screwing = true;
      }
    }
    if (moving) env.setEnergy(Math.min(0.5, moving * 0.08));
    sounds?.hum(active && moving > 0);
    if (screwing) sounds?.tick(time);

    if (!grabbedModel) {
      for (const part of parts) {
        const data = part.userData.part;
        const target = choreo.isMoving(data.id) || focus?.id === data.id ? 1 : 0;
        const next = THREE.MathUtils.damp(data.highlight, target, 12, dt);
        if (Math.abs(next - data.highlight) > 0.001) setPartHighlight(part, next);
      }
    }

    updateFinale(dt, root);
    autoFrame(dt);
  }

  function updateFinale(dt) {
    const { finale, parts } = current;
    if (finale.waveT >= 0) {
      finale.waveT += dt;
      const t = finale.waveT / 1.2;
      sharedWave.value = THREE.MathUtils.lerp(fit.box.min.y - 0.1, fit.box.max.y + 0.1, t);
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
    if (!active || closing || frozen || reveal) return;
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

  // Fare yedeği: sökülmüş parçaya çift tık = yakından incele, boşluğa çift tık = çık
  canvas.addEventListener('dblclick', (e) => {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    const id = grab.hoverAt(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    if (id && gestureCtx.isDetached(id)) focusPart(id);
    else unfocusPart();
  });

  return {
    load,
    open,
    close,
    closeImmediate,
    forceTrash,
    // Mevcut koreografiyi JSON olarak ver (dışa aktarma)
    exportChoreo: () => (current ? { def: current.def, data: current.data } : null),
    unload,
    update,
    onHands,
    onKey,
    setActive,
    playTo,
    setCameraLock: (v) => (cameraLock = v),
    getFit: () => fit,
    stats: () => (current ? { parts: current.parts.length, progress: current.choreo.getProgress() } : null),
    stage,
    orbit,
    isActive: () => active,
    get current() {
      return current;
    },
  };
}
