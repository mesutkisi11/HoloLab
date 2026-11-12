import * as THREE from 'three';
import { HOLO_CYAN, HOLO_ORANGE } from './hologramMaterial.js';

// Hedefleme halkası: parmağın yaklaştığı parçanın etrafında belirir, tutunca kilitlenir (turuncu)
export function createTargetRing(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
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
    const curve = new THREE.EllipseCurve(0, 0, 1, 1, i * (Math.PI / 2) + 0.2, (i + 1) * (Math.PI / 2) - 0.2);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
    ring.add(new THREE.Line(geo, mat));
  }
  group.add(ring);

  // Dört köşe çentiği (kilitlenince içeri çekilir)
  const ticks = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0),
      new THREE.Vector3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0),
    ]);
    ticks.add(new THREE.Line(geo, mat));
  }
  group.add(ticks);

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
        return;
      }
      box.setFromObject(target);
      box.getCenter(center);
      box.getSize(size);
      targetRadius = Math.max(0.04, size.length() * 0.55);
      group.position.copy(center);
      group.visible = true;
      locked = isLocked;
      mat.color.copy(isLocked ? HOLO_ORANGE : HOLO_CYAN);
    },
    update(dt) {
      if (!group.visible) return;
      radius = THREE.MathUtils.damp(radius, targetRadius, 14, dt);
      group.scale.setScalar(radius);
      group.quaternion.copy(camera.quaternion); // hep kameraya baksın
      ring.rotation.z += dt * (locked ? 0.4 : 1.6);
      ticks.rotation.z -= dt * 0.8;
      const tickScale = THREE.MathUtils.damp(ticks.scale.x, locked ? 0.8 : 1, 12, dt);
      ticks.scale.setScalar(tickScale);
    },
  };
}
