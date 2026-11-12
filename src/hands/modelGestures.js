import * as THREE from 'three';
import { clamp01 } from '../choreo/easing.js';

// Model ekranındaki el hareketleri. Öncelik sırası:
// 1) süren parça tutma  2) ağır çekim modifiye edici  3) iki el  4) tek el
//
// Tek el hareketleri:
//   parmakları aç/kapat (yelpaze)  -> sök / birleştir (ilerleme)
//   işaret parmağı parçaya yaklaş  -> hedefleme halkası
//   pinch parça üstünde + çek      -> parçayı çıkar
//   pinch boşlukta + sürükle       -> döndür
//   hızlı sağa/sola kaydır         -> sonraki/önceki adım
//   hızlı yukarı kaydır            -> galeriye dön
//   avucu hızla öne it             -> patlat (exploded view)
// İki el:
//   iki pinch boşlukta aç/kapat    -> yakınlaştır
//   iki yumruğu birleştir          -> tam montaj
//   bir yumruk sabit + diğer el    -> ağır çekim

const SPREAD_GAIN = 3.5;
const SWIPE_SPEED = 1.8;
const PUSH_RATE = 1.4; // el boyutunun saniyede %140 büyümesi = öne itme
const COOLDOWN = 0.9;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const toNdc = (p) => [p.x * 2 - 1, -(p.y * 2 - 1)];

export function createModelGestures(ctx) {
  let scrub = null;
  let scrubDwell = 0;
  let pinch = null; // { mode: 'grab' | 'rotate', slot, last }
  let zoom = null;
  let fistsApart = false;
  let cooldownUntil = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const handWorld = new THREE.Vector3();

  function update(hands, dt, time) {
    if (pinch?.mode === 'grab') return continueGrab(hands, dt, time);

    // Ağır çekim: yumruk boşlukta ve sabit duruyorsa diğer el yavaş çalışır
    const stillFist = hands.find((h) => h.isFist && h.speed < 0.35 && !overModel(h));
    const slowMo = hands.length === 2 && !!stillFist;
    ctx.setSlowMo(slowMo);
    if (slowMo) ctx.hud.showGesture('Ağır çekim');

    const active = slowMo ? hands.filter((h) => h !== stillFist) : hands;

    if (active.length === 2) {
      scrub = null;
      pinch = null;
      ctx.ring.set(null, false);
      return twoHands(active, dt, time);
    }
    zoom = null;
    fistsApart = false;
    if (active.length === 1) return oneHand(active[0], dt, time);

    scrub = null;
    pinch = null;
    ctx.ring.set(null, false);
    ctx.visuals.setArc(null, null, false);
  }

  function overModel(h) {
    return ctx.grab.hoverAt(...toNdc(h.palm)) !== null;
  }

  // ---------- İki el ----------
  function twoHands(hands, dt, time) {
    const [h1, h2] = hands;
    const d = dist(h1.palm, h2.palm);

    if (h1.isFist && h2.isFist) {
      if (d > 0.28) fistsApart = true;
      if (fistsApart && d < 0.16 && time > cooldownUntil) {
        fistsApart = false;
        cooldownUntil = time + COOLDOWN;
        ctx.hud.showGesture('Tam montaj');
        ctx.fullAssemble();
      }
      return;
    }

    if (h1.isPinching && h2.isPinching) {
      if (!zoom) {
        zoom = { d0: d };
        ctx.hud.showGesture('Yakınlaştır');
      } else {
        ctx.zoom(zoom.d0 / Math.max(d, 1e-3));
        zoom.d0 = d;
      }
      return;
    }
    zoom = null;
  }

  // ---------- Tek el ----------
  function oneHand(h, dt, time) {
    // Pinch: parça üstündeyse tut, boşluktaysa döndür
    if (h.isPinching) {
      scrub = null;
      ctx.visuals.setArc(null, null, false);
      if (!pinch) {
        const hover = ctx.grab.hoverAt(...toNdc(h.indexTip));
        if (hover) {
          const depth = ctx.grab.depthOf(hover);
          ctx.visuals.toWorld(h.pinchPoint, depth, handWorld);
          if (ctx.grab.begin(hover, handWorld)) {
            pinch = { mode: 'grab', slot: h.slot, depth, id: hover };
            ctx.ring.set(ctx.getPart(hover), true);
            ctx.hud.showGesture('Parçayı tut');
            return;
          }
        }
        pinch = { mode: 'rotate', slot: h.slot, last: { ...h.pinchPoint } };
        ctx.hud.showGesture('Döndür');
      } else if (pinch.mode === 'rotate') {
        ctx.rotate(h.pinchPoint.x - pinch.last.x, h.pinchPoint.y - pinch.last.y);
        pinch.last = { ...h.pinchPoint };
      }
      return;
    }
    pinch = null;

    if (h.isFist) {
      scrub = null;
      ctx.ring.set(null, false);
      ctx.visuals.setArc(null, null, false);
      return;
    }

    // Hedefleme halkası: işaret parmağı hangi parçanın üstünde?
    const hover = ctx.grab.hoverAt(...toNdc(h.indexTip));
    ctx.ring.set(hover ? ctx.getPart(hover) : null, false);

    // Hızlı kaydırma ve öne itme (açık el)
    if (h.isOpen && time > cooldownUntil) {
      const vx = h.velocity.x;
      const vy = h.velocity.y;
      if (Math.abs(vx) > SWIPE_SPEED && Math.abs(vy) < Math.abs(vx) * 0.6) {
        cooldownUntil = time + COOLDOWN;
        scrub = null;
        ctx.hud.showGesture(vx > 0 ? 'Sonraki adım' : 'Önceki adım');
        ctx.stepBy(vx > 0 ? 1 : -1);
        return;
      }
      if (-vy > SWIPE_SPEED && Math.abs(vx) < -vy * 0.6) {
        cooldownUntil = time + COOLDOWN;
        scrub = null;
        ctx.hud.showGesture('Galeriye dön');
        ctx.backToGallery();
        return;
      }
      if (h.sizeVelocity / Math.max(h.size, 1e-3) > PUSH_RATE && h.speed < 1.0) {
        cooldownUntil = time + COOLDOWN;
        scrub = null;
        ctx.hud.showGesture('Patlat');
        ctx.explode();
        return;
      }
    }

    // Parmak yelpazesi ile sök/birleştir: el sakinken devreye girer
    const calm = h.speed < 0.9 && h.openness >= 0.5;
    if (!calm) {
      scrubDwell = 0;
      scrub = null;
      ctx.visuals.setArc(null, null, false);
      return;
    }
    scrubDwell += dt;
    if (!scrub) {
      if (scrubDwell < 0.15) return;
      scrub = { spread0: h.spread, p0: ctx.getProgress() };
      ctx.hud.showGesture('Sök / birleştir');
    }
    const gain = SPREAD_GAIN * (ctx.isSlowMo() ? 0.3 : 1);
    const target = clamp01(scrub.p0 - (h.spread - scrub.spread0) * gain);
    ctx.setProgress(THREE.MathUtils.damp(ctx.getProgress(), target, 16, dt));

    const pd = ctx.planeDistance();
    ctx.visuals.toWorld(h.points[4], pd, a);
    ctx.visuals.toWorld(h.points[20], pd, b);
    ctx.visuals.setArc(a, b, true, time);
  }

  // ---------- Süren parça tutma ----------
  function continueGrab(hands, dt) {
    const h = hands.find((x) => x.slot === pinch.slot);
    if (!h || !h.isPinching) {
      const result = ctx.grab.end();
      ctx.hud.showGesture(result === 'snap' ? 'Yerine oturdu' : result === 'throw' ? 'Fırlat' : 'Bırak');
      ctx.ring.set(null, false);
      pinch = null;
      return;
    }
    ctx.visuals.toWorld(h.pinchPoint, pinch.depth, handWorld);
    ctx.grab.move(handWorld, dt);
    ctx.ring.set(ctx.getPart(pinch.id), true);
  }

  return { update };
}
