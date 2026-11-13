import { PointFilter, OneEuroFilter } from './oneEuro.js';

// MediaPipe'ın ham 21 noktasını hareket tanımada işe yarayan özelliklere çevirir:
// avuç merkezi, açıklık, yumruk, pinch, işaret etme, el büyüklüğü (derinlik yerine), hız.
// Sadece YENİ bir algılama sonucu geldiğinde çağrılır; zaman = kamera karesinin zamanı.

export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const FINGERS = [
  { tip: 8, pip: 6 },
  { tip: 12, pip: 10 },
  { tip: 16, pip: 14 },
  { tip: 20, pip: 18 },
];

// Hız, son 100 ms'deki konum değişiminden hesaplanır (tek kare farkı çok gürültülü)
const VELOCITY_WINDOW = 0.1;
const LOST_RESET = 0.35; // el bu kadar saniye görünmezse filtreler sıfırlanır

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class HandSlot {
  constructor() {
    // Hareket ederken gecikmesiz, dururken titremesiz: beta yüksek, minCutoff orta
    this.filters = Array.from({ length: 21 }, () => new PointFilter({ minCutoff: 1.7, beta: 6, dCutoff: 1.2 }));
    this.sizeFilter = new OneEuroFilter({ minCutoff: 1.0, beta: 2 });
    this.reset();
  }
  reset() {
    for (const f of this.filters) f.reset();
    this.sizeFilter?.reset();
    this.history = [];
    this.pinching = false;
    this.fist = false;
    this.lastSeen = -1;
  }
}

export function createHandState() {
  const slots = [new HandSlot(), new HandSlot()];

  function assignSlots(raw, handedness) {
    // Önce MediaPipe'ın sağ/sol etiketiyle eşle (eller çaprazlansa da yuva değişmez)
    const labels = raw.map((_, i) => handedness?.[i]);
    if (raw.length === 2 && labels[0] && labels[1] && labels[0] !== labels[1]) {
      return raw.map((lm, i) => ({ lm, slot: labels[i] === 'Right' ? 1 : 0 }));
    }
    if (raw.length === 1 && labels[0]) return [{ lm: raw[0], slot: labels[0] === 'Right' ? 1 : 0 }];
    // Etiket yoksa ekrandaki konuma göre (aynalı: x büyük = kullanıcının solu)
    return [...raw]
      .sort((a, b) => b[0].x - a[0].x)
      .slice(0, 2)
      .map((lm, i) => ({ lm, slot: i }));
  }

  function analyze(result, t) {
    const raw = result?.landmarks ?? [];
    const hands = [];

    for (const slot of slots) {
      if (slot.lastSeen >= 0 && t - slot.lastSeen > LOST_RESET) slot.reset();
    }
    if (raw.length === 0) return { hands, tracking: false };

    for (const { lm, slot: index } of assignSlots(raw, result.handedness)) {
      const slot = slots[index];
      slot.lastSeen = t;
      // x'i aynalıyoruz: kullanıcı sağa gidince ekranda da sağa gitsin
      const pts = lm.map((p, j) => slot.filters[j].filter({ x: 1 - p.x, y: p.y, z: p.z }, t));

      const wrist = pts[0];
      const palm = avg([pts[0], pts[5], pts[9], pts[13], pts[17]]);
      const size = slot.sizeFilter.filter(dist(wrist, pts[9]), t);
      const unit = Math.max(size, 1e-3);

      // Parmak açık mı: uç-bilek mesafesi, orta eklem-bilek mesafesinden belirgin büyükse
      const up = FINGERS.map((f) => dist(pts[f.tip], wrist) > dist(pts[f.pip], wrist) * 1.12);
      const extended = up.filter(Boolean).length;
      const openness = extended / 4;

      // Pinch: başparmak ucu ile işaret ucu (el boyuna oranla). Histerezis: girmek kolay değil, çıkmak da.
      const pinchDist = dist(pts[TIP.thumb], pts[TIP.index]) / unit;
      slot.pinching = slot.pinching ? pinchDist < 0.5 : pinchDist < 0.33;
      const middleDist = dist(pts[TIP.thumb], pts[TIP.middle]) / unit;
      const pinch3 = pinchDist < 0.4 && middleDist < 0.45;
      slot.fist = slot.fist ? extended <= 1 : extended === 0 && pinchDist > 0.25;
      const isPointing = up[0] && !up[1] && !up[2];
      // El dönüşü (topuz çevirir gibi): işaret kökü -> serçe kökü çizgisinin ekrandaki açısı.
      // Avuç yana dönünce bu çizgi kısalır; o zaman açı güvenilmez sayılır.
      const kx = pts[17].x - pts[5].x;
      const ky = pts[17].y - pts[5].y;
      const roll = Math.atan2(ky, kx);
      const rollValid = Math.hypot(kx, ky) > unit * 0.35;

      // Zaman penceresi ile hız
      slot.history.push({ t, x: palm.x, y: palm.y, size });
      while (slot.history.length > 2 && t - slot.history[0].t > VELOCITY_WINDOW) slot.history.shift();
      const first = slot.history[0];
      const span = t - first.t;
      const velocity = span > 0.02 ? { x: (palm.x - first.x) / span, y: (palm.y - first.y) / span } : { x: 0, y: 0 };
      const sizeVelocity = span > 0.02 ? (size - first.size) / span : 0;

      hands.push({
        slot: index,
        points: pts,
        palm,
        size,
        openness,
        isOpen: openness >= 0.75 && !slot.pinching,
        isFist: slot.fist,
        isPinching: slot.pinching && !slot.fist,
        pinchDist,
        pinch3,
        isPointing,
        roll,
        rollValid,
        pinchPoint: avg([pts[TIP.thumb], pts[TIP.index]]),
        indexTip: pts[TIP.index],
        velocity,
        speed: Math.hypot(velocity.x, velocity.y),
        sizeVelocity,
      });
    }

    hands.sort((a, b) => a.palm.x - b.palm.x);
    return { hands, tracking: true };
  }

  return { analyze };
}

function avg(points) {
  const n = points.length;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}
