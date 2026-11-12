import * as THREE from 'three';
import { setModelOpacity, fitScale, collectParts } from '../models/partBuilder.js';
import { createGalleryGestures } from '../hands/galleryGestures.js';
import { clamp01, easeInOutCubic } from '../choreo/easing.js';

export const GALLERY_CENTER = new THREE.Vector3(0, 0.3, 0);
const ARC_RADIUS = 1.4;
const ARC_STEP = 0.55; // radyan: komşu tasarımlar arası açı
const PREVIEW_SIZE = 0.6;

// Galeri ekranı: tasarımlar yay üzerinde dönen küçük hologramlar olarak durur.
export function createGalleryScreen(app, { hud, handVisuals, sounds, registry, onOpen, onGrabStart, onGrabRelease }) {
  const { scene, camera, canvas } = app;
  const group = new THREE.Group();
  group.position.copy(GALLERY_CENTER);
  scene.add(group);

  const label = document.createElement('div');
  label.className = 'gallery-name';
  document.body.appendChild(label);

  let items = [];
  let cursor = 0; // kayan seçim (ondalık), hedefe doğru yumuşar
  let target = 0;
  let visible = true;
  let opening = null; // açılış animasyonu
  let grabbed = null; // { item } kavranmış tasarım (çöp için)
  const floating = new Set(); // bırakıldı ama animasyonu süren tasarımlar
  let pendingHide = null; // silinmek üzere olan tasarım id'si (geri al süresi)

  async function rebuild(selectId = null) {
    for (const it of items) group.remove(it.holder);
    items = [];
    floating.clear();
    for (const design of registry.list) {
      if (design.id === pendingHide) continue;
      const holder = new THREE.Group();
      const root = await design.build();
      root.scale.setScalar(fitScale(root, PREVIEW_SIZE));
      // Modeli tabanından değil merkezinden hizala
      const box = new THREE.Box3().setFromObject(root);
      root.position.sub(box.getCenter(new THREE.Vector3()));
      holder.add(root);
      group.add(holder);
      items.push({ design, holder, root, parts: collectParts(root), spin: Math.random() * Math.PI * 2, opacity: -1 });
    }
    if (selectId) {
      const i = items.findIndex((it) => it.design.id === selectId);
      if (i >= 0) {
        target = i;
        cursor = i;
      }
    }
    target = clampIndex(target);
    cursor = clampIndex(cursor);
    updateLabel();
  }

  const clampIndex = (v) => THREE.MathUtils.clamp(v, 0, Math.max(0, items.length - 1));
  const selectedIndex = () => Math.round(clampIndex(target));
  const selected = () => items[selectedIndex()] ?? null;

  function updateLabel() {
    const it = selected();
    if (!it || !visible) {
      label.classList.remove('visible');
      return;
    }
    label.innerHTML = `${it.design.name}<small>${it.design.isDemo ? 'demo model' : 'yüklenen tasarım'}</small>`;
    label.classList.add('visible');
  }

  function layout(dt, time) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (grabbed?.item === it || floating.has(it)) continue;
      const d = i - cursor;
      const angle = d * ARC_STEP;
      const closeness = 1 - Math.min(1, Math.abs(d));
      it.holder.position.set(Math.sin(angle) * ARC_RADIUS, closeness * 0.08, -(1 - Math.cos(angle)) * ARC_RADIUS);
      const scale = THREE.MathUtils.lerp(0.5, 1, closeness);
      it.holder.scale.setScalar(scale);
      it.spin += dt * (0.25 + closeness * 0.2);
      it.root.rotation.y = it.spin;
      const op = THREE.MathUtils.lerp(0.25, 1, closeness);
      if (Math.abs(op - it.opacity) > 0.01) {
        it.opacity = op;
        setModelOpacity(it.root, op, it.parts);
      }
    }
    void time;
  }

  function update(dt, time) {
    if (!visible) return;
    const prev = Math.round(cursor);
    cursor = THREE.MathUtils.damp(cursor, target, 8, dt);
    if (Math.round(cursor) !== prev) updateLabel();
    layout(dt, time);

    if (opening) {
      opening.t += dt;
      const k = easeInOutCubic(clamp01(opening.t / 0.6));
      const h = opening.item.holder;
      h.position.lerpVectors(opening.from, new THREE.Vector3(0, 0, 0.35), k);
      h.scale.setScalar(THREE.MathUtils.lerp(1, 2.2, k));
      setModelOpacity(opening.item.root, 1 - k, opening.item.parts);
      if (k >= 1) {
        const design = opening.item.design;
        opening = null;
        setVisible(false);
        onOpen(design);
      }
    }
  }

  function setVisible(v) {
    visible = v;
    group.visible = v;
    updateLabel();
  }

  function moveBy(delta) {
    const before = Math.round(target);
    target = clampIndex(target + delta);
    if (Math.round(target) !== before) sounds?.whoosh();
    updateLabel();
  }

  function setCursor(value) {
    target = clampIndex(value);
  }

  function snap(extra = 0) {
    const before = Math.round(cursor);
    target = clampIndex(Math.round(target + extra));
    if (Math.round(target) !== before) sounds?.whoosh();
    updateLabel();
  }

  function openSelected() {
    const it = selected();
    if (!it || opening) return;
    snap();
    opening = { item: it, t: 0, from: it.holder.position.clone() };
    hud.showGesture('Aç');
  }

  // Kavrama (çöpe atma için): seçili tasarım eli takip eder
  function grabSelected() {
    const it = selected();
    if (!it || grabbed) return null;
    grabbed = { item: it };
    onGrabStart?.(it.holder);
    return it;
  }
  function moveGrabbed(worldPos) {
    if (!grabbed) return;
    grabbed.item.holder.position.copy(group.worldToLocal(worldPos.clone()));
    grabbed.item.holder.scale.setScalar(0.85);
  }
  function releaseGrabbed() {
    if (!grabbed) return null;
    const it = grabbed.item;
    grabbed = null;
    floating.add(it);
    return it;
  }

  const gestures = createGalleryGestures({
    hud,
    visuals: handVisuals,
    moveBy,
    setCursor,
    getCursor: () => target,
    snap,
    openSelected,
    grabSelected,
    moveGrabbed,
    releaseGrabbed: (velocity, hand) => {
      const it = releaseGrabbed();
      if (!it) return;
      onGrabRelease?.(it.design, velocity, hand, {
        root: it.holder,
        returnHome: () => floating.delete(it),
      });
    },
    isGrabbing: () => !!grabbed,
    planeDistance: () => camera.position.distanceTo(GALLERY_CENTER),
  });

  // Fare / dokunma: yatay sürükle = kaydır, tekerlek = kaydır, tıkla = aç
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!visible || opening) return;
    drag = { x0: e.clientX, c0: target, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / window.innerWidth;
    if (Math.abs(dx) > 0.01) drag.moved = true;
    setCursor(drag.c0 - dx * 4);
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.moved) openSelected();
    else snap();
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    if (!visible) return;
    moveBy(Math.sign(e.deltaY + e.deltaX));
  });

  function onKey(key) {
    if (key === 'arrowright') moveBy(1);
    if (key === 'arrowleft') moveBy(-1);
    if (key === 'enter') openSelected();
  }

  return {
    rebuild,
    setPendingHide: (id) => (pendingHide = id),
    update,
    setVisible,
    onKey,
    onHands: (hands, dt, time) => visible && !opening && gestures.update(hands, dt, time),
    selected,
    group,
    isVisible: () => visible,
  };
}
