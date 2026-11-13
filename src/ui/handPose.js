// Eğitim ekranındaki sanal el: parmak bükülmesi ve pinch değerlerinden 21 noktalı el iskeleti üretir.
// Nokta sırası MediaPipe ile aynı, böylece kullanıcının canlı eli de aynı fonksiyonla çizilir.

const BEND = [75, 95, 65].map((d) => (d * Math.PI) / 180);
const THUMB = { base: [-0.11, -0.12], angle: -52, len: [0.17, 0.14, 0.12] };
const FINGERS = [
  { base: [-0.15, -0.5], angle: -9, len: [0.2, 0.13, 0.1] },
  { base: [-0.02, -0.53], angle: -2, len: [0.23, 0.15, 0.11] },
  { base: [0.1, -0.5], angle: 6, len: [0.21, 0.14, 0.1] },
  { base: [0.2, -0.43], angle: 15, len: [0.16, 0.1, 0.09] },
];
const PIVOT = [0, -0.32]; // avuç ortası: döndürme ve ölçek bunun etrafında

export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const PALM = [0, 1, 5, 9, 13, 17];

const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

// Parmağın kökünden ucuna: her eklemde ekrana (z) doğru bükülür
function chain(base, angleDeg, len, curl, bendDir) {
  const a = (angleDeg * Math.PI) / 180;
  const d = [Math.sin(a), -Math.cos(a), 0];
  const dot = d[0] * bendDir[0] + d[1] * bendDir[1] + d[2] * bendDir[2];
  const n = norm(bendDir.map((x, i) => x - d[i] * dot));
  const pts = [];
  let p = [base[0], base[1], 0];
  let th = 0;
  for (let i = 0; i < 3; i++) {
    th += BEND[i] * curl;
    const c = Math.cos(th);
    const s = Math.sin(th);
    p = p.map((x, k) => x + (d[k] * c + n[k] * s) * len[i]);
    pts.push(p);
  }
  return pts;
}

// pose: { curl: [başparmak, işaret, orta, yüzük, serçe], pinch 0..1, pinchTips, x, y, scale, roll, mirror }
export function handPoints(pose) {
  const curl = pose.curl ?? [0, 0, 0, 0, 0];
  const pts = [[0, 0, 0], [THUMB.base[0], THUMB.base[1], 0]];
  pts.push(...chain(THUMB.base, THUMB.angle, THUMB.len, curl[0], [0.8, 0.1, 0.6]));
  FINGERS.forEach((f, i) => {
    pts.push([f.base[0], f.base[1], 0], ...chain(f.base, f.angle, f.len, curl[i + 1], [0, 0, 1]));
  });

  // Pinch: başparmak ucu ile seçilen parmak uçları ortada buluşur
  const p = pose.pinch ?? 0;
  if (p > 0) {
    const tips = pose.pinchTips ?? [4, 8];
    const meet = [0, 1, 2].map((k) => tips.reduce((s, t) => s + pts[t][k], 0) / tips.length);
    for (const t of tips) {
      const shift = pts[t].map((x, k) => (meet[k] - x) * p);
      pts[t] = pts[t].map((x, k) => x + shift[k]);
      pts[t - 1] = pts[t - 1].map((x, k) => x + shift[k] * 0.45);
    }
  }

  const scale = pose.scale ?? 1;
  const roll = pose.roll ?? 0;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const m = pose.mirror ? -1 : 1;
  return pts.map(([x, y, z]) => {
    const persp = 1 / (1 - z * 0.3);
    const lx = (x - PIVOT[0]) * persp * m;
    const ly = (y - PIVOT[1]) * persp;
    return {
      x: (pose.x ?? 0) + (lx * cos - ly * sin) * scale,
      y: (pose.y ?? 0) + (lx * sin + ly * cos) * scale,
      z,
    };
  });
}

// pts: pano koordinatında 21 nokta. highlight: turuncu yanacak noktalar
export function drawHand(g, pts, { color = '#5fe6ff', accent = '#ffae3d', highlight = [], alpha = 1, width = 2.2 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  g.beginPath();
  PALM.forEach((i, k) => (k ? g.lineTo(pts[i].x, pts[i].y) : g.moveTo(pts[i].x, pts[i].y)));
  g.closePath();
  g.fillStyle = 'rgba(95, 230, 255, 0.07)';
  g.fill();

  g.strokeStyle = color;
  g.lineWidth = width;
  g.shadowColor = color;
  g.shadowBlur = 8;
  g.beginPath();
  for (const [a, b] of BONES) {
    g.moveTo(pts[a].x, pts[a].y);
    g.lineTo(pts[b].x, pts[b].y);
  }
  g.stroke();

  pts.forEach((p, i) => {
    const hot = highlight.includes(i);
    g.fillStyle = hot ? accent : color;
    g.shadowColor = hot ? accent : color;
    g.shadowBlur = hot ? 16 : 6;
    g.beginPath();
    g.arc(p.x, p.y, hot ? width * 2.6 : width * 1.3, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
}
