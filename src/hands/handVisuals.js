import * as THREE from 'three';
import { HOLO_CYAN, HOLO_ORANGE } from '../scene/hologramMaterial.js';

// El iskeletini, parmak ucu imleçlerini ve iki el arasındaki enerji arkını sahnede çizer.
// Eller, kameradan "planeDistance" uzaklıktaki sanal bir düzleme yerleştirilir.

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const ARC_POINTS = 24;

export function createHandVisuals(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);

  const hands = [0, 1].map(() => {
    const bonePos = new Float32Array(BONES.length * 2 * 3);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute('position', new THREE.BufferAttribute(bonePos, 3));
    const bones = new THREE.LineSegments(
      boneGeo,
      new THREE.LineBasicMaterial({
        color: HOLO_CYAN,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );

    const jointPos = new Float32Array(21 * 3);
    const jointGeo = new THREE.BufferGeometry();
    jointGeo.setAttribute('position', new THREE.BufferAttribute(jointPos, 3));
    const joints = new THREE.Points(
      jointGeo,
      new THREE.PointsMaterial({
        color: HOLO_CYAN,
        size: 0.018,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );

    const tipPos = new Float32Array(TIPS.length * 3);
    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3));
    const tips = new THREE.Points(
      tipGeo,
      new THREE.PointsMaterial({
        color: HOLO_CYAN,
        size: 0.045,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        map: createGlowTexture(),
      }),
    );

    const h = new THREE.Group();
    h.add(bones, joints, tips);
    h.visible = false;
    h.renderOrder = 10;
    group.add(h);
    return { group: h, bones, joints, tips, world: Array.from({ length: 21 }, () => new THREE.Vector3()) };
  });

  // İki el arasındaki enerji arkı: rastgele kıvrılan parlak çizgi
  const arcPos = new Float32Array(ARC_POINTS * 3);
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
  const arc = new THREE.Line(
    arcGeo,
    new THREE.LineBasicMaterial({
      color: HOLO_ORANGE,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  arc.visible = false;
  group.add(arc);

  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3();

  // Normalize (0..1) el koordinatını, kameradan planeDistance uzaklıktaki dünya noktasına çevirir
  function toWorld(p, planeDistance, out) {
    ndc.set(p.x * 2 - 1, -(p.y * 2 - 1), 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    // Kamera bakış yönü boyunca planeDistance kadar ilerle
    camera.getWorldDirection(forward);
    const scale = planeDistance / Math.max(1e-4, dir.dot(forward));
    return out.copy(camera.position).addScaledVector(dir, scale);
  }

  return {
    group,
    toWorld,
    update(handStates, planeDistance) {
      for (let i = 0; i < 2; i++) {
        const vis = hands[i];
        const hand = handStates[i];
        if (!hand) {
          vis.group.visible = false;
          continue;
        }
        vis.group.visible = true;
        hand.points.forEach((p, j) => toWorld(p, planeDistance, vis.world[j]));

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

        // Yumruk veya pinch: imleçler turuncuya döner
        const active = hand.isFist || hand.isPinching;
        vis.tips.material.color.copy(active ? HOLO_ORANGE : HOLO_CYAN);
        vis.bones.material.color.copy(active ? HOLO_ORANGE : HOLO_CYAN);
      }
    },
    // İki avuç arasında ark çiz (active=false ise gizle)
    setArc(a, b, active, time) {
      arc.visible = active;
      if (!active) return;
      const pos = arc.geometry.attributes.position;
      const side = new THREE.Vector3().subVectors(b, a);
      const len = side.length();
      side.normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const n1 = new THREE.Vector3().crossVectors(side, up).normalize();
      const n2 = new THREE.Vector3().crossVectors(side, n1).normalize();
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

// Yumuşak parlayan daire dokusu (parmak ucu imleçleri için)
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
