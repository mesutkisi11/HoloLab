import * as THREE from 'three';
import { createPart, addMesh } from './partBuilder.js';

// İkinci demo: basit bir robot kol. Hiyerarşi: taban -> sütun -> alt kol -> üst kol -> tutucu
export function buildRobotArm() {
  const root = new THREE.Group();
  root.name = 'robot-arm';

  const base = createPart({ id: 'base', name: 'Taban', parent: root });
  addMesh(base, new THREE.CylinderGeometry(0.2, 0.22, 0.04, 32), { position: [0, 0.02, 0] });

  for (const [i, x] of [-0.15, 0.15].entries()) {
    const screw = createPart({
      id: `screw_base_${i}`,
      name: `Taban vidası ${i + 1}`,
      parent: root,
      position: [x, 0.04, 0],
    });
    addMesh(screw, new THREE.CylinderGeometry(0.006, 0.006, 0.035, 8), { position: [0, -0.017, 0] });
    addMesh(screw, new THREE.CylinderGeometry(0.013, 0.013, 0.01, 6), { position: [0, 0.005, 0] });
  }

  const column = createPart({ id: 'column', name: 'Sütun', parent: root, position: [0, 0.04, 0] });
  addMesh(column, new THREE.CylinderGeometry(0.06, 0.08, 0.22, 24), { position: [0, 0.11, 0] });

  // Omuz menteşesi: alt kolun başlangıcı sütunun tepesinde
  const lowerArm = createPart({
    id: 'lower_arm',
    name: 'Alt kol',
    parent: column,
    position: [0, 0.22, 0],
    rotation: [0, 0, -0.6],
  });
  addMesh(lowerArm, new THREE.SphereGeometry(0.055, 20, 14));
  addMesh(lowerArm, new THREE.BoxGeometry(0.06, 0.3, 0.06), { position: [0, 0.15, 0] });

  const upperArm = createPart({
    id: 'upper_arm',
    name: 'Üst kol',
    parent: lowerArm,
    position: [0, 0.3, 0],
    rotation: [0, 0, 1.3],
  });
  addMesh(upperArm, new THREE.SphereGeometry(0.045, 20, 14));
  addMesh(upperArm, new THREE.BoxGeometry(0.05, 0.26, 0.05), { position: [0, 0.13, 0] });

  const gripper = createPart({ id: 'gripper', name: 'Tutucu', parent: upperArm, position: [0, 0.26, 0] });
  addMesh(gripper, new THREE.BoxGeometry(0.08, 0.03, 0.05), { position: [0, 0.015, 0] });
  for (const x of [-0.03, 0.03]) {
    addMesh(gripper, new THREE.BoxGeometry(0.012, 0.07, 0.03), { position: [x, 0.06, 0] });
  }

  return root;
}
