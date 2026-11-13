import * as THREE from 'three';
import { createPart, addMesh } from './partBuilder.js';
import { place, merge, roundedBar, cylY, cylZ, box, lathe, tube, screwGeometry, hexY } from './geo.js';

// İkinci demo: 4 eksenli masaüstü robot kol. Hiyerarşi: taban -> sütun -> alt kol -> üst kol -> tutucu
// Ölçek: 1 birim ≈ 1000 mm
export function buildRobotArm() {
  const root = new THREE.Group();
  root.name = 'robot-arm';
  root.userData.mmPerUnit = 1000;

  const base = createPart({ id: 'base', name: 'Taban', parent: root });
  addMesh(
    base,
    lathe(
      [
        [0.0001, 0],
        [0.22, 0],
        [0.22, 0.012],
        [0.205, 0.03],
        [0.2, 0.04],
        [0.0001, 0.04],
      ],
      48,
    ),
  );
  const baseParts = [
    place(new THREE.TorusGeometry(0.17, 0.0025, 4, 64).rotateX(Math.PI / 2), { pos: [0, 0.041, 0] }),
    place(box(0.06, 0.026, 0.03), { pos: [0, 0.018, 0.21] }), // kablo girişi
    place(cylZ(0.008, 0.02, 16), { pos: [0.015, 0.018, 0.228] }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    baseParts.push(place(hexY(0.009, 0.006), { pos: [Math.cos(a) * 0.12, 0.043, Math.sin(a) * 0.12] }));
  }
  addMesh(base, merge(baseParts));

  for (const [i, x] of [-0.15, 0.15].entries()) {
    const screw = createPart({
      id: `screw_base_${i}`,
      name: `Taban vidası ${i + 1}`,
      parent: root,
      position: [x, 0.04, 0],
    });
    addMesh(screw, screwGeometry('down', { length: 0.035, shaftR: 0.0055, headR: 0.012, headH: 0.009 }), {}, { edgeAngle: 40 });
  }

  // Sütun: döner tabla + gövde + omuz çatalı
  const column = createPart({ id: 'column', name: 'Sütun', parent: root, position: [0, 0.04, 0] });
  addMesh(
    column,
    lathe(
      [
        [0.0001, 0],
        [0.095, 0],
        [0.095, 0.02],
        [0.08, 0.026],
        [0.072, 0.05],
        [0.062, 0.17],
        [0.058, 0.18],
        [0.0001, 0.18],
      ],
      40,
    ),
  );
  const colParts = [place(new THREE.TorusGeometry(0.096, 0.003, 4, 48).rotateX(Math.PI / 2), { pos: [0, 0.01, 0] })];
  for (const s of [-1, 1]) {
    colParts.push(place(roundedBar(0.11, 0.1, 0.014, 0.012, 0.001), { pos: [0, 0.21, s * 0.054] }));
    colParts.push(place(cylZ(0.04, 0.016, 32), { pos: [0, 0.22, s * 0.054] }));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    colParts.push(place(box(0.012, 0.11, 0.02), { pos: [Math.cos(a) * 0.066, 0.1, Math.sin(a) * 0.066], rot: [0, -a, 0] }));
  }
  addMesh(column, merge(colParts));

  // Omuz menteşesi: alt kolun başlangıcı sütunun tepesinde
  const lowerArm = createPart({
    id: 'lower_arm',
    name: 'Alt kol',
    parent: column,
    position: [0, 0.22, 0],
    rotation: [0, 0, -0.6],
  });
  addMesh(lowerArm, place(roundedBar(0.26, 0.05, 0.07, 0.014, 0.002), { rot: [0, 0, Math.PI / 2], pos: [0, 0.15, 0] }));
  addMesh(
    lowerArm,
    merge([
      cylZ(0.042, 0.09, 32),
      place(cylZ(0.036, 0.08, 32), { pos: [0, 0.3, 0] }),
      place(cylY(0.011, 0.011, 0.16, 16), { pos: [0.042, 0.13, 0] }), // hidrolik piston gövdesi
      place(cylY(0.006, 0.006, 0.08, 12), { pos: [0.042, 0.24, 0] }), // piston mili
      place(tube([[-0.035, 0.02, 0.03], [-0.04, 0.15, 0.036], [-0.034, 0.28, 0.03]], 0.004, 24, 16), {}),
    ]),
  );

  const upperArm = createPart({
    id: 'upper_arm',
    name: 'Üst kol',
    parent: lowerArm,
    position: [0, 0.3, 0],
    rotation: [0, 0, 1.3],
  });
  addMesh(upperArm, place(roundedBar(0.2, 0.04, 0.052, 0.012, 0.002), { rot: [0, 0, Math.PI / 2], pos: [0, 0.13, 0] }));
  addMesh(
    upperArm,
    merge([
      place(cylZ(0.03, 0.1, 28), { pos: [0, 0, 0] }),
      place(cylY(0.028, 0.028, 0.024, 28), { pos: [0, 0.248, 0] }), // bilek döndürücü
      place(new THREE.TorusGeometry(0.029, 0.0015, 4, 32).rotateX(Math.PI / 2), { pos: [0, 0.255, 0] }),
    ]),
  );

  const gripper = createPart({ id: 'gripper', name: 'Tutucu', parent: upperArm, position: [0, 0.26, 0] });
  addMesh(gripper, place(roundedBar(0.085, 0.028, 0.05, 0.006, 0.001), { pos: [0, 0.016, 0] }));
  const g = [place(cylY(0.007, 0.007, 0.03, 12), { pos: [0, 0.04, 0] })];
  for (const s of [-1, 1]) {
    g.push(place(box(0.012, 0.06, 0.026), { pos: [s * 0.032, 0.06, 0] }));
    g.push(place(box(0.02, 0.012, 0.026), { pos: [s * 0.024, 0.094, 0] }));
    g.push(place(box(0.004, 0.024, 0.022), { pos: [s * 0.0145, 0.082, 0] })); // kavrama pedi
  }
  addMesh(gripper, merge(g));

  return root;
}
