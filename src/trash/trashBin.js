import * as THREE from 'three';
import { createPart, addMesh, setModelOpacity } from '../models/partBuilder.js';
import { HOLO_CYAN, HOLO_ORANGE, HOLO_RED } from '../scene/hologramMaterial.js';
import { clamp01, easeInCubic, easeOutCubic } from '../choreo/easing.js';

const UNDO_SECONDS = 5;
const PARTICLES = 320;

// Hologram çöp kutusu: kameraya bağlı durur (ekranın sağ altında), kavrama sırasında belirir.
// throwIn(): nesne kutuya uçar, piksellere dağılır, kapak kapanır. Sonra 5 sn "Geri al" halkası.
export function createTrashBin(app, { hud }) {
  const { scene, camera } = app;
  scene.add(camera); // kameranın çocukları çizilsin diye kamera sahnede olmalı

  const bin = new THREE.Group();
  bin.position.set(0.62, -0.36, -1.3);
  bin.scale.setScalar(0.001);
  camera.add(bin);

  // Gövde + kapak, bizim parça sistemiyle (hologram malzemesi)
  const body = createPart({ id: 'trash_body', name: 'Çöp kutusu', parent: bin });
  addMesh(body, new THREE.CylinderGeometry(0.085, 0.07, 0.2, 20, 1, true));
  addMesh(body, new THREE.CylinderGeometry(0.07, 0.07, 0.004, 20), { position: [0, -0.1, 0] });
  for (let i = 0; i < 3; i++) {
    addMesh(body, new THREE.TorusGeometry(0.0775, 0.002, 6, 32), { position: [0, -0.07 + i * 0.07, 0], rotation: [Math.PI / 2, 0, 0] });
  }
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.1, -0.085);
  bin.add(lidPivot);
  const lid = createPart({ id: 'trash_lid', name: 'Kapak', parent: lidPivot, position: [0, 0, 0.085] });
  addMesh(lid, new THREE.CylinderGeometry(0.095, 0.095, 0.012, 20));
  addMesh(lid, new THREE.BoxGeometry(0.03, 0.02, 0.03), { position: [0, 0.015, 0] });
  lidPivot.rotation.x = -1.4; // açık kapak

  // Parçacıklar: dağılma efekti
  const pPos = new Float32Array(PARTICLES * 3);
  const pCol = new Float32Array(PARTICLES * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.012,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  particles.visible = false;
  particles.frustumCulled = false;
  scene.add(particles);

  // Geri al halkası (HTML/SVG)
  const undoEl = document.createElement('div');
  undoEl.className = 'undo-ring';
  undoEl.innerHTML = `
    <svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"/><circle class="fill" cx="24" cy="24" r="20"/></svg>
    <span>Geri al</span>`;
  document.body.appendChild(undoEl);
  const fillCircle = undoEl.querySelector('.fill');
  const CIRC = 2 * Math.PI * 20;
  fillCircle.style.strokeDasharray = String(CIRC);

  let shown = false;
  let lidTarget = -1.4;
  let anim = null; // { root, from, t, phase, onDone }
  let undo = null; // { t, onUndo, onExpire }
  const binWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  function show() {
    shown = true;
    lidTarget = -1.4;
  }
  function hide() {
    shown = false;
  }

  // Kutu ekranda nerede (NDC)?
  function screenPos() {
    bin.getWorldPosition(binWorld);
    ndc.copy(binWorld).project(camera);
    return { x: ndc.x, y: ndc.y };
  }

  // El bu kutuya doğru mu savruldu / kutuya yakın mı? (palm: 0..1 normalize, velocity: birim/sn)
  function isThrowTowards(palm, velocity) {
    const b = screenPos();
    const px = palm.x * 2 - 1;
    const py = -(palm.y * 2 - 1);
    const near = Math.hypot(px - b.x, py - b.y) < 0.35;
    const vx = velocity.x * 2;
    const vy = -velocity.y * 2;
    const speed = Math.hypot(vx, vy);
    const dx = b.x - px;
    const dy = b.y - py;
    const dlen = Math.hypot(dx, dy) || 1;
    const cos = (vx * dx + vy * dy) / (speed * dlen || 1);
    return near || (speed > 2.2 && cos > 0.7);
  }

  // Nesneyi kutuya uçur ve dağıt. demo=true ise kutuya varınca geri sektirir.
  function throwIn(root, { demo = false, onDone, onBounce } = {}) {
    bin.getWorldPosition(binWorld);
    anim = {
      root,
      from: { position: root.position.clone(), scale: root.scale.x },
      t: 0,
      phase: 'fly',
      demo,
      onDone,
      onBounce,
    };
    show();
  }

  function startUndo({ onUndo, onExpire }) {
    undo = { t: 0, onUndo, onExpire };
    undoEl.classList.add('visible');
  }

  function triggerUndo() {
    if (!undo) return false;
    const u = undo;
    undo = null;
    undoEl.classList.remove('visible');
    lidTarget = -1.4;
    hud.showGesture('Geri alındı');
    u.onUndo?.();
    return true;
  }

  function update(dt) {
    const target = shown || anim ? 1 : 0.001;
    bin.scale.setScalar(THREE.MathUtils.damp(bin.scale.x, target, 10, dt));
    lidPivot.rotation.x = THREE.MathUtils.damp(lidPivot.rotation.x, lidTarget, 8, dt);
    body.userData.part.material.uniforms.uHighlight.value = THREE.MathUtils.damp(
      body.userData.part.material.uniforms.uHighlight.value,
      anim || undo ? 1 : 0,
      8,
      dt,
    );

    if (undo) {
      undo.t += dt;
      const k = clamp01(undo.t / UNDO_SECONDS);
      fillCircle.style.strokeDashoffset = String(CIRC * k);
      if (k >= 1) {
        const u = undo;
        undo = null;
        undoEl.classList.remove('visible');
        hide();
        u.onExpire?.();
      }
    }

    if (!anim) {
      if (!undo) particles.visible = false;
      return;
    }
    anim.t += dt;
    const { root } = anim;
    bin.getWorldPosition(binWorld);

    if (anim.phase === 'fly') {
      const k = clamp01(anim.t / 0.55);
      const e = easeInCubic(k);
      // root'un ebeveyn uzayına çevir
      const local = root.parent ? root.parent.worldToLocal(binWorld.clone()) : binWorld.clone();
      root.position.lerpVectors(anim.from.position, local, e);
      root.scale.setScalar(THREE.MathUtils.lerp(anim.from.scale, anim.from.scale * 0.25, e));
      if (k >= 1) {
        if (anim.demo) {
          anim.phase = 'bounce';
          anim.t = 0;
          hud.showGesture('Demo model, silinemez');
        } else {
          anim.phase = 'burst';
          anim.t = 0;
          root.getWorldPosition(tmp);
          root.visible = false;
          for (let i = 0; i < PARTICLES; i++) {
            pPos[i * 3] = tmp.x + (Math.random() - 0.5) * 0.25;
            pPos[i * 3 + 1] = tmp.y + (Math.random() - 0.5) * 0.25;
            pPos[i * 3 + 2] = tmp.z + (Math.random() - 0.5) * 0.25;
          }
          particles.visible = true;
        }
      }
    } else if (anim.phase === 'bounce') {
      const k = clamp01(anim.t / 0.6);
      const e = easeOutCubic(k);
      const local = root.parent ? root.parent.worldToLocal(binWorld.clone()) : binWorld.clone();
      root.position.lerpVectors(local, anim.from.position, e);
      root.scale.setScalar(THREE.MathUtils.lerp(anim.from.scale * 0.25, anim.from.scale, e));
      if (k >= 1) {
        const a = anim;
        anim = null;
        hide();
        a.onBounce?.();
      }
    } else if (anim.phase === 'burst') {
      const k = clamp01(anim.t / 0.7);
      const pos = pGeo.attributes.position;
      const col = pGeo.attributes.color;
      const c = new THREE.Color().copy(HOLO_RED).lerp(HOLO_CYAN, k);
      for (let i = 0; i < PARTICLES; i++) {
        const ix = i * 3;
        const pull = 0.12 * easeInCubic(k) + dt * 2;
        pPos[ix] += (binWorld.x - pPos[ix]) * pull + (Math.random() - 0.5) * 0.004;
        pPos[ix + 1] += (binWorld.y - pPos[ix + 1]) * pull + (Math.random() - 0.5) * 0.004;
        pPos[ix + 2] += (binWorld.z - pPos[ix + 2]) * pull;
        const fade = 1 - k * 0.7;
        col.setXYZ(i, c.r * fade, c.g * fade, c.b * fade);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      if (k > 0.6) lidTarget = 0; // kapak kapanır
      if (k >= 1) {
        const a = anim;
        anim = null;
        particles.visible = false;
        a.onDone?.();
      }
    }
  }

  // Kavranmış modeli kırmızımsı boya
  function tintGrabbed(root, on) {
    for (const part of collectPartsSafe(root)) {
      const u = part.userData.part.material.uniforms;
      u.uHighlightColor.value.copy(on ? HOLO_RED : HOLO_ORANGE);
      u.uHighlight.value = on ? 0.85 : 0;
    }
    if (!on) setModelOpacity(root, 1);
  }

  return {
    show,
    hide,
    update,
    throwIn,
    isThrowTowards,
    startUndo,
    triggerUndo,
    tintGrabbed,
    hasPendingUndo: () => !!undo,
    isAnimating: () => !!anim,
  };
}

function collectPartsSafe(root) {
  const parts = [];
  root.traverse((o) => o.userData.part && parts.push(o));
  return parts;
}
