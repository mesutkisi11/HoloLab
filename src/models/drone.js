import * as THREE from 'three';
import { createPart, addMesh, corners } from './partBuilder.js';

// Katlanabilir quadcopter. Hiyerarşi gerçek montajı yansıtır:
// gövde -> kol (menteşeli) -> motor -> pervane. Kol katlanınca motor ve pervane de onunla gider.
export function buildDrone() {
  const root = new THREE.Group();
  root.name = 'drone';

  // --- Gövde ---
  const bodyBottom = createPart({ id: 'body_bottom', name: 'Alt gövde plakası', parent: root });
  addMesh(bodyBottom, new THREE.BoxGeometry(0.46, 0.02, 0.3));
  for (const [x, z] of corners(0.15, 0.09)) {
    addMesh(bodyBottom, new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), { position: [x, 0.07, z] });
  }
  for (const [x, z] of corners(0.22, 0.12)) {
    addMesh(bodyBottom, new THREE.BoxGeometry(0.03, 0.06, 0.04), { position: [x, 0.04, z] });
  }
  // Batarya rayları (alt plakanın altında, X yönünde)
  for (const z of [-0.07, 0.07]) {
    addMesh(bodyBottom, new THREE.BoxGeometry(0.28, 0.01, 0.012), { position: [0, -0.015, z] });
  }

  const bodyTop = createPart({ id: 'body_top', name: 'Üst gövde plakası', parent: root, position: [0, 0.14, 0] });
  addMesh(bodyTop, new THREE.BoxGeometry(0.46, 0.02, 0.3));

  // --- Elektronik ---
  const fc = createPart({ id: 'fc_board', name: 'Uçuş kontrol kartı', parent: root, position: [0, 0.045, 0] });
  addMesh(fc, new THREE.BoxGeometry(0.12, 0.008, 0.12));
  addMesh(fc, new THREE.BoxGeometry(0.03, 0.008, 0.03), { position: [0, 0.008, 0] });
  addMesh(fc, new THREE.BoxGeometry(0.02, 0.006, 0.04), { position: [0.04, 0.007, -0.03] });

  const esc = createPart({ id: 'esc_board', name: 'ESC kartı', parent: root, position: [0, 0.09, 0] });
  addMesh(esc, new THREE.BoxGeometry(0.14, 0.008, 0.1));
  for (const [x, z] of corners(0.05, 0.03)) {
    addMesh(esc, new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10), { position: [x, 0.014, z] });
  }

  // --- Batarya (raya kayarak takılır) ---
  const battery = createPart({ id: 'battery', name: 'Batarya', parent: root, position: [0, -0.055, 0] });
  addMesh(battery, new THREE.BoxGeometry(0.24, 0.07, 0.13));
  addMesh(battery, new THREE.CylinderGeometry(0.01, 0.01, 0.03, 10), {
    position: [0.135, 0.015, 0],
    rotation: [0, 0, Math.PI / 2],
  });

  // --- Kollar + motorlar + pervaneler + motor vidaları ---
  const armDefs = [
    { key: 'fr', name: 'Ön sağ', x: 0.23, z: -0.12, yaw: Math.PI / 4 },
    { key: 'fl', name: 'Ön sol', x: -0.23, z: -0.12, yaw: (3 * Math.PI) / 4 },
    { key: 'br', name: 'Arka sağ', x: 0.23, z: 0.12, yaw: -Math.PI / 4 },
    { key: 'bl', name: 'Arka sol', x: -0.23, z: 0.12, yaw: (-3 * Math.PI) / 4 },
  ];

  for (const d of armDefs) {
    // Kolun başlangıç noktası menteşe: böylece rotation.y değişince kol menteşeden döner
    const arm = createPart({
      id: `arm_${d.key}`,
      name: `${d.name} kol`,
      parent: root,
      position: [d.x, 0.07, d.z],
      rotation: [0, d.yaw, 0],
    });
    addMesh(arm, new THREE.BoxGeometry(0.42, 0.035, 0.035), { position: [0.21, 0, 0] });
    addMesh(arm, new THREE.CylinderGeometry(0.012, 0.012, 0.055, 12));

    const motor = createPart({
      id: `motor_${d.key}`,
      name: `${d.name} motor`,
      parent: arm,
      position: [0.42, 0.048, 0],
    });
    addMesh(motor, new THREE.CylinderGeometry(0.045, 0.045, 0.06, 24));
    addMesh(motor, new THREE.CylinderGeometry(0.02, 0.02, 0.015, 16), { position: [0, 0.037, 0] });
    addMesh(motor, new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), { position: [0, 0.05, 0] });

    const prop = createPart({
      id: `prop_${d.key}`,
      name: `${d.name} pervane`,
      parent: motor,
      position: [0, 0.058, 0],
    });
    addMesh(prop, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12));
    addMesh(prop, new THREE.BoxGeometry(0.32, 0.004, 0.03), { rotation: [0.25, 0, 0] });

    // Motor vidası: kolun altından yukarı doğru motora girer
    const screw = createPart({
      id: `screw_motor_${d.key}`,
      name: `${d.name} motor vidası`,
      parent: arm,
      position: [0.42, -0.028, 0],
    });
    addScrew(screw, 'up');
  }

  // --- Gövde vidaları: üst plakadan aşağı, dikmelere girer ---
  corners(0.15, 0.09).forEach(([x, z], i) => {
    const screw = createPart({
      id: `screw_body_${i}`,
      name: `Gövde vidası ${i + 1}`,
      parent: root,
      position: [x, 0.15, z],
    });
    addScrew(screw, 'down');
  });

  // --- Gimbal + kamera (ön tarafta, gövdenin altında) ---
  const gimbal = createPart({ id: 'gimbal', name: 'Gimbal', parent: root, position: [0, -0.02, -0.17] });
  addMesh(gimbal, new THREE.BoxGeometry(0.09, 0.012, 0.03));
  for (const x of [-0.035, 0.035]) {
    addMesh(gimbal, new THREE.BoxGeometry(0.012, 0.05, 0.02), { position: [x, -0.025, 0] });
  }
  const camera = createPart({ id: 'camera', name: 'Kamera', parent: gimbal, position: [0, -0.032, 0] });
  addMesh(camera, new THREE.BoxGeometry(0.056, 0.042, 0.05));
  addMesh(camera, new THREE.CylinderGeometry(0.015, 0.015, 0.02, 16), {
    position: [0, 0, -0.033],
    rotation: [Math.PI / 2, 0, 0],
  });

  // --- İniş ayakları (menteşeli, gövdenin iki yanında) ---
  for (const [key, name, x] of [
    ['l', 'Sol iniş ayağı', -0.17],
    ['r', 'Sağ iniş ayağı', 0.17],
  ]) {
    const leg = createPart({ id: `leg_${key}`, name, parent: root, position: [x, -0.01, 0] });
    for (const z of [-0.1, 0.1]) {
      addMesh(leg, new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), { position: [0, -0.08, z] });
    }
    addMesh(leg, new THREE.CylinderGeometry(0.007, 0.007, 0.28, 8), {
      position: [0, -0.16, 0],
      rotation: [Math.PI / 2, 0, 0],
    });
    addMesh(leg, new THREE.BoxGeometry(0.03, 0.015, 0.24), { position: [0, 0, 0] });
  }

  return root;
}

// Altıgen başlı küçük vida. 'down': baş üstte, gövde aşağı iner. 'up': tersi.
function addScrew(part, direction) {
  const sign = direction === 'down' ? -1 : 1;
  addMesh(part, new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), { position: [0, sign * 0.015, 0] });
  addMesh(part, new THREE.CylinderGeometry(0.011, 0.011, 0.008, 6), { position: [0, -sign * 0.004, 0] });
}
