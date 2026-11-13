import * as THREE from 'three';
import { HOLO_CYAN, HOLO_ORANGE } from './hologramMaterial.js';

// Hedefleme halkası: parmağın yaklaştığı parçanın etrafında belirir, tutunca kilitlenir (turuncu).
// setProgress(0..1): işaret ederek bekleme süresini gösteren dolan yay.
export function createTargetRing(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 15;
  scene.add(group);

  const mat = new THREE.LineBasicMaterial({
    color: HOLO_CYAN,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  // Dört parçalı kesikli halka
  const ring = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const curve = new THREE.EllipseCurve(0, 0, 1, 1, i * (Math.PI / 2) + 0.22, (i + 1) * (Math.PI / 2) - 0.22);
    ring.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)), mat));
  }
  group.add(ring);

  // Köşe çentikleri (kilitlenince içeri çekilir)
  const ticks = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0),
      new THREE.Vector3(Math.cos(a) * 1.38, Math.sin(a) * 1.38, 0),
    ]);
    ticks.add(new THREE.Line(geo, mat));
  }
  group.add(ticks);

  // Bekleme yayı (dışta, saat yönünde dolar)
  const ARC_SEG = 64;
  const arcPts = [];
  for (let i = 0; i <= ARC_SEG; i++) {
    const a = Math.PI / 2 - (i / ARC_SEG) * Math.PI * 2;
    arcPts.push(new THREE.Vector3(Math.cos(a) * 1.22, Math.sin(a) * 1.22, 0));
  }
  const arcMat = mat.clone();
  arcMat.color = HOLO_ORANGE.clone();
  const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), arcMat);
  arc.geometry.setDrawRange(0, 0);
  group.add(arc);

  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  let targetRadius = 0.1;
  let radius = 0.1;
  let locked = false;

  return {
    // target: Object3D (parça) veya null
    set(target, isLocked) {
      if (!target) {
        group.visible = false;
        arc.geometry.setDrawRange(0, 0);
        return;
      }
      box.setFromObject(target);
      box.getCenter(center);
      box.getSize(size);
      targetRadius = Math.max(0.035, size.length() * 0.55);
      group.position.copy(center);
      group.visible = true;
      locked = isLocked;
      mat.color.copy(isLocked ? HOLO_ORANGE : HOLO_CYAN);
    },
    setProgress(k) {
      arc.geometry.setDrawRange(0, Math.round(k * ARC_SEG) + (k > 0 ? 1 : 0));
    },
    update(dt) {
      if (!group.visible) return;
      radius = THREE.MathUtils.damp(radius, targetRadius, 14, dt);
      group.scale.setScalar(radius);
      group.quaternion.copy(camera.quaternion); // hep kameraya baksın
      ring.rotation.z += dt * (locked ? 0.4 : 1.6);
      ticks.rotation.z -= dt * 0.8;
      ticks.scale.setScalar(THREE.MathUtils.damp(ticks.scale.x, locked ? 0.8 : 1, 12, dt));
    },
  };
}
