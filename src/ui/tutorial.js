import { STEPS } from './tutorialSteps.js';
import { handPoints, drawHand } from './handPose.js';

// Uygulamalı eğitim: her hareket için sanal bir el hareketi yapar, yanında sonucu gösterilir,
// sağda kullanıcının canlı eli çizilir. Kullanıcı hareketi doğru yapınca sonraki adıma geçilir.
// Açıkken el hareketleri uygulamaya gitmez, sadece burada denenir.

const SEEN_KEY = 'hololab-tutorial-seen';
const NEXT_DELAY = 1.1;

function handName(h) {
  if (h.isFist) return 'yumruk';
  if (h.isPinching) return h.pinch3 ? '3 parmak birleşik' : 'başparmak + işaret birleşik';
  if (h.isPointing) return 'işaret parmağı';
  if (h.isOpen) return 'açık el';
  return 'el';
}

export function createTutorial({ sounds, openGuide }) {
  const overlay = document.createElement('div');
  overlay.className = 'tut';
  overlay.innerHTML = `
    <div class="tut-card">
      <div class="tut-top">
        <span class="tut-section"></span>
        <span class="tut-count"></span>
        <button class="tut-x" aria-label="Kapat">×</button>
      </div>
      <div class="tut-dots"></div>
      <div class="tut-title"></div>
      <canvas class="tut-canvas"></canvas>
      <div class="tut-how"></div>
      <div class="tut-effect"></div>
      <div class="tut-try"><div class="tut-bar"><i></i></div><span></span></div>
      <div class="tut-nav">
        <button data-a="prev">← Geri</button>
        <button data-a="list">Tüm liste</button>
        <button data-a="next" class="primary">Geç →</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (s) => overlay.querySelector(s);
  const canvas = $('.tut-canvas');
  const g = canvas.getContext('2d');
  const dots = $('.tut-dots');
  dots.innerHTML = STEPS.map((_, i) => `<i data-i="${i}"></i>`).join('');

  const btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Hareket eğitimi');
  document.body.appendChild(btn);

  let visible = false;
  let index = 0;
  let stepStart = 0;
  let detector = null;
  let progress = 0;
  let doneAt = null;
  let hands = [];
  let lastHands = -10;
  let lastTime = 0;
  let cameraSeen = false;
  let raf = 0;

  function go(i) {
    index = Math.max(0, Math.min(STEPS.length, i));
    stepStart = performance.now() / 1000;
    detector = STEPS[index]?.detect();
    progress = 0;
    doneAt = null;
    const step = STEPS[index];
    const finished = !step;
    overlay.classList.toggle('finished', finished);
    $('.tut-section').textContent = finished ? 'Bitti' : step.section;
    $('.tut-count').textContent = finished ? '' : `${index + 1} / ${STEPS.length}`;
    $('.tut-title').textContent = finished ? 'Hazırsın!' : step.title;
    $('.tut-how').textContent = finished
      ? 'Bütün hareketleri gördün. Unutursan sağ üstteki ? düğmesiyle bu eğitimi tekrar açabilirsin.'
      : step.how;
    $('.tut-effect').textContent = finished ? '' : step.effect;
    $('[data-a="next"]').textContent = finished ? 'Başla' : 'Geç →';
    $('[data-a="prev"]').disabled = index === 0;
    dots.querySelectorAll('i').forEach((d, k) => {
      d.classList.toggle('on', k === index);
      d.classList.toggle('past', k < index);
    });
    updateTry();
  }

  function updateTry() {
    const step = STEPS[index];
    const text = $('.tut-try span');
    $('.tut-try').classList.toggle('ok', doneAt !== null);
    $('.tut-bar i').style.transform = `scaleX(${doneAt !== null ? 1 : progress})`;
    if (!step) return;
    if (doneAt !== null) text.textContent = '✓ Harika, doğru yaptın!';
    else if (!cameraSeen) text.textContent = 'Kamera kapalı · izleyip "Geç" ile ilerleyebilirsin';
    else if (lastTime - lastHands > 0.6) text.textContent = 'Şimdi sen dene · elini kameraya göster';
    else text.textContent = 'Şimdi sen dene';
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paneTitle(r, text) {
    g.save();
    g.font = '11px "Share Tech Mono", monospace';
    g.fillStyle = 'rgba(95, 230, 255, 0.55)';
    g.fillText(text, r.x + 10, r.y + 18);
    g.strokeStyle = 'rgba(95, 230, 255, 0.16)';
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    g.restore();
  }

  function drawDemo(r, step, u) {
    const unit = r.h * 0.5;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.56;
    const toPane = (p) => ({ x: cx + p.x * unit, y: cy + p.y * unit });
    const list = [].concat(step.pose(u));

    // Hareket izi: elin son birkaç andaki konumu
    const past = [].concat(step.pose((u + 0.82) % 1));
    list.forEach((pose, k) => {
      const moved = Math.hypot((pose.x ?? 0) - (past[k].x ?? 0), (pose.y ?? 0) - (past[k].y ?? 0));
      if (moved < 0.02) return;
      for (let j = 10; j >= 1; j--) {
        const q = [].concat(step.pose((u - j * 0.018 + 1) % 1))[k];
        const p = toPane({ x: q.x ?? 0, y: q.y ?? 0 });
        g.fillStyle = `rgba(95, 230, 255, ${(1 - j / 11) * 0.45})`;
        g.beginPath();
        g.arc(p.x, p.y, 3, 0, Math.PI * 2);
        g.fill();
      }
    });

    for (const pose of list) {
      const pts = handPoints(pose).map(toPane);
      drawHand(g, pts, { highlight: pose.highlight ?? [], width: r.h / 120 });
      if (pose.ring > 0) {
        g.save();
        g.strokeStyle = '#ffae3d';
        g.lineWidth = 2.5;
        g.shadowColor = '#ffae3d';
        g.shadowBlur = 10;
        g.beginPath();
        g.arc(pts[8].x, pts[8].y, 16, -Math.PI / 2, -Math.PI / 2 + pose.ring * Math.PI * 2);
        g.stroke();
        g.restore();
      }
      if (pose.burst > 0) {
        g.save();
        g.strokeStyle = '#ffae3d';
        g.globalAlpha = 1 - pose.burst;
        g.lineWidth = 2;
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const r0 = 10 + pose.burst * 14;
          g.moveTo(pts[4].x + Math.cos(a) * r0, pts[4].y + Math.sin(a) * r0);
          g.lineTo(pts[4].x + Math.cos(a) * (r0 + 10), pts[4].y + Math.sin(a) * (r0 + 10));
        }
        g.stroke();
        g.restore();
      }
      if (pose.tag) {
        const top = Math.min(...pts.map((p) => p.y));
        g.save();
        g.font = '600 15px Rajdhani, sans-serif';
        g.textAlign = 'center';
        g.fillStyle = '#ffae3d';
        g.shadowColor = '#ffae3d';
        g.shadowBlur = 8;
        g.fillText(pose.tag, pts[9].x, Math.max(r.y + 36, top - 12));
        g.restore();
      }
    }
  }

  function drawLive(r) {
    const s = Math.min(r.w, (r.h * 4) / 3);
    const ox = r.x + (r.w - s) / 2;
    const oy = r.y + (r.h - s * 0.75) / 2;
    const live = lastTime - lastHands < 0.6 ? hands : [];
    for (const h of live) {
      const pts = h.points.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s * 0.75 }));
      drawHand(g, pts, { color: '#ffae3d', width: r.h / 150, alpha: 0.9 });
    }
    g.save();
    g.font = '12px "Share Tech Mono", monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230, 251, 255, 0.75)';
    const msg = !cameraSeen ? 'kamera yok' : live.length ? live.map(handName).join(' · ') : 'el görünmüyor';
    g.fillText(msg, r.x + r.w / 2, r.y + r.h - 14);
    g.restore();
  }

  function frame() {
    if (!visible) return;
    raf = requestAnimationFrame(frame);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (Math.round(w * Math.min(window.devicePixelRatio || 1, 2)) !== canvas.width) resize();
    g.clearRect(0, 0, w, h);
    const step = STEPS[index];
    if (!step) return;

    const now = performance.now() / 1000;
    const u = ((now - stepStart) / step.duration) % 1;
    const gap = 8;
    const wDemo = (w - gap * 2) * 0.38;
    const wFx = (w - gap * 2) * 0.36;
    const panes = [
      { x: 0, y: 0, w: wDemo, h },
      { x: wDemo + gap, y: 0, w: wFx, h },
      { x: wDemo + wFx + gap * 2, y: 0, w: w - wDemo - wFx - gap * 2, h },
    ];

    paneTitle(panes[0], 'ÖRNEK HAREKET');
    drawDemo(panes[0], step, u);
    paneTitle(panes[1], 'NE OLUR');
    g.save();
    g.beginPath();
    g.rect(panes[1].x, panes[1].y, panes[1].w, panes[1].h);
    g.clip();
    step.effectDraw(g, panes[1], u);
    g.restore();
    paneTitle(panes[2], 'SENİN ELİN');
    drawLive(panes[2]);
  }

  // Uygulama döngüsünden her karede çağrılır (açıkken)
  function onHands(list, time) {
    const dt = Math.min(0.1, time - lastTime);
    lastTime = time;
    cameraSeen = true;
    if (list.length) {
      hands = list;
      lastHands = time;
    }
    if (!detector) return;
    if (doneAt !== null) {
      if (time - doneAt > NEXT_DELAY) go(index + 1);
      return;
    }
    const raw = detector(list, time) || 0;
    progress = Math.min(1, Math.max(raw, progress - dt * 0.8));
    if (raw >= 1) {
      doneAt = time;
      sounds?.chime();
    }
    updateTry();
  }

  function show(from = 0) {
    visible = true;
    overlay.classList.add('visible');
    resize();
    go(from);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function hide() {
    if (!visible) return;
    visible = false;
    overlay.classList.remove('visible');
    cancelAnimationFrame(raf);
    localStorage.setItem(SEEN_KEY, '1');
  }
  function next() {
    if (index >= STEPS.length) return hide();
    go(index + 1);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    visible ? hide() : show();
  });
  $('.tut-x').addEventListener('click', hide);
  $('[data-a="prev"]').addEventListener('click', () => go(index - 1));
  $('[data-a="next"]').addEventListener('click', next);
  $('[data-a="list"]').addEventListener('click', () => {
    hide();
    openGuide?.();
  });
  dots.addEventListener('click', (e) => {
    const i = e.target.dataset?.i;
    if (i !== undefined) go(Number(i));
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!visible) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') next();
    },
    true,
  );
  window.addEventListener('resize', () => visible && resize());

  if (!localStorage.getItem(SEEN_KEY)) show();

  return { show, hide, onHands, isVisible: () => visible };
}
