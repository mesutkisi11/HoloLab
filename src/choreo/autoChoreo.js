import * as THREE from 'three';

// JSON'u olmayan modeller için otomatik koreografi üretir.
// Sıra: büyük ve merkezdeki parçalar önce, dıştakiler sonra, küçük silindirik (vida) parçalar en son.
export function generateAutoChoreography(root, parts) {
  if (parts.length < 2) return null;

  root.updateMatrixWorld(true);
  const modelBox = new THREE.Box3().setFromObject(root);
  const center = modelBox.getCenter(new THREE.Vector3());
  const modelSize = modelBox.getSize(new THREE.Vector3());
  const modelMax = Math.max(modelSize.x, modelSize.y, modelSize.z) || 1;

  const infos = parts.map((part) => {
    // Sadece parçanın kendi mesh'leri (alt parçalar hariç) ile kutu hesapla
    const box = new THREE.Box3();
    for (const child of part.children) if (child.isMesh) box.expandByObject(child);
    if (box.isEmpty()) box.setFromObject(part);

    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const volume = dims[0] * dims[1] * dims[2];
    const outward = c.clone().sub(center);
    if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);

    const isScrew = dims[2] < modelMax * 0.12 && dims[0] / dims[1] > 0.6 && dims[2] / dims[1] > 1.8;
    const isFlat = dims[0] / dims[1] < 0.25 && dims[2] > modelMax * 0.3;

    return { part, size, dims, volume, center: c, outward, dist: outward.length(), isScrew, isFlat };
  });

  const maxVolume = Math.max(...infos.map((i) => i.volume)) || 1;
  const radius = modelMax / 2;

  infos.sort((a, b) => score(a) - score(b));
  function score(i) {
    return i.dist / radius - (i.volume / maxVolume) * 1.5 + (i.isScrew ? 10 : 0);
  }

  const parentQ = new THREE.Quaternion();
  const steps = infos.map((info, index) => {
    const { part } = info;
    part.parent.getWorldQuaternion(parentQ);
    const toLocal = parentQ.clone().invert();

    // Takılma ekseni: dışa doğru yöne en yakın ana eksen (X/Y/Z); parça içeri doğru hareket eder
    const o = info.outward.clone().normalize();
    const axisWorld = dominantAxis(o).negate();
    const axis = axisWorld.applyQuaternion(toLocal);
    const from = o.applyQuaternion(toLocal).multiplyScalar(radius * 0.7 + info.dims[2]);

    let motion = 'arc';
    let insert = info.dims[2] * 0.6;
    if (info.isScrew) {
      motion = 'screw';
      insert = info.dims[2];
    } else if (info.isFlat) {
      motion = 'slide';
      insert = info.dims[1] * 0.8;
    }

    return {
      part: part.userData.part.id,
      motion,
      from: from.toArray().map(round),
      axis: axis.toArray().map(round),
      insert: round(insert),
      spin: motion === 'arc' ? { axis: [0, 1, 0], turns: 1 } : undefined,
      screwTurns: motion === 'screw' ? 4 : undefined,
      start: round(index * 0.22),
      duration: motion === 'screw' ? 0.9 : 1.1,
    };
  });

  return { model: root.name, auto: true, steps };
}

function dominantAxis(v) {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(v.x) || 1, 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(v.y) || 1, 0);
  return new THREE.Vector3(0, 0, Math.sign(v.z) || 1);
}

const round = (n) => Math.round(n * 1000) / 1000;
