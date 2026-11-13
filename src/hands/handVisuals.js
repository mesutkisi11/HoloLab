import * as THREE from 'three';
import { HOLO_CYAN, HOLO_ORANGE, getGlowTexture } from '../scene/hologramMaterial.js';

// Ellerin sahnedeki hologram görüntüsü: ince iskelet, parmak ucu ışıkları, işaret parmağında
// dönen nişangâh, başparmak-işaret arasında yaklaştıkça parlayan pinch çizgisi, yumrukta avuç halkası.
// Eller kameradan "planeDistance" uzaklıktaki sanal bir düzleme yerleştirilir.

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 12, 16, 20];
const ARC_POINTS = 28;
const overlay = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };

// Nişangâh dokusu: ince halka + dört çentik
function reticleTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.25;
    ctx.moveTo(64 + Math.cos(a0) * 44, 64 + Math.sin(a0) * 44);
    ctx.arc(64, 64, 44, a0, a0 + Math.PI / 2 - 0.5);
  }
  ctx.stroke();
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
    ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(64, 64, 5, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

export function createHandVisuals(scene, camera) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);
  const reticleMap = reticleTexture();

  const hands = [0, 1].map(() => {
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    const bones = new THREE.LineSegments(boneGeo, new THREE.LineBasicMaterial({ color: HOLO_CYAN, opacity: 0.32, ...overlay }));

    const jointGeo = new THREE.BufferGeometry();
    jointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    const joints = new THREE.Points(
      jointGeo,
      new THREE.PointsMaterial({ color: HOLO_CYAN, size: 0.008, opacity: 0.55, map: getGlowTexture(), ...overlay }),
    );

    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TIPS.length * 3), 3));
    const tips = new THREE.Points(
      tipGeo,
      new THREE.PointsMaterial({ color: HOLO_CYAN, size: 0.026, opacity: 0.9, map: getGlowTexture(), ...overlay }),
    );

    // İşaret parmağı nişangâhı (asıl imleç)
    const reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleMap, color: HOLO_CYAN, ...overlay }));
    reticle.scale.setScalar(0.05);
    // Yumrukta avuç halkası
    const palmRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleMap, color: HOLO_ORANGE, opacity: 0, ...overlay }));
    palmRing.scale.setScalar(0.11);
    // Başparmak-işaret arası pinch çizgisi
    const pinchGeo = new THREE.BufferGeometry();
    pinchGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const pinchLine = new THREE.Line(pinchGeo, new THREE.LineBasicMaterial({ color: HOLO_CYAN, opacity: 0, ...overlay }));

    const h = new THREE.Group();
    h.add(bones, joints, tips, reticle, palmRing, pinchLine);
    h.visible = false;
    group.add(h);
    return {
      group: h,
      bones,
      joints,
      tips,
      reticle,
      palmRing,
      pinchLine,
      spin: 0,
      world: Array.from({ length: 21 }, () => new THREE.Vector3()),
      palmWorld: new THREE.Vector3(),
    };
  });

  // İki nokta arasındaki enerji arkı (sök/tak sırasında)
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
  const arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: HOLO_ORANGE, opacity: 0.85, ...overlay }));
  arc.visible = false;
  group.add(arc);

  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Normalize (0..1) el koordinatını, kameradan planeDistance uzaklıktaki dünya noktasına çevirir
  function toWorld(p, planeDistance, out) {
    ndc.set(p.x * 2 - 1, -(p.y * 2 - 1), 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    camera.getWorldDirection(forward);
    const scale = planeDistance / Math.max(1e-4, dir.dot(forward));
    return out.copy(camera.position).addScaledVector(dir, scale);
  }

  return {
    group,
    toWorld,
    update(handStates, planeDistance, dt = 0.016) {
      for (let i = 0; i < 2; i++) {
        const vis = hands[i];
        const hand = handStates.find((x) => x.slot === i);
        if (!hand) {
          vis.group.visible = false;
          continue;
        }
        vis.group.visible = true;
        hand.points.forEach((p, j) => toWorld(p, planeDistance, vis.world[j]));
        toWorld(hand.palm, planeDistance, vis.palmWorld);

        const bp = vis.bones.geometry.attributes.position;
        BONES.forEach(([a, b], k) => {
          bp.setXYZ(k * 2, vis.world[a].x, vis.world[a].y, vis.world[a].z);
          bp.setXYZ(k * 2 + 1, vis.world[b].x, vis.world[b].y, vis.world[b].z);
        });
        bp.needsUpdate = true;
        const jp = vis.joints.geometry.attributes.position;
        vis.world.forEach((w, j) => jp.setXYZ(j, w.x, w.y, w.z));
        jp.needsUpdate = true;
        const tp = vis.tips.geometry.attributes.position;
        TIPS.forEach((idx, k) => tp.setXYZ(k, vis.world[idx].x, vis.world[idx].y, vis.world[idx].z));
        tp.needsUpdate = true;

        // Nişangâh: pinch'e yaklaştıkça küçülür ve turuncuya döner
        const closeness = THREE.MathUtils.clamp(1 - (hand.pinchDist - 0.3) / 0.6, 0, 1);
        const locked = hand.isPinching;
        vis.spin += dt * (locked ? 0.5 : 2.2);
        vis.reticle.position.copy(vis.world[8]);
        vis.reticle.material.rotation = vis.spin;
        vis.reticle.material.color.copy(HOLO_CYAN).lerp(HOLO_ORANGE, locked ? 1 : closeness * 0.6);
        vis.reticle.scale.setScalar(planeDistance * (locked ? 0.022 : 0.034 - closeness * 0.008));
        vis.reticle.visible = !hand.isFist;

        const pl = vis.pinchLine.geometry.attributes.position;
        pl.setXYZ(0, vis.world[4].x, vis.world[4].y, vis.world[4].z);
        pl.setXYZ(1, vis.world[8].x, vis.world[8].y, vis.world[8].z);
        pl.needsUpdate = true;
        vis.pinchLine.material.opacity = closeness * 0.9;
        vis.pinchLine.material.color.copy(locked ? HOLO_ORANGE : HOLO_CYAN);

        vis.palmRing.position.copy(vis.palmWorld);
        vis.palmRing.material.opacity = THREE.MathUtils.damp(vis.palmRing.material.opacity, hand.isFist ? 0.9 : 0, 14, dt);
        vis.palmRing.material.rotation = -vis.spin;
        vis.palmRing.scale.setScalar(planeDistance * 0.07);

        const active = hand.isFist || hand.isPinching;
        vis.tips.material.color.copy(active ? HOLO_ORANGE : HOLO_CYAN);
        vis.bones.material.color.copy(active ? HOLO_ORANGE : HOLO_CYAN);
        vis.tips.material.size = planeDistance * 0.017;
        vis.joints.material.size = planeDistance * 0.006;
      }
    },
    // İki nokta arasında ark çiz (active=false ise gizle)
    setArc(a, b, active, time) {
      arc.visible = active;
      if (!active) return;
      const pos = arc.geometry.attributes.position;
      side.subVectors(b, a);
      const len = side.length();
      side.normalize();
      n1.crossVectors(side, up).normalize();
      n2.crossVectors(side, n1).normalize();
      for (let i = 0; i < ARC_POINTS; i++) {
        const t = i / (ARC_POINTS - 1);
        const env = Math.sin(Math.PI * t) * len * 0.12;
        const j1 = Math.sin(t * 23 + time * 37) * env;
        const j2 = Math.cos(t * 17 - time * 29) * env;
        pos.setXYZ(
          i,
          a.x + (b.x - a.x) * t + n1.x * j1 + n2.x * j2,
          a.y + (b.y - a.y) * t + n1.y * j1 + n2.y * j2,
          a.z + (b.z - a.z) * t + n1.z * j1 + n2.z * j2,
        );
      }
      pos.needsUpdate = true;
    },
  };
}
