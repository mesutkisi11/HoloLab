import * as THREE from 'three';
import { clamp01, easeInOutCubic, easeOutCubic, easeOutBack } from './easing.js';

// Bir adımın her hareket türü için "s" (0 = sökülmüş, 1 = yerinde) değerinden
// parçanın konum ve dönüşünü hesaplar. Saf fonksiyon: ileri-geri sorunsuz çalışır.

const TWO_PI = Math.PI * 2;

// Hareket türüne göre son "takılma" aşamasının adımın ne kadarını kapladığı
const INSERT_FRACTION = {
  straight: 0.3,
  arc: 0.3,
  spiral: 0.35,
  slide: 0.6,
  screw: 0.45,
  hinge: 0.45,
  unfold: 0.45,
};

const v = (arr, fallback) => new THREE.Vector3().fromArray(arr ?? fallback);

// JSON'daki ham adımı hesaplamaya hazır hale getirir (vektörler, ön hesaplar)
export function prepareStep(raw, part) {
  const home = part.userData.part.home;
  const motion = raw.motion ?? 'arc';
  const from = v(raw.from, [0, 0, 0]);
  const hasTravel = from.lengthSq() > 1e-8;
  const axis = v(raw.axis, [0, -1, 0]).normalize();
  const insert = raw.insert ?? 0;

  const start = home.position.clone().add(from);
  const approach = home.position.clone().addScaledVector(axis, -insert);
  const travel = approach.clone().sub(start);
  const dist = travel.length();
  const travelDir = dist > 1e-6 ? travel.clone().divideScalar(dist) : new THREE.Vector3();

  // Arc için kontrol noktası: orta nokta + yukarı kaldırma
  const lift = raw.lift ? v(raw.lift) : new THREE.Vector3(0, dist * 0.6, 0);
  const control = start.clone().lerp(approach, 0.5).add(lift);

  let insertFraction = INSERT_FRACTION[motion] ?? 0.3;
  const isHinge = motion === 'hinge' || motion === 'unfold';
  if (isHinge && !hasTravel) insertFraction = 1;
  if (!isHinge && insert === 0) insertFraction = 0.001;

  return {
    id: part.userData.part.id,
    part,
    motion,
    home,
    start,
    approach,
    axis,
    insert,
    travelDir,
    dist,
    control,
    insertFraction,
    hasTravel,
    spin: raw.spin ? { axis: v(raw.spin.axis, [0, 1, 0]).normalize(), turns: raw.spin.turns ?? 1 } : null,
    hinge: isHinge
      ? {
          axis: v(raw.hinge?.axis, [0, 1, 0]).normalize(),
          angle: THREE.MathUtils.degToRad(raw.hinge?.angle ?? 90),
        }
      : null,
    screwTurns: motion === 'screw' ? (raw.screwTurns ?? 4) : 0,
    startTime: raw.start ?? 0,
    duration: raw.duration ?? 1,
    group: raw.group ?? null,
  };
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// s -> { position, quaternion } (ebeveyn uzayında). out nesnesine yazar.
export function evalStep(step, s, out) {
  s = clamp01(s);
  const k = step.insertFraction;
  const travelEnd = 1 - k;

  // Yolculuk (u) ve takılma (si) fazları
  const u = travelEnd > 0 ? clamp01(s / travelEnd) : 1;
  const si = k > 0 ? clamp01((s - travelEnd) / k) : 1;
  const ue = easeInOutCubic(u);

  const pos = out.position;

  if (si > 0 && step.insert > 0) {
    // Takılma: eksen boyunca düz girer, sonunda hafif aşıp geri oturur
    pos.copy(step.approach).addScaledVector(step.axis, step.insert * easeOutBack(si));
  } else if (step.hasTravel) {
    computePath(step, ue, pos);
    // Anticipation: harekete başlarken küçük bir geri çekilme
    if (u < 0.2 && u > 0) {
      pos.addScaledVector(step.travelDir, -step.dist * 0.06 * Math.sin((Math.PI * u) / 0.2));
    }
  } else {
    pos.copy(step.home.position);
  }

  // Dönüş
  const q = out.quaternion.copy(step.home.quaternion);
  if (step.spin) {
    tmpQ.setFromAxisAngle(step.spin.axis, step.spin.turns * TWO_PI * (1 - ue));
    q.premultiply(tmpQ);
  }
  if (step.screwTurns) {
    tmpQ.setFromAxisAngle(step.axis, step.screwTurns * TWO_PI * (1 - easeOutCubic(si)));
    q.premultiply(tmpQ);
  }
  if (step.hinge) {
    // Menteşe: parça kendi orijini (menteşe noktası) etrafında döner
    tmpQ.setFromAxisAngle(step.hinge.axis, step.hinge.angle * (1 - easeOutBack(si, 0.8)));
    q.multiply(tmpQ);
  }
  return out;
}

function computePath(step, t, pos) {
  switch (step.motion) {
    case 'arc':
    case 'hinge':
    case 'unfold':
      // Quadratic Bezier: başlangıç -> kontrol -> yaklaşma noktası
      tmpA.copy(step.start).lerp(step.control, t);
      tmpB.copy(step.control).lerp(step.approach, t);
      pos.copy(tmpA).lerp(tmpB, t);
      break;
    case 'spiral': {
      // Eksen etrafında dönerek, daralan yarıçapla yaklaşır
      tmpA.copy(step.start).sub(step.approach);
      const along = tmpA.dot(step.axis);
      tmpB.copy(step.axis).multiplyScalar(along); // paralel bileşen
      tmpA.sub(tmpB); // dik bileşen
      tmpA.applyAxisAngle(step.axis, TWO_PI * 1.5 * (1 - t)).multiplyScalar(1 - t);
      pos.copy(step.approach).add(tmpA).addScaledVector(step.axis, along * (1 - t));
      break;
    }
    default:
      // straight, slide, screw: düz çizgi
      pos.copy(step.start).lerp(step.approach, t);
  }
}
