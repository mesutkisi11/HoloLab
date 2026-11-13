import * as THREE from 'three';
import { setModelOpacity, fitScale, collectParts, bindModelUniforms } from '../models/partBuilder.js';
import { createGalleryGestures } from '../hands/galleryGestures.js';
import { clamp01, easeInOutCubic } from '../choreo/easing.js';
import { HOLO_CYAN, HOLO_ORANGE, sharedTime } from '../scene/hologramMaterial.js';

export const GALLERY_CENTER = new THREE.Vector3(0, 0.3, 0);
const ARC_RADIUS = 1.4;
const ARC_STEP = 0.55; // radyan: komşu tasarımlar arası açı
const PREVIEW_SIZE = 0.62;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

// Her tasarımın altındaki küçük projektör kaidesi
const pedestalMaterial = () =>
  new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uTime: sharedTime, uColor: { value: HOLO_CYAN.clone() }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      float ring(float r, float r0, float w) { return 1.0 - smoothstep(w, w + fwidth(r) * 1.5, abs(r - r0)); }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x) / 6.2831853 + 0.5;
        float dash = step(0.5, fract(a * 16.0 + uTime * 0.08));
        float v = ring(r, 0.95, 0.01) * 0.8 + ring(r, 0.8, 0.008) * dash * 0.7 + ring(r, 0.35, 0.01) * 0.4;
        v += exp(-r * 6.0) * 0.25;
        gl_FragColor = vec4(uColor, v * uAlpha);
      }
    `,
  });

// "+ Tasarım ekle" yuvası: kesikli çerçeve + artı işareti
function createAddSlot() {
  const group = new THREE.Group();
  const pts = [];
  const s = 0.2;
  const dashes = 10;
  for (const [ax, ay, bx, by] of [
    [-s, -s, s, -s],
    [s, -s, s, s],
    [s, s, -s, s],
    [-s, s, -s, -s],
  ]) {
    for (let i = 0; i < dashes; i++) {
      const t0 = i / dashes;
      const t1 = (i + 0.55) / dashes;
      pts.push(ax + (bx - ax) * t0, ay + (by - ay) * t0, 0, ax + (bx - ax) * t1, ay + (by - ay) * t1, 0);
    }
  }
  pts.push(-0.08, 0, 0, 0.08, 0, 0, 0, -0.08, 0, 0, 0.08, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: HOLO_CYAN, opacity: 0.9, ...additive });
  const lines = new THREE.LineSegments(geo, mat);
  group.add(lines);
  return { group, mat };
}

// Galeri ekranı: tasarımlar yay üzerinde dönen küçük hologramlar olarak durur.
export function createGalleryScreen(app, { hud, handVisuals, sounds, registry, onOpen, onAdd, onGrabStart, onGrabRelease }) {
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
  let revealClock = 0;

  function makeHolder(isAdd = false) {
    const holder = new THREE.Group();
    const pedestal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), pedestalMaterial());
    pedestal.rotation.x = -Math.PI / 2;
    pedestal.position.y = -PREVIEW_SIZE * 0.55;
    pedestal.raycast = () => {};
    holder.add(pedestal);
    // Görünmez tıklama alanı (fare ile seçmek için)
    const hit = new THREE.Mesh(new THREE.SphereGeometry(PREVIEW_SIZE * 0.55, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.isHit = true;
    holder.add(hit);
    holder.userData.isAdd = isAdd;
    return { holder, pedestal, hit };
  }

  async function rebuild(selectId = null) {
    for (const it of items) group.remove(it.holder);
    items = [];
    floating.clear();
    for (const design of registry.list) {
      if (design.id === pendingHide) continue;
      const { holder, pedestal, hit } = makeHolder();
      let root;
      try {
        root = await design.build();
      } catch (err) {
        console.warn(`Tasarım açılamadı: ${design.name}`, err);
        continue;
      }
      bindModelUniforms(root);
      root.scale.setScalar(fitScale(root, PREVIEW_SIZE));
      const box = new THREE.Box3().setFromObject(root);
      root.position.sub(box.getCenter(new THREE.Vector3()));
      holder.add(root);
      group.add(holder);
      const parts = collectParts(root);
      items.push({ design, holder, root, pedestal, hit, parts, spin: items.length * 1.3, opacity: -1, partCount: parts.length });
    }
    // En sonda "+" yuvası
    const add = makeHolder(true);
    const slot = createAddSlot();
    add.holder.add(slot.group);
    group.add(add.holder);
    items.push({ isAdd: true, design: null, holder: add.holder, pedestal: add.pedestal, hit: add.hit, slot, spin: 0, opacity: 1 });

    if (selectId) {
      const i = items.findIndex((it) => it.design?.id === selectId);
      if (i >= 0) target = cursor = i;
    }
    target = clampIndex(target);
    cursor = clampIndex(cursor);
    revealClock = 0;
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
    const total = items.length - 1;
    if (it.isAdd) {
      label.innerHTML = `<span class="g-index">+</span>Tasarım ekle<small>tıkla ya da dosyayı pencereye sürükle · GLB GLTF OBJ STL FBX STEP IGES</small>`;
    } else {
      const idx = String(selectedIndex() + 1).padStart(2, '0');
      label.innerHTML = `<span class="g-index">${idx} / ${String(total).padStart(2, '0')}</span>${it.design.name}<small>${it.design.format ?? ''} · ${it.partCount} parça</small>`;
    }
    label.classList.add('visible');
  }

  function layout(dt, time) {
    revealClock += dt;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (grabbed?.item === it || floating.has(it) || opening?.item === it) continue;
      const d = i - cursor;
      const angle = d * ARC_STEP;
      const closeness = 1 - Math.min(1, Math.abs(d));
      const float = Math.sin(time * 1.2 + i) * 0.008;
      it.holder.position.set(Math.sin(angle) * ARC_RADIUS, closeness * 0.08 + float, -(1 - Math.cos(angle)) * ARC_RADIUS);
      it.holder.rotation.y = -angle * 0.6;
      it.holder.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, closeness));
      it.spin += dt * (0.2 + closeness * 0.25);
      it.pedestal.material.uniforms.uAlpha.value = THREE.MathUtils.lerp(0.25, 1, closeness);

      if (it.isAdd) {
        const pulse = 0.75 + 0.25 * Math.sin(time * 3);
        it.slot.group.rotation.y = Math.sin(time * 0.6) * 0.4;
        it.slot.mat.opacity = THREE.MathUtils.lerp(0.3, 1, closeness) * pulse;
        it.slot.mat.color.copy(HOLO_CYAN).lerp(HOLO_ORANGE, closeness * 0.35);
        continue;
      }
      it.root.rotation.y = it.spin;
      const op = THREE.MathUtils.lerp(0.28, 1, closeness);
      if (Math.abs(op - it.opacity) > 0.01) {
        it.opacity = op;
        setModelOpacity(it.root, op, it.parts);
      }
      // Galeri açılırken önizlemeler sırayla aşağıdan yukarı belirir
      const k = clamp01((revealClock - i * 0.09) / 0.7);
      const u = it.root.userData.uniforms;
      if (k < 1) {
        it.holder.updateMatrixWorld(true);
        const y = it.holder.getWorldPosition(new THREE.Vector3()).y;
        const half = PREVIEW_SIZE * 0.6 * it.holder.scale.x;
        u.uReveal.value = THREE.MathUtils.lerp(y - half, y + half, easeInOutCubic(k));
      } else if (u.uReveal.value !== 1000) u.uReveal.value = 1000;
    }
  }

  function update(dt, time) {
    if (!visible) return;
    const prev = Math.round(cursor);
    cursor = THREE.MathUtils.damp(cursor, target, 8, dt);
    if (Math.round(cursor) !== prev) updateLabel();
    layout(dt, time);

    if (opening) {
      opening.t += dt;
      const k = easeInOutCubic(clamp01(opening.t / 0.55));
      const h = opening.item.holder;
      h.position.lerpVectors(opening.from, new THREE.Vector3(0, -0.02, 0.25), k);
      h.scale.setScalar(THREE.MathUtils.lerp(1, 1.8, k));
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
    if (v) revealClock = 0;
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

  // fromUserClick: tarayıcı, dosya seçiciyi sadece tıklama/tuş içinden açmaya izin verir
  function openSelected(fromUserClick = false) {
    const it = selected();
    if (!it || opening) return;
    snap();
    if (it.isAdd) {
      if (fromUserClick) onAdd?.();
      else hud.showGesture('Dosya seçmek için tıkla ya da sürükle-bırak');
      return;
    }
    opening = { item: it, t: 0, from: it.holder.position.clone() };
    sounds?.whoosh();
    hud.showGesture('Aç');
  }

  // Kavrama (çöpe atma için): seçili tasarım eli takip eder
  function grabSelected() {
    const it = selected();
    if (!it || it.isAdd || grabbed) return null;
    grabbed = { item: it };
    onGrabStart?.(it.holder);
    return it;
  }
  function moveGrabbed(worldPos) {
    if (!grabbed) return;
    grabbed.item.holder.position.lerp(group.worldToLocal(worldPos.clone()), 0.6);
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
    openSelected: () => openSelected(false),
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

  // Fare / dokunma: yatay sürükle = kaydır, tekerlek = kaydır, yandakine tıkla = seç, ortadakine tıkla = aç
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function itemAt(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(items.map((it) => it.hit), false)[0];
    return hit ? items.findIndex((it) => it.hit === hit.object) : -1;
  }

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
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return snap();
    const i = itemAt(e);
    if (i >= 0 && i !== selectedIndex()) {
      target = i;
      sounds?.whoosh();
      updateLabel();
    } else if (i === selectedIndex()) {
      openSelected(true);
    }
  });
  canvas.addEventListener('wheel', (e) => {
    if (!visible) return;
    moveBy(Math.sign(e.deltaY + e.deltaX));
  });

  function onKey(key) {
    if (key === 'arrowright') moveBy(1);
    if (key === 'arrowleft') moveBy(-1);
    if (key === 'enter') openSelected(true);
  }

  return {
    rebuild,
    setPendingHide: (id) => (pendingHide = id),
    update,
    setVisible,
    onKey,
    onHands: (hands, dt, time) => visible && !opening && gestures.update(hands, dt, time),
    selected: () => (selected()?.isAdd ? null : selected()),
    selectAdd() {
      target = items.length - 1;
      updateLabel();
    },
    group,
    isVisible: () => visible,
  };
}
