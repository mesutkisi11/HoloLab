import * as THREE from 'three';
import { createPart, addMesh, corners } from './partBuilder.js';
import {
  place,
  merge,
  plate,
  roundedBar,
  circleHole,
  slotHole,
  roundedRectHole,
  cylX,
  cylY,
  cylZ,
  hexY,
  box,
  lathe,
  tube,
  propBlades,
  screwGeometry,
} from './geo.js';

// Katlanabilir quadcopter. Hiyerarşi gerçek montajı yansıtır:
// gövde -> kol (menteşeli) -> motor -> pervane. Kol katlanınca motor ve pervane de onunla gider.
// ÖNEMLİ: parça kimlikleri, konumları ve menteşe noktaları public/choreo/drone.json ile eşleşir.
// Ölçek: 1 birim ≈ 500 mm (gövde 230 mm, pervane 160 mm çap)
export const DRONE_MM_PER_UNIT = 500;

const ARM_PIVOTS = [
  { key: 'fr', name: 'Ön sağ', x: 0.23, z: -0.12, yaw: Math.PI / 4, dir: 1 },
  { key: 'fl', name: 'Ön sol', x: -0.23, z: -0.12, yaw: (3 * Math.PI) / 4, dir: -1 },
  { key: 'br', name: 'Arka sağ', x: 0.23, z: 0.12, yaw: -Math.PI / 4, dir: -1 },
  { key: 'bl', name: 'Arka sol', x: -0.23, z: 0.12, yaw: (-3 * Math.PI) / 4, dir: 1 },
];

export function buildDrone() {
  const root = new THREE.Group();
  root.name = 'drone';
  root.userData.mmPerUnit = DRONE_MM_PER_UNIT;

  buildBody(root);
  buildElectronics(root);
  buildBattery(root);
  for (const d of ARM_PIVOTS) buildArm(root, d);
  buildBodyScrews(root);
  buildGimbal(root);
  for (const side of [-1, 1]) buildLeg(root, side);

  return root;
}

// --- Alt ve üst karbon plakalar, dikmeler, menteşe braketleri, batarya rayları ---
function buildBody(root) {
  const bottom = createPart({ id: 'body_bottom', name: 'Alt gövde plakası', parent: root });
  const bottomHoles = [
    slotHole(-0.075, 0, 0.11, 0.028),
    slotHole(0.075, 0, 0.11, 0.028),
    roundedRectHole(0.05, 0.05, 0.008, 0, 0),
    ...corners(0.15, 0.09).map(([x, z]) => circleHole(x, z, 0.0042)),
    ...corners(0.19, 0.06).map(([x, z]) => circleHole(x, z, 0.01)),
  ];
  addMesh(bottom, plate(0.46, 0.3, 0.012, { radius: 0.04, holes: bottomHoles }));
  // Altıgen dikmeler (alt plakayla üst plaka arası)
  addMesh(bottom, merge(corners(0.15, 0.09).map(([x, z]) => place(hexY(0.0075, 0.128), { pos: [x, 0.07, z] }))));
  // Kol menteşe braketleri + pimler
  const brackets = [];
  for (const { x, z } of ARM_PIVOTS) {
    const inward = -Math.sign(x) * 0.012;
    brackets.push(place(box(0.044, 0.044, 0.04), { pos: [x + inward, 0.028, z] }));
    brackets.push(place(cylY(0.0042, 0.0042, 0.128, 12), { pos: [x, 0.07, z] }));
    brackets.push(place(cylY(0.0075, 0.0075, 0.004, 16), { pos: [x, 0.05, z] }));
  }
  addMesh(bottom, merge(brackets));
  // Batarya rayları: dudaklı iki ray + arka dayanak
  const rails = [];
  for (const s of [-1, 1]) {
    rails.push(place(box(0.27, 0.016, 0.006), { pos: [0.005, -0.014, s * 0.069] }));
    rails.push(place(box(0.27, 0.004, 0.01), { pos: [0.005, -0.02, s * 0.063] }));
  }
  rails.push(place(box(0.008, 0.02, 0.06), { pos: [-0.132, -0.016, 0] }));
  addMesh(bottom, merge(rails));

  const top = createPart({ id: 'body_top', name: 'Üst gövde plakası', parent: root, position: [0, 0.14, 0] });
  const topHoles = [
    roundedRectHole(0.13, 0.08, 0.012, 0, 0),
    slotHole(0.15, 0, 0.06, 0.02, Math.PI / 2),
    slotHole(-0.15, 0, 0.06, 0.02, Math.PI / 2),
    ...corners(0.15, 0.09).map(([x, z]) => circleHole(x, z, 0.0042)),
  ];
  addMesh(top, plate(0.46, 0.3, 0.012, { radius: 0.04, holes: topHoles }));
  const topParts = [];
  for (const { x, z } of ARM_PIVOTS) {
    const inward = -Math.sign(x) * 0.012;
    topParts.push(place(box(0.044, 0.028, 0.04), { pos: [x + inward, -0.02, z] }));
  }
  // GPS direği + anten çanağı
  topParts.push(place(cylY(0.005, 0.006, 0.07, 12), { pos: [-0.12, 0.041, 0.04] }));
  topParts.push(place(lathe([[0, 0], [0.032, 0], [0.032, 0.008], [0.026, 0.013], [0, 0.014]], 28), { pos: [-0.12, 0.076, 0.04] }));
  // İki telsiz anteni (arkaya yatık)
  for (const s of [-1, 1]) {
    topParts.push(place(cylY(0.0025, 0.0032, 0.075, 8), { pos: [s * 0.06, 0.04, 0.13], rot: [0.45, 0, s * 0.25] }));
  }
  // Ön LED şeridi ve güç düğmesi
  topParts.push(place(box(0.11, 0.004, 0.008), { pos: [0, 0.008, -0.142] }));
  topParts.push(place(cylY(0.007, 0.007, 0.006, 16), { pos: [0.09, 0.009, 0.08] }));
  addMesh(top, merge(topParts));
}

// --- Uçuş kontrol kartı ve ESC kartı (yığın halinde) ---
function buildElectronics(root) {
  const fc = createPart({ id: 'fc_board', name: 'Uçuş kontrol kartı', parent: root, position: [0, 0.045, 0] });
  const stackHoles = corners(0.04, 0.04).map(([x, z]) => circleHole(x, z, 0.0025));
  addMesh(fc, plate(0.1, 0.1, 0.0024, { radius: 0.006, holes: stackHoles, bevel: 0.0004 }));
  const fcParts = [
    place(box(0.022, 0.003, 0.022), { pos: [0, 0.0027, 0], rot: [0, Math.PI / 4, 0] }), // işlemci
    place(box(0.008, 0.002, 0.008), { pos: [0.026, 0.0022, -0.022] }), // IMU
    place(box(0.012, 0.004, 0.009), { pos: [-0.046, 0.0032, 0] }), // USB
    place(box(0.01, 0.0025, 0.006), { pos: [0.02, 0.0024, 0.026] }), // baro
  ];
  for (let i = 0; i < 8; i++) {
    for (const z of [-0.043, 0.043]) fcParts.push(place(box(0.0032, 0.007, 0.0032), { pos: [-0.028 + i * 0.008, 0.0045, z] }));
  }
  for (const [x, z] of corners(0.04, 0.04)) {
    fcParts.push(place(new THREE.TorusGeometry(0.0045, 0.0016, 6, 16).rotateX(Math.PI / 2), { pos: [x, 0.0015, z] }));
  }
  addMesh(fc, merge(fcParts));

  const esc = createPart({ id: 'esc_board', name: 'ESC kartı', parent: root, position: [0, 0.09, 0] });
  addMesh(esc, plate(0.12, 0.1, 0.0024, { radius: 0.006, holes: stackHoles, bevel: 0.0004 }));
  const escParts = [place(cylX(0.0085, 0.036, 20), { pos: [0, 0.0105, 0.03] })]; // ana kondansatör
  for (const [x, z] of corners(0.043, 0.026)) {
    for (let k = 0; k < 3; k++) escParts.push(place(box(0.0085, 0.0028, 0.0062), { pos: [x, 0.0026, z + (k - 1) * 0.0075] }));
  }
  for (const [x, z] of corners(0.056, 0.045)) escParts.push(place(box(0.008, 0.0012, 0.006), { pos: [x, 0.0018, z] }));
  escParts.push(place(box(0.03, 0.0026, 0.02), { pos: [0, 0.0025, -0.025] })); // sürücü çipi
  escParts.push(place(tube([[0.05, 0.004, 0.03], [0.07, -0.01, 0.04], [0.09, -0.06, 0.03], [0.1, -0.12, 0.02]], 0.0028, 20, 16), {}));
  addMesh(esc, merge(escParts));
}

// --- Batarya: raya kayarak takılır, arkasından güç kablosu ve XT60 fiş çıkar ---
function buildBattery(root) {
  const battery = createPart({ id: 'battery', name: 'Batarya', parent: root, position: [0, -0.055, 0] });
  addMesh(battery, roundedBar(0.24, 0.07, 0.13, 0.012, 0.003));
  const details = [];
  for (const x of [-0.07, 0.07]) details.push(place(roundedBar(0.012, 0.074, 0.134, 0.013, 0.001), { pos: [x, 0, 0] }));
  for (const s of [-1, 1]) details.push(place(box(0.235, 0.004, 0.005), { pos: [0, 0.037, s * 0.062] })); // ray dilleri
  details.push(place(tube([[0.118, 0.012, 0.03], [0.14, 0.015, 0.045], [0.165, 0.005, 0.05]], 0.0035, 16, 16), {}));
  details.push(place(roundedBar(0.018, 0.009, 0.016, 0.002, 0.0008), { pos: [0.176, 0.005, 0.05] }));
  details.push(place(tube([[0.118, 0.022, -0.035], [0.135, 0.03, -0.045], [0.15, 0.028, -0.05]], 0.0016, 12, 16), {}));
  details.push(place(box(0.012, 0.005, 0.008), { pos: [0.156, 0.028, -0.05] }));
  addMesh(battery, merge(details));
}

// --- Kollar: menteşe topuzu, karbon boru, motor yuvası; motor ve pervane kolun çocuğu ---
function buildArm(root, d) {
  // Kolun başlangıç noktası menteşe: rotation.y değişince kol menteşeden döner
  const arm = createPart({
    id: `arm_${d.key}`,
    name: `${d.name} kol`,
    parent: root,
    position: [d.x, 0.07, d.z],
    rotation: [0, d.yaw, 0],
  });
  addMesh(arm, cylX(0.0145, 0.34, 24), { position: [0.22, 0, 0] }); // karbon boru
  const armParts = [
    cylY(0.014, 0.014, 0.04, 24), // menteşe topuzu
    place(roundedBar(0.042, 0.03, 0.032, 0.006, 0.001), { pos: [0.032, 0, 0] }), // boru kelepçesi
    place(cylX(0.019, 0.03, 24), { pos: [0.375, 0, 0] }),
    place(cylY(0.03, 0.03, 0.044, 28), { pos: [0.42, -0.004, 0] }), // motor yuvası
    place(cylY(0.0028, 0.0028, 0.04, 8), { pos: [0.375, 0, 0.021] }), // kelepçe cıvatası
    place(tube([[0.05, 0.016, 0.006], [0.2, 0.0165, 0.006], [0.37, 0.016, 0.006], [0.4, 0.018, 0.004]], 0.0022, 24, 16), {}),
  ];
  addMesh(arm, merge(armParts));

  const motor = createPart({ id: `motor_${d.key}`, name: `${d.name} motor`, parent: arm, position: [0.42, 0.048, 0] });
  // Motor çanı: döner profil
  addMesh(
    motor,
    lathe(
      [
        [0.0001, 0.03],
        [0.013, 0.03],
        [0.013, 0.028],
        [0.036, 0.028],
        [0.044, 0.025],
        [0.046, 0.021],
        [0.046, -0.016],
        [0.044, -0.019],
        [0.034, -0.019],
      ],
      36,
    ),
  );
  const motorParts = [
    place(cylY(0.034, 0.034, 0.009, 32), { pos: [0, -0.025, 0] }), // stator tabanı
    place(cylY(0.0045, 0.0045, 0.03, 12), { pos: [0, 0.04, 0] }), // mil
    place(new THREE.TorusGeometry(0.0462, 0.0011, 4, 48).rotateX(Math.PI / 2), { pos: [0, -0.008, 0] }),
    place(new THREE.TorusGeometry(0.0462, 0.0011, 4, 48).rotateX(Math.PI / 2), { pos: [0, 0.01, 0] }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    motorParts.push(place(box(0.02, 0.0022, 0.0045), { pos: [Math.cos(a) * 0.025, 0.0292, Math.sin(a) * 0.025], rot: [0, -a, 0] }));
  }
  addMesh(motor, merge(motorParts));

  const prop = createPart({ id: `prop_${d.key}`, name: `${d.name} pervane`, parent: motor, position: [0, 0.058, 0] });
  addMesh(prop, propBlades({ dir: d.dir }), {}, { edgeAngle: 35 });
  addMesh(
    prop,
    merge([
      cylY(0.013, 0.013, 0.012, 24),
      place(new THREE.ConeGeometry(0.009, 0.012, 20), { pos: [0, 0.012, 0] }),
    ]),
  );

  // Motor vidası: kolun altından yukarı doğru motor yuvasına girer
  const screw = createPart({
    id: `screw_motor_${d.key}`,
    name: `${d.name} motor vidası`,
    parent: arm,
    position: [0.42, -0.028, 0],
  });
  addMesh(screw, screwGeometry('up'), {}, { edgeAngle: 40 });
}

// --- Gövde vidaları: üst plakadan aşağı, dikmelere girer ---
function buildBodyScrews(root) {
  corners(0.15, 0.09).forEach(([x, z], i) => {
    const screw = createPart({
      id: `screw_body_${i}`,
      name: `Gövde vidası ${i + 1}`,
      parent: root,
      position: [x, 0.15, z],
    });
    addMesh(screw, screwGeometry('down'), {}, { edgeAngle: 40 });
  });
}

// --- 3 eksenli gimbal + kamera ---
function buildGimbal(root) {
  const gimbal = createPart({ id: 'gimbal', name: 'Gimbal', parent: root, position: [0, -0.02, -0.17] });
  addMesh(gimbal, plate(0.09, 0.07, 0.005, { radius: 0.01, holes: [slotHole(0, 0.02, 0.05, 0.012)] }), { position: [0, 0.011, 0.02] });
  const g = [
    place(cylY(0.012, 0.012, 0.014, 24), { pos: [0, 0.0, 0] }), // yaw motoru
    place(box(0.082, 0.006, 0.014), { pos: [0, -0.009, 0] }),
  ];
  for (const s of [-1, 1]) {
    g.push(place(box(0.006, 0.044, 0.014), { pos: [s * 0.035, -0.03, 0] }));
    g.push(place(cylX(0.009, 0.008, 20), { pos: [s * 0.041, -0.032, 0] })); // pitch/roll motorları
  }
  for (const [x, z] of [[-0.03, 0.04], [0.03, 0.04], [-0.03, 0.0], [0.03, 0.0]]) {
    g.push(place(new THREE.SphereGeometry(0.0055, 16, 12), { pos: [x, 0.006, z] })); // titreşim sönümleyiciler
  }
  addMesh(gimbal, merge(g));

  const camera = createPart({ id: 'camera', name: 'Kamera', parent: gimbal, position: [0, -0.032, 0] });
  addMesh(camera, roundedBar(0.056, 0.042, 0.05, 0.007, 0.0015));
  addMesh(
    camera,
    merge([
      place(cylZ(0.016, 0.014, 28), { pos: [0, 0, -0.031] }),
      place(cylZ(0.018, 0.004, 28), { pos: [0, 0, -0.04] }),
      place(cylZ(0.012, 0.0012, 28), { pos: [0, 0, -0.0425] }),
      place(new THREE.TorusGeometry(0.0085, 0.0008, 4, 28), { pos: [0, 0, -0.0432] }),
      place(cylX(0.004, 0.064, 12), { pos: [0, 0, 0] }), // eğim mili
      place(box(0.03, 0.002, 0.012), { pos: [0, 0.0215, 0.01] }), // havalandırma
    ]),
  );
}

// --- İniş ayakları: menteşeli montaj çubuğu, bükülmüş boru bacaklar, kızak ---
function buildLeg(root, side) {
  const key = side < 0 ? 'l' : 'r';
  const leg = createPart({
    id: `leg_${key}`,
    name: side < 0 ? 'Sol iniş ayağı' : 'Sağ iniş ayağı',
    parent: root,
    position: [side * 0.17, -0.01, 0],
  });
  addMesh(leg, roundedBar(0.24, 0.012, 0.03, 0.004, 0.001).rotateY(Math.PI / 2));
  const parts = [];
  for (const z of [-0.08, 0.08]) parts.push(place(cylZ(0.008, 0.03, 20), { pos: [0, 0, z] })); // menteşe topuzları
  for (const z of [-0.095, 0.095]) {
    parts.push(
      tube(
        [
          [0, -0.004, z],
          [side * 0.008, -0.06, z * 1.02],
          [side * 0.022, -0.12, z * 1.05],
          [side * 0.03, -0.152, z * 1.06],
        ],
        0.0055,
        24,
        16,
      ),
    );
    parts.push(place(cylY(0.009, 0.009, 0.012, 16), { pos: [side * 0.03, -0.158, z * 1.06] })); // T bağlantısı
  }
  parts.push(place(cylZ(0.0065, 0.3, 20), { pos: [side * 0.03, -0.162, 0] })); // kızak
  for (const z of [-0.15, 0.15]) parts.push(place(new THREE.SphereGeometry(0.0065, 16, 12), { pos: [side * 0.03, -0.162, z] }));
  for (const z of [-0.06, 0.06]) parts.push(place(cylZ(0.0095, 0.035, 20), { pos: [side * 0.03, -0.162, z] })); // lastik ped
  addMesh(leg, merge(parts));
}
