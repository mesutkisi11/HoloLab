import * as THREE from 'three';
import { clamp01 } from '../choreo/easing.js';

// Model ekranındaki el hareketleri. Öncelik sırası:
// 1) süren parça tutma / model kavrama  2) ağır çekim  3) iki el  4) tek el
//
// Tek el:
//   başparmak+işaret birleştir, aç/kapat        -> kademeli sök/tak (bir katman)
//   başparmak+işaret+orta birleştir, aç/kapat   -> tüm modeli sök/tak
//   pinch parça üstünde + çek                   -> parçayı çıkar
//   sadece işaret parmağı, parçada 0.6 sn tut   -> parçayı yakından göster
//   açık elle yavaş sürükle                     -> döndür
//   açık elle hızlı sağa/sola kaydır            -> sonraki/önceki adım
//   açık elle hızlı yukarı kaydır               -> galeriye dön
//   avucu hızla öne it                          -> patlat
//   yumruk modelin üstünde tut                  -> modeli kavra (çöp)
// İki el:
//   iki pinch boşlukta aç/kapat                 -> yakınlaştır
//   iki yumruğu birleştir                       -> tam montaj
//   bir yumruk boşlukta sabit + diğer el        -> ağır çekim

const SWIPE_SPEED = 1.8;
const PUSH_RATE = 1.4;
const COOLDOWN = 0.9;
const POINT_DWELL = 0.6;
const PINCH_RELEASE = 1.5; // parmaklar bu kadar (el boyu oranı) açılırsa sök/tak biter

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const toNdc = (p) => [p.x * 2 - 1, -(p.y * 2 - 1)];

export function createModelGestures(ctx) {
  let pinch = null; // { mode: 'grab'|'layer'|'full', slot, d0, p0, lo, hi }
  let rotate = null; // { last }
  let zoom = null;
  let fistsApart = false;
  let cooldownUntil = 0;
  let modelFist = null;
  let pointing = null; // { id, t }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const handWorld = new THREE.Vector3();

  function update(hands, dt, time) {
    if (pinch?.mode === 'grab') return continueGrab(hands, dt);
    if (modelFist?.grabbing) return continueModelGrab(hands);
    if (pinch) return continueScrub(hands, dt, time);

    const stillFist = hands.find((h) => h.isFist && h.speed < 0.35 && !overModel(h));
    const slowMo = hands.length === 2 && !!stillFist;
    ctx.setSlowMo(slowMo);
    if (slowMo) ctx.hud.showGesture('Ağır çekim');

    const active = slowMo ? hands.filter((h) => h !== stillFist) : hands;

    if (active.length === 2) {
      clearSingle();
      return twoHands(active, time);
    }
    zoom = null;
    fistsApart = false;
    if (active.length === 1) return oneHand(active[0], dt, time);
    clearSingle();
  }

  function clearSingle() {
    rotate = null;
    pointing = null;
    ctx.ring.set(null, false);
    ctx.visuals.setArc(null, null, false);
  }

  function overModel(h) {
    return ctx.grab.hoverAt(...toNdc(h.palm)) !== null;
  }

  // ---------- İki el ----------
  function twoHands(hands, time) {
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
    // Pinch başlangıcı: parça üstünde = tut, boşlukta = sök/tak (2 parmak katman, 3 parmak tam)
    if (h.isPinching) {
      rotate = null;
      pointing = null;
      const hover = h.pinch3 ? null : ctx.grab.hoverAt(...toNdc(h.indexTip));
      if (hover) {
        const depth = ctx.grab.depthOf(hover);
        ctx.visuals.toWorld(h.pinchPoint, depth, handWorld);
        if (ctx.grab.begin(hover, handWorld)) {
          pinch = { mode: 'grab', slot: h.slot, depth, id: hover };
          ctx.ring.set(ctx.getPart(hover), true);
          ctx.hud.showGesture('Parçayı tut');
          ctx.unfocus();
          return;
        }
      }
      beginScrub(h);
      return;
    }

    if (h.isFist) {
      clearSingle();
      ctx.unfocus();
      if (!modelFist) modelFist = { t0: time, grabbing: false };
      else if (!modelFist.grabbing && time - modelFist.t0 > 0.4 && overModel(h)) {
        if (ctx.grabModel()) {
          modelFist.grabbing = true;
          modelFist.slot = h.slot;
          ctx.hud.showGesture('Modeli kavra');
        }
      }
      return;
    }
    modelFist = null;

    // İşaret parmağı: hedefleme halkası + bekleyince yakından göster
    if (h.isPointing) {
      rotate = null;
      const hover = ctx.grab.hoverAt(...toNdc(h.indexTip));
      ctx.ring.set(hover ? ctx.getPart(hover) : null, false);
      if (hover && ctx.isDetached(hover)) {
        if (pointing?.id !== hover) pointing = { id: hover, t: 0 };
        pointing.t += dt;
        if (pointing.t >= POINT_DWELL && ctx.focusedId() !== hover) {
          ctx.focus(hover);
          ctx.hud.showGesture('Yakından göster');
        }
      } else {
        pointing = null;
      }
      return;
    }
    pointing = null;

    // Açık el: yavaş = döndür, hızlı = adım / galeri / patlat
    if (h.isOpen) {
      const hover = ctx.grab.hoverAt(...toNdc(h.indexTip));
      ctx.ring.set(hover ? ctx.getPart(hover) : null, false);

      if (time > cooldownUntil) {
        const vx = h.velocity.x;
        const vy = h.velocity.y;
        if (Math.abs(vx) > SWIPE_SPEED && Math.abs(vy) < Math.abs(vx) * 0.6) {
          cooldownUntil = time + COOLDOWN;
          rotate = null;
          ctx.unfocus();
          ctx.hud.showGesture(vx > 0 ? 'Sonraki adım' : 'Önceki adım');
          ctx.stepBy(vx > 0 ? 1 : -1);
          return;
        }
        if (-vy > SWIPE_SPEED && Math.abs(vx) < -vy * 0.6) {
          cooldownUntil = time + COOLDOWN;
          rotate = null;
          ctx.unfocus();
          ctx.hud.showGesture('Galeriye dön');
          ctx.backToGallery();
          return;
        }
        if (h.sizeVelocity / Math.max(h.size, 1e-3) > PUSH_RATE && h.speed < 1.0) {
          cooldownUntil = time + COOLDOWN;
          rotate = null;
          ctx.unfocus();
          ctx.hud.showGesture('Patlat');
          ctx.explode();
          return;
        }
      }
      // Yavaş sürükleme: döndür
      if (!rotate) rotate = { last: { ...h.palm }, moved: 0 };
      else {
        const dx = h.palm.x - rotate.last.x;
        const dy = h.palm.y - rotate.last.y;
        rotate.moved += Math.hypot(dx, dy);
        if (rotate.moved > 0.02) {
          ctx.rotate(dx, dy);
          if (rotate.moved < 0.03) ctx.hud.showGesture('Döndür');
        }
        rotate.last = { ...h.palm };
      }
      return;
    }
    rotate = null;
    ctx.ring.set(null, false);
  }

  // ---------- Sök / tak (pinch aç-kapat) ----------
  function beginScrub(h) {
    const p0 = ctx.getProgress();
    const full = h.pinch3;
    let lo = 0;
    let hi = 1;
    let label = 'Sök / tak (tümü)';
    if (!full) {
      // Bir katman: mevcut ilerlemenin altındaki ve üstündeki en yakın katman sınırları
      const bounds = ctx.layerBounds();
      lo = [...bounds].reverse().find((x) => x < p0 - 0.002) ?? 0;
      hi = bounds.find((x) => x > p0 + 0.002) ?? 1;
      const name = ctx.layerNameAt(Math.max(0, p0 - 0.001));
      label = name ? `Katman: ${name}` : 'Katman';
    }
    pinch = { mode: full ? 'full' : 'layer', slot: h.slot, d0: h.pinchDist, p0, lo, hi };
    ctx.ring.set(null, false);
    ctx.unfocus();
    ctx.hud.showGesture(label);
  }

  function continueScrub(hands, dt, time) {
    const h = hands.find((x) => x.slot === pinch.slot);
    // Bitiş: el kayboldu, yumruk, parmaklar çok açıldı veya hızlı hareket
    if (!h || h.isFist || h.pinchDist > PINCH_RELEASE || h.speed > SWIPE_SPEED) {
      pinch = null;
      ctx.visuals.setArc(null, null, false);
      return;
    }
    // Parmaklar açıldıkça sökülür, kapandıkça birleşir
    const gain = (pinch.mode === 'full' ? 1.1 : Math.max(0.5, (pinch.hi - pinch.lo) / 0.7)) * (ctx.isSlowMo() ? 0.3 : 1);
    const raw = pinch.p0 - (h.pinchDist - pinch.d0) * gain;
    const target = THREE.MathUtils.clamp(clamp01(raw), pinch.lo, pinch.hi);
    ctx.setProgress(THREE.MathUtils.damp(ctx.getProgress(), target, 16, dt));

    const pd = ctx.planeDistance();
    ctx.visuals.toWorld(h.points[4], pd, a);
    ctx.visuals.toWorld(h.points[8], pd, b);
    ctx.visuals.setArc(a, b, true, time);
  }

  // ---------- Süren model kavrama ----------
  function continueModelGrab(hands) {
    const h = hands.find((x) => x.slot === modelFist.slot);
    if (!h || !h.isFist) {
      modelFist = null;
      ctx.releaseModel(h?.velocity ?? { x: 0, y: 0 }, h);
      return;
    }
    ctx.visuals.toWorld(h.palm, ctx.planeDistance(), handWorld);
    ctx.moveModel(handWorld);
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
