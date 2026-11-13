import { createPinchTap } from '../hands/pinchTap.js';
import { createSnapDetector } from '../hands/snapDetect.js';

// Eğitim adımları. Her adımda:
//   pose(u)   -> örnek elin duruşu (u: 0..1 döngü). Dizi dönerse iki el çizilir.
//   effect    -> o hareketin sonucunu gösteren küçük animasyon
//   detect()  -> kullanıcının canlı elini izleyen algılayıcı; 0..1 ilerleme döner, 1 = başardı

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => x * x * (3 - 2 * x);
const seg = (u, a, b) => ease(clamp01((u - a) / (b - a)));
const bump = (u, a, b) => Math.sin(Math.PI * clamp01((u - a) / (b - a)));
const mix = (A, B, t) => A.map((x, i) => x + (B[i] - x) * t);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const OPEN = [0, 0, 0, 0, 0];
const RELAX = [0.15, 0.2, 0.15, 0.2, 0.25];
const FIST = [0.8, 1, 1, 1, 1];
const POINT = [0.8, 0, 1, 1, 1];
const PINCH2 = [0.35, 0.4, 0.55, 0.75, 0.85];
const BUNCH = [0.3, 0.35, 0.35, 0.35, 0.4];
const SNAP_READY = [0.4, 0.1, 0.5, 0.3, 0.35];
const SNAP_DONE = [0.1, 0.1, 1, 0.45, 0.5];

const TOP = [2, 3, 6, 7]; // küpün üst katmanı

// ---------- Sonuç animasyonları ----------

const CYAN = '#5fe6ff';
const ORANGE = '#ffae3d';

function label(g, r, text, y = r.y + r.h - 16) {
  g.save();
  g.font = '13px "Share Tech Mono", monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(230, 251, 255, 0.85)';
  g.fillText(text, r.x + r.w / 2, y);
  g.restore();
}

// Galeri: yan yana kartlar. cursor = ortadaki kartın sırası
function cards(g, r, { cursor = 2, open = 0, flash = 0, grab = 0, fly = 0, alpha = 1 } = {}) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.45;
  const w = r.w * 0.2;
  const h = w * 1.25;
  g.save();
  g.globalAlpha = alpha;
  for (let i = 0; i < 5; i++) {
    const off = i - cursor;
    const near = Math.max(0, 1 - Math.abs(off));
    const center = i === 2;
    let s = 0.7 + near * 0.3;
    let x = cx + off * w * 1.15;
    let y = cy;
    let a = 0.35 + near * 0.65;
    if (center && open > 0) {
      s += open * 1.6;
      a = 1;
    }
    if (center && fly > 0) {
      x += fly * r.w * 0.36;
      y += fly * r.h * 0.32;
      s *= 1 - fly * 0.6;
      a *= 1 - seg(fly, 0.75, 1);
    }
    if (!center && open > 0) a *= 1 - open;
    const hot = center && (grab > 0 || fly > 0);
    g.globalAlpha = alpha * a;
    g.strokeStyle = hot ? ORANGE : CYAN;
    g.lineWidth = center ? 2 : 1.2;
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = center ? 12 : 4;
    g.strokeRect(x - (w * s) / 2, y - (h * s) / 2, w * s, h * s);
    miniCube(g, x, y - h * s * 0.05, w * s * 0.22, 0.7 + off * 0.3, hot);
    if (center && flash > 0) {
      g.globalAlpha = alpha * flash;
      g.strokeStyle = ORANGE;
      g.beginPath();
      g.arc(x, y, w * s * 0.75, 0, TAU);
      g.stroke();
    }
    if (center && grab > 0 && grab < 1) {
      g.globalAlpha = alpha;
      g.strokeStyle = ORANGE;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, w * s * 0.6, -Math.PI / 2, -Math.PI / 2 + grab * TAU);
      g.stroke();
    }
  }
  g.restore();
}

function trashBin(g, r, alpha) {
  if (alpha <= 0) return;
  const x = r.x + r.w * 0.86;
  const y = r.y + r.h * 0.78;
  const s = r.h * 0.09;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = ORANGE;
  g.lineWidth = 1.6;
  g.shadowColor = ORANGE;
  g.shadowBlur = 10;
  g.beginPath();
  g.moveTo(x - s, y - s);
  g.lineTo(x - s * 0.75, y + s);
  g.lineTo(x + s * 0.75, y + s);
  g.lineTo(x + s, y - s);
  g.moveTo(x - s * 1.2, y - s * 1.2);
  g.lineTo(x + s * 1.2, y - s * 1.2);
  g.stroke();
  g.restore();
}

// 2x2x2 küçük küplerden oluşan tel kafes model
function project(p, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p[0] * cy + p[2] * sy;
  const z1 = -p[0] * sy + p[2] * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x1, p[1] * cp - z1 * sp, p[1] * sp + z1 * cp];
}

const CORNERS = [];
for (let i = 0; i < 8; i++) CORNERS.push([(i & 1) * 2 - 1, (i & 2) - 1, ((i & 4) >> 1) - 1]);
const EDGES = [];
for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if ([1, 2, 4].includes(a ^ b)) EDGES.push([a, b]);

function box(g, cx, cy, size, center, half, yaw, pitch, hot) {
  const pts = CORNERS.map((c) => {
    const [x, y] = project([center[0] + c[0] * half, center[1] + c[1] * half, center[2] + c[2] * half], yaw, pitch);
    return [cx + x * size, cy - y * size];
  });
  g.strokeStyle = hot ? ORANGE : CYAN;
  g.shadowColor = g.strokeStyle;
  g.beginPath();
  for (const [a, b] of EDGES) {
    g.moveTo(...pts[a]);
    g.lineTo(...pts[b]);
  }
  g.stroke();
}

function miniCube(g, x, y, size, yaw, hot) {
  g.save();
  g.lineWidth = 1;
  g.shadowBlur = 4;
  box(g, x, y, size, [0, 0, 0], 1, yaw, 0.5, hot);
  g.restore();
}

// offset(i): i. küçük küpün yerinden kayması [x, y, z]
function cube(g, r, { yaw = 0.7, pitch = 0.45, scale = 1, dy = 0, offset = () => [0, 0, 0], hot = [], alpha = 1 } = {}) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.46 + dy * r.h;
  const size = r.h * 0.13 * scale;
  g.save();
  g.globalAlpha = alpha;
  g.lineWidth = 1.5;
  g.shadowBlur = 8;
  for (let i = 0; i < 8; i++) {
    const base = CORNERS[i].map((v) => v * 0.5);
    const o = offset(i, base);
    box(g, cx, cy, size, base.map((v, k) => v + o[k]), 0.44, yaw, pitch, hot.includes(i));
  }
  g.restore();
}

const outward = (amount) => (i, base) => base.map((v) => v * 2.2 * amount);
const lift = (amount, ids = TOP) => (i) => (ids.includes(i) ? [0, amount * 1.1, 0] : [0, 0, 0]);

function dimension(g, r, z) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.46;
  const s = r.h * 0.13 * (1 + z * 1.6);
  g.save();
  g.globalAlpha = z;
  g.lineWidth = 2;
  g.shadowBlur = 12;
  box(g, cx, cy, s, [0, 0, 0], 0.44, 0.7, 0.45, true);
  g.strokeStyle = 'rgba(230, 251, 255, 0.7)';
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(cx - s * 0.75, cy + s * 0.95);
  g.lineTo(cx + s * 0.75, cy + s * 0.95);
  g.stroke();
  g.setLineDash([]);
  g.font = '12px "Share Tech Mono", monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(230, 251, 255, 0.9)';
  g.fillText('24 × 24 × 24 mm', cx, cy + s * 1.2);
  g.restore();
}

function stepBar(g, r, value, total) {
  const w = r.w * 0.6;
  const x = r.x + (r.w - w) / 2;
  const y = r.y + r.h * 0.83;
  g.save();
  g.strokeStyle = 'rgba(95, 230, 255, 0.3)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.stroke();
  g.strokeStyle = CYAN;
  g.shadowColor = CYAN;
  g.shadowBlur = 8;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w * (value / total), y);
  g.stroke();
  g.restore();
  label(g, r, `ADIM ${Math.round(value)} / ${total}`, y - 10);
}

// ---------- Algılayıcı yardımcıları ----------

function openSpeed(test) {
  return () => (hands) => {
    const h = hands[0];
    return h?.isOpen ? test(h) : 0;
  };
}

// ---------- Adımlar ----------

export const STEPS = [
  {
    section: 'Galeri',
    title: 'Tasarımlar arasında gez',
    how: 'Elini açık tut, yavaşça sağa ve sola kaydır',
    effect: 'Tasarımlar elinle birlikte kayar. Hızlı savurursan birkaç tane birden geçer.',
    duration: 3,
    pose: (u) => ({ curl: OPEN, x: Math.sin(u * TAU) * 0.5, y: 0.05 }),
    effectDraw: (g, r, u) => cards(g, r, { cursor: 2 - Math.sin(u * TAU) }),
    detect: () => {
      let span = null;
      return (hands) => {
        const h = hands[0];
        if (!h?.isOpen) {
          span = null;
          return 0;
        }
        if (!span) span = { min: h.palm.x, max: h.palm.x };
        span.min = Math.min(span.min, h.palm.x);
        span.max = Math.max(span.max, h.palm.x);
        return (span.max - span.min) / 0.22;
      };
    },
  },
  {
    section: 'Galeri',
    title: 'Tasarımı aç',
    how: 'Başparmak ile işaret parmağını iki kez hızlıca birbirine değdir',
    effect: 'Ortadaki tasarımın içine girersin. (Kısa bir yumruk da aynı işi yapar.)',
    duration: 2.6,
    pose: (u) => {
      const p = bump(u, 0.12, 0.26) + bump(u, 0.32, 0.46);
      const tag = u > 0.1 && u < 0.29 ? '1' : u > 0.3 && u < 0.5 ? '2' : null;
      return { curl: [0.3, 0.3, 0.15, 0.2, 0.25], pinch: p, highlight: [4, 8], tag };
    },
    effectDraw: (g, r, u) =>
      cards(g, r, {
        flash: Math.max(bump(u, 0.15, 0.3), bump(u, 0.35, 0.5)),
        open: seg(u, 0.5, 0.72) * (1 - seg(u, 0.9, 1)),
      }),
    detect: () => {
      const tap = createPinchTap();
      let p = 0;
      let at = 0;
      return (hands, time) => {
        const r = tap.update(hands[0], time);
        if (r === 'tap') {
          p = 0.5;
          at = time;
        }
        if (r === 'double') p = 1;
        if (p === 0.5 && time - at > 0.8) p = 0;
        return p;
      };
    },
  },
  {
    section: 'Galeri',
    title: 'Tasarımı sil',
    how: 'Avucunu kapat, biraz tut, sonra çöpe doğru savur',
    effect: 'Tasarım çöpe gider. 5 saniye içinde açık eli kendine çekersen geri gelir.',
    duration: 3.2,
    pose: (u) => {
      const closed = seg(u, 0.06, 0.18) * (1 - seg(u, 0.78, 0.88));
      const move = seg(u, 0.5, 0.68) * (1 - seg(u, 0.88, 1));
      return { curl: mix(OPEN, FIST, closed), x: move * 0.5, y: move * 0.3, highlight: closed > 0.9 ? [9] : [] };
    },
    effectDraw: (g, r, u) => {
      trashBin(g, r, seg(u, 0.18, 0.25) * (1 - seg(u, 0.8, 0.88)));
      cards(g, r, { grab: seg(u, 0.2, 0.45), fly: seg(u, 0.5, 0.7), alpha: u > 0.7 ? seg(u, 0.88, 1) : 1 });
    },
    detect: () => {
      let f = null;
      return (hands, time) => {
        const h = hands[0];
        if (!h?.isFist) {
          f = null;
          return 0;
        }
        if (!f) f = { t: time, x: h.palm.x, y: h.palm.y };
        const held = time - f.t;
        if (held < 0.35) return (held / 0.35) * 0.5;
        return 0.5 + (Math.hypot(h.palm.x - f.x, h.palm.y - f.y) / 0.15) * 0.5;
      };
    },
  },
  {
    section: 'Model',
    title: 'Modeli döndür',
    how: 'Açık elle sürükle ya da elini kapı topuzu gibi çevir',
    effect: 'Model elinle döner. Savurup bırakırsan bir süre dönmeye devam eder.',
    duration: 4,
    pose: (u) => {
      if (u < 0.5) return { curl: OPEN, x: Math.sin((u / 0.5) * TAU) * 0.4, tag: 'sürükle' };
      return { curl: OPEN, roll: Math.sin(((u - 0.5) / 0.5) * TAU) * 0.6, tag: 'çevir' };
    },
    effectDraw: (g, r, u) => {
      const yaw = u < 0.5 ? Math.sin((u / 0.5) * TAU) * 1.1 : -Math.sin(((u - 0.5) / 0.5) * TAU) * 0.95;
      cube(g, r, { yaw: 0.7 + yaw });
    },
    detect: () => {
      let last = null;
      let acc = 0;
      return (hands) => {
        const h = hands[0];
        if (!h?.isOpen) {
          last = null;
          return acc;
        }
        if (last) {
          const moved = Math.hypot(h.palm.x - last.x, h.palm.y - last.y);
          if (moved > 0.002) acc += moved / 0.35;
          if (h.rollValid && last.rollValid) {
            const twist = Math.abs(angleDelta(h.roll, last.roll));
            if (twist > 0.01) acc += twist / 1.2;
          }
        }
        last = { x: h.palm.x, y: h.palm.y, roll: h.roll, rollValid: h.rollValid };
        return acc;
      };
    },
  },
  {
    section: 'Model',
    title: 'Sök / tak',
    how: 'İki elinin başparmaklarını birbirine değdir, sonra ellerini ayır ya da yaklaştır',
    effect: 'Başparmaklar değince model birleşir, ellerini ayırdıkça parçalar sökülür.',
    duration: 3.6,
    pose: (u) => {
      const apart = seg(u, 0.32, 0.6) * (1 - seg(u, 0.7, 0.92));
      const tag = u > 0.08 && u < 0.3 ? 'değdir = birleşir' : u > 0.34 && u < 0.66 ? 'ayır = sök' : u > 0.7 && u < 0.92 ? 'yaklaştır = tak' : null;
      const hand = { curl: RELAX, scale: 0.7, y: 0.1, highlight: [4], tag: null };
      const x = 0.33 + 0.12 * (1 - seg(u, 0, 0.12)) + apart * 0.3;
      return [
        { ...hand, x: -x, mirror: true },
        { ...hand, x, tag },
      ];
    },
    effectDraw: (g, r, u) => {
      const apart = seg(u, 0.32, 0.6) * (1 - seg(u, 0.7, 0.92));
      const loose = 1 - seg(u, 0, 0.12) + seg(u, 0.94, 1);
      const p = Math.max(apart, loose * 0.4);
      cube(g, r, { offset: outward(p * 0.5), hot: apart > 0.05 ? [0, 1, 2, 3, 4, 5, 6, 7] : [] });
    },
    detect: () => {
      let touched = false;
      return (hands) => {
        if (hands.length < 2 || hands[0].isFist || hands[1].isFist) return touched ? 0.4 : 0;
        const [h1, h2] = hands;
        const gap = dist(h1.points[4], h2.points[4]) / Math.max((h1.size + h2.size) / 2, 1e-3);
        if (gap < 0.4) touched = true;
        return touched ? 0.4 + clamp01((gap - 0.4) / 1.1) * 0.6 : 0;
      };
    },
  },
  {
    section: 'Model',
    title: 'Bir parçayı çıkar',
    how: 'Parçanın üstünde başparmak ile işaret parmağını birleştir ve çek',
    effect: 'Parça elinle gelir. Bırakınca yerine yakınsa kendiliğinden oturur.',
    duration: 3.2,
    pose: (u) => {
      const move = seg(u, 0.3, 0.65) - seg(u, 0.8, 1);
      return {
        curl: mix(RELAX, PINCH2, seg(u, 0.05, 0.15) * (1 - seg(u, 0.85, 0.95))),
        pinch: seg(u, 0.15, 0.28) * (1 - seg(u, 0.68, 0.78)),
        x: move * 0.4,
        y: -move * 0.3,
        highlight: [4, 8],
        tag: u > 0.3 && u < 0.68 ? 'çek' : u > 0.7 && u < 0.85 ? 'bırak' : null,
      };
    },
    effectDraw: (g, r, u) => {
      const pull = seg(u, 0.3, 0.65) * (1 - seg(u, 0.72, 0.86));
      cube(g, r, { offset: (i) => (i === 7 ? [pull * 1.3, pull * 1.1, pull * 0.3] : [0, 0, 0]), hot: u > 0.28 && u < 0.8 ? [7] : [] });
      if (u > 0.74 && u < 0.95) label(g, r, 'yerine oturdu');
    },
    detect: () => {
      let s = null;
      return (hands) => {
        const h = hands[0];
        if (!h?.isPinching) {
          s = null;
          return 0;
        }
        if (!s) s = { x: h.palm.x, y: h.palm.y };
        return 0.2 + (Math.hypot(h.palm.x - s.x, h.palm.y - s.y) / 0.12) * 0.8;
      };
    },
  },
  {
    section: 'Model',
    title: 'Parçayı yakından incele',
    how: 'Sadece işaret parmağını uzat ve sökülmüş bir parçanın üstünde yarım saniye tut',
    effect: 'Parça büyür, ölçüleri görünür.',
    duration: 3.2,
    pose: (u) => ({ curl: POINT, y: 0.05 - 0.08 * seg(u, 0, 0.2), highlight: [8], ring: seg(u, 0.2, 0.55) * (1 - seg(u, 0.9, 1)) }),
    effectDraw: (g, r, u) => {
      const z = seg(u, 0.55, 0.7) * (1 - seg(u, 0.9, 1));
      cube(g, r, { offset: outward(0.3), hot: u > 0.2 ? [7] : [], alpha: 1 - z * 0.85 });
      if (z > 0) dimension(g, r, z);
    },
    detect: () => {
      let t0 = null;
      return (hands, time) => {
        const h = hands[0];
        if (!h?.isPointing) {
          t0 = null;
          return 0;
        }
        if (t0 === null) t0 = time;
        return (time - t0) / 0.6;
      };
    },
  },
  {
    section: 'Model',
    title: 'Sonraki / önceki adım',
    how: 'Açık elle hızlıca sağa (sonraki) ya da sola (önceki) savur',
    effect: 'Montaj bir adım ilerler ya da geri gider.',
    duration: 2.8,
    pose: (u) => {
      const fast = seg(u, 0.3, 0.42);
      const back = seg(u, 0.55, 1);
      return { curl: mix(OPEN, RELAX, bump(u, 0.5, 1)), x: -0.45 + fast * 0.9 - back * 0.9, tag: u > 0.3 && u < 0.5 ? 'hızlı' : null };
    },
    effectDraw: (g, r, u) => {
      const t = seg(u, 0.42, 0.6) * (1 - seg(u, 0.9, 1));
      cube(g, r, { offset: lift(2.2 * (1 - t)), alpha: 1, hot: t > 0 && t < 1 ? TOP : [] });
      stepBar(g, r, 1 + t, 2);
    },
    detect: openSpeed((h) => (Math.abs(h.velocity.y) < Math.abs(h.velocity.x) * 0.6 ? Math.abs(h.velocity.x) / 1.5 : 0)),
  },
  {
    section: 'Model',
    title: 'Patlat',
    how: 'Açık avucunu hızla kameraya doğru it',
    effect: 'Bütün parçalar birbirinden ayrılır (exploded view).',
    duration: 2.8,
    pose: (u) => ({ curl: OPEN, scale: 0.85 + seg(u, 0.3, 0.42) * 0.5 - seg(u, 0.6, 1) * 0.5, tag: u > 0.28 && u < 0.5 ? 'öne it' : null }),
    effectDraw: (g, r, u) => cube(g, r, { offset: outward(seg(u, 0.4, 0.55) * (1 - seg(u, 0.85, 1)) * 0.6) }),
    detect: openSpeed((h) => h.sizeVelocity / Math.max(h.size, 1e-3) / 1.2),
  },
  {
    section: 'Model',
    title: 'Büyüt / küçült',
    how: 'İki elinde de başparmak ile işaret parmağını birleştir, ellerini aç (büyüt) ya da yaklaştır (küçült)',
    effect: 'Eller açıldıkça model büyür, yaklaştıkça küçülür. Bitince parmaklarını bırak.',
    duration: 3.2,
    pose: (u) => {
      const w = bump(u, 0.12, 0.9);
      const p = seg(u, 0, 0.1) * (1 - seg(u, 0.9, 1));
      const hand = { curl: PINCH2, pinch: p, scale: 0.7, highlight: [4, 8] };
      const tag = u > 0.12 && u < 0.5 ? 'aç = büyüt' : u > 0.52 && u < 0.9 ? 'yaklaştır = küçült' : null;
      return [
        { ...hand, x: -0.34 - w * 0.3, mirror: true },
        { ...hand, x: 0.34 + w * 0.3, tag },
      ];
    },
    effectDraw: (g, r, u) => cube(g, r, { scale: 1 + bump(u, 0.12, 0.9) * 0.6 }),
    detect: () => {
      let d0 = null;
      return (hands) => {
        if (hands.length < 2 || !hands[0].isPinching || !hands[1].isPinching) {
          d0 = null;
          return 0;
        }
        const d = dist(hands[0].palm, hands[1].palm);
        if (d0 === null) d0 = d;
        return 0.2 + (Math.abs(d - d0) / 0.12) * 0.8;
      };
    },
  },
  {
    section: 'Model',
    title: 'Tek elle yakınlaştır / uzaklaştır',
    how: 'Beş parmağının ucunu bir noktada topla, sonra elini kameraya doğru aç',
    effect: 'Elini açtıkça model yaklaşır, parmaklarını tekrar topladıkça uzaklaşır.',
    duration: 3.6,
    pose: (u) => {
      const open = seg(u, 0.22, 0.48) * (1 - seg(u, 0.62, 0.88));
      const tag = u > 0.04 && u < 0.2 ? 'topla' : u > 0.22 && u < 0.55 ? 'aç = yakınlaştır' : u > 0.62 && u < 0.9 ? 'topla = uzaklaştır' : null;
      return {
        curl: mix(BUNCH, OPEN, open),
        pinch: 1 - open,
        pinchTips: [4, 8, 12, 16, 20],
        scale: 0.85 + open * 0.3,
        highlight: [4, 8, 12, 16, 20],
        tag,
      };
    },
    effectDraw: (g, r, u) => cube(g, r, { scale: 0.8 + seg(u, 0.22, 0.48) * (1 - seg(u, 0.62, 0.88)) * 0.8 }),
    detect: () => {
      let start = null;
      return (hands) => {
        const h = hands[0];
        if (!h || h.isFist) {
          start = null;
          return 0;
        }
        if (h.isBunched) start = start === null ? h.tipSpread : Math.min(start, h.tipSpread);
        if (start === null) return 0;
        return 0.3 + clamp01((h.tipSpread - start) / 0.6) * 0.7;
      };
    },
  },
  {
    section: 'Model',
    title: 'Tam montaj',
    how: 'İki elini yumruk yap, ayrı tut, sonra yumrukları birleştir',
    effect: 'Bütün parçalar tek seferde yerine oturur.',
    duration: 3.2,
    pose: (u) => {
      const t = seg(u, 0.3, 0.48) * (1 - seg(u, 0.78, 1));
      const hand = { curl: FIST, scale: 0.7, highlight: [9] };
      return [
        { ...hand, x: -0.5 + t * 0.32, mirror: true },
        { ...hand, x: 0.5 - t * 0.32 },
      ];
    },
    effectDraw: (g, r, u) => cube(g, r, { offset: outward((1 - seg(u, 0.36, 0.52) + seg(u, 0.82, 1)) * 0.6) }),
    detect: () => {
      let apart = false;
      return (hands) => {
        if (hands.length < 2 || !hands[0].isFist || !hands[1].isFist) return apart ? 0.4 : 0;
        const d = dist(hands[0].palm, hands[1].palm);
        if (d > 0.28) apart = true;
        if (!apart) return 0.2;
        return d < 0.16 ? 1 : 0.4 + clamp01((0.28 - d) / 0.12) * 0.6;
      };
    },
  },
  {
    section: 'Model',
    title: 'Geri al / galeriye dön',
    how: 'Parmak şıklat: başparmak ile orta parmağı bastır, sonra orta parmağı avucuna çarpar gibi bırak',
    effect: 'Her şıklatma bir adım geri alır. En başa gelince şıklatırsan galeriye çıkarsın.',
    duration: 4,
    pose: (u) => {
      const s1 = seg(u, 0.24, 0.3) * (1 - seg(u, 0.4, 0.5));
      const s2 = seg(u, 0.6, 0.66) * (1 - seg(u, 0.76, 0.86));
      const snap = Math.max(s1, s2);
      const tag = (u > 0.24 && u < 0.4) || (u > 0.6 && u < 0.76) ? 'şıklat!' : u < 0.22 || (u > 0.5 && u < 0.6) ? 'bastır' : null;
      return { curl: mix(SNAP_READY, SNAP_DONE, snap), pinch: 1 - snap, pinchTips: [4, 12], highlight: [4, 12], tag, burst: snap > 0.3 && snap < 0.99 ? snap : 0 };
    },
    effectDraw: (g, r, u) => {
      const back1 = seg(u, 0.27, 0.42);
      const back2 = seg(u, 0.63, 0.78);
      const out = seg(u, 0.8, 0.9) * (1 - seg(u, 0.95, 1));
      const reset = seg(u, 0.95, 1);
      if (out < 1) {
        const top = back1 * (1 - reset);
        const all = back2 * (1 - reset);
        cube(g, r, {
          offset: (i, base) => base.map((v, k) => v * 1.3 * all + (TOP.includes(i) && k === 1 ? top * 1.1 : 0)),
          scale: 1 - out * 0.6,
          alpha: 1 - out,
        });
        stepBar(g, r, (2 - back1 - back2) * (1 - reset) + 2 * reset, 2);
      }
      if (out > 0) cards(g, r, { alpha: out });
      if (out > 0.5) label(g, r, 'galeri', r.y + 30);
    },
    detect: () => {
      const snaps = [createSnapDetector(), createSnapDetector()];
      return (hands, time) => (hands.some((h) => snaps[h.slot].update(h, time)) ? 1 : 0);
    },
  },
];
