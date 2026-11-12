import { PointFilter, OneEuroFilter } from './oneEuro.js';

// MediaPipe'ın ham 21 noktasını, hareket tanımada işimize yarayan özelliklere çevirir:
// avuç merkezi, açıklık, yumruk, pinch, el büyüklüğü (derinlik yerine), hız.

export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const FINGERS = [
  { tip: 8, pip: 6, mcp: 5 },
  { tip: 12, pip: 10, mcp: 9 },
  { tip: 16, pip: 14, mcp: 13 },
  { tip: 20, pip: 18, mcp: 17 },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class HandSlot {
  constructor() {
    this.filters = Array.from({ length: 21 }, () => new PointFilter({ minCutoff: 1.2, beta: 0.05 }));
    this.sizeFilter = new OneEuroFilter({ minCutoff: 0.8, beta: 0.01 });
    this.prev = null;
    this.pinching = false;
    this.fist = false;
  }
  reset() {
    for (const f of this.filters) f.reset();
    this.sizeFilter.reset();
    this.prev = null;
    this.pinching = false;
    this.fist = false;
  }
}

export function createHandState() {
  const slots = [new HandSlot(), new HandSlot()];
  let missingFrames = 0;

  function analyze(result, t, dt) {
    const hands = [];
    const raw = result?.landmarks ?? [];
    if (raw.length === 0) {
      missingFrames++;
      if (missingFrames > 10) slots.forEach((s) => s.reset());
      return { hands, tracking: false };
    }
    missingFrames = 0;

    // Eller ekrandaki x konumuna göre sabit bir yuvaya atanır (sol yuva = ekranda soldaki el)
    const ordered = [...raw].sort((a, b) => b[0].x - a[0].x);

    ordered.slice(0, 2).forEach((lm, i) => {
      const slot = slots[i];
      // x'i aynalıyoruz: kullanıcı sağa gidince ekranda da sağa gitsin
      const pts = lm.map((p, j) => slot.filters[j].filter({ x: 1 - p.x, y: p.y, z: p.z }, t));

      const wrist = pts[0];
      const palm = avg([pts[0], pts[5], pts[9], pts[13], pts[17]]);
      const size = slot.sizeFilter.filter(dist(wrist, pts[9]), t);

      // Parmak uzamış mı: uç-bilek mesafesi, orta eklem-bilek mesafesinden büyükse
      const fingersUp = FINGERS.map((f) => dist(pts[f.tip], wrist) > dist(pts[f.pip], wrist) * 1.15);
      const extended = fingersUp.filter(Boolean).length;
      const openness = extended / 4;

      // Pinch: başparmak ucu ile işaret parmağı ucu arasındaki mesafe (el boyuna göre)
      const pinchDist = dist(pts[TIP.thumb], pts[TIP.index]) / Math.max(size, 1e-3);
      // Histerezis: başlaması için 0.35 altına, bitmesi için 0.5 üstüne çıkması gerekir
      slot.pinching = slot.pinching ? pinchDist < 0.45 : pinchDist < 0.28;
      // Üç parmak: orta parmak ucu da başparmağa değiyor
      const middleDist = dist(pts[TIP.thumb], pts[TIP.middle]) / Math.max(size, 1e-3);
      const pinch3 = pinchDist < 0.35 && middleDist < 0.4;
      // İşaret etme: sadece işaret parmağı açık
      const isPointing = fingersUp[0] && extended === 1;
      slot.fist = slot.fist ? extended <= 1 : extended === 0;

      // Parmak yelpazesi: dört parmak ucunun kendi merkezlerinden ortalama uzaklığı (el boyuna göre)
      const tips = [pts[8], pts[12], pts[16], pts[20]];
      const tipCenter = avg(tips);
      const spread = tips.reduce((sum, p) => sum + dist(p, tipCenter), 0) / 4 / Math.max(size, 1e-3);

      const velocity = slot.prev
        ? { x: (palm.x - slot.prev.palm.x) / dt, y: (palm.y - slot.prev.palm.y) / dt }
        : { x: 0, y: 0 };
      const sizeVelocity = slot.prev ? (size - slot.prev.size) / dt : 0;

      const hand = {
        slot: i,
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
        pinchPoint: avg([pts[TIP.thumb], pts[TIP.index]]),
        indexTip: pts[TIP.index],
        spread,
        velocity,
        speed: Math.hypot(velocity.x, velocity.y),
        sizeVelocity,
      };
      slot.prev = { palm, size };
      hands.push(hand);
    });

    if (ordered.length < 2) slots[1].reset();
    return { hands, tracking: true };
  }

  return { analyze };
}

function avg(points) {
  const n = points.length;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
    z: points.reduce((s, p) => s + p.z, 0) / n,
  };
}
