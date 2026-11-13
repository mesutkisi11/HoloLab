import * as THREE from 'three';
import { clamp01 } from '../choreo/easing.js';
import { createSnapDetector } from './snapDetect.js';

// Model ekranındaki el hareketleri. Öncelik sırası:
// 1) süren parça tutma / model kavrama  2) parmak şıklatma  3) ağır çekim  4) iki el  5) tek el
//
// Tek el:
//   parmak şıklat                               -> bir adım geri; en baştaysa galeriye dön
//   pinch parça üstünde + çek                   -> parçayı çıkar
//   beş parmak ucunu topla, sonra eli aç         -> yakınlaştır (tekrar toplayınca uzaklaştır)
//   sadece işaret parmağı, parçada kısa süre tut -> parçayı yakından incele
//   açık elle sürükle (bırakınca savrulur)      -> döndür
//   açık elle hızlı sağa/sola kaydır            -> sonraki/önceki adım
//   açık elle hızlı yukarı kaydır               -> galeriye dön
//   avucu hızla öne it                          -> patlat
//   yumruk modelin üstünde tut                  -> modeli kavra (çöp)
// İki el:
//   iki başparmağı değdir, sonra ayır / yaklaştır -> değince birleşir, ayrıldıkça sökülür
//   iki pinch boşlukta aç/kapat                 -> büyüt / küçült
//   iki yumruğu birleştir                       -> tam montaj
//   bir yumruk boşlukta sabit + diğer el        -> ağır çekim

const SWIPE_SPEED = 1.5; // ekran genişliği / saniye
const PUSH_RATE = 1.2; // el boyutunun saniyede %120 büyümesi = öne itme
const COOLDOWN = 0.7;
const POINT_DWELL = 0.45;
const THUMB_TOUCH = 0.4; // iki başparmak ucu arası (el boyu oranı): bunun altı = değdi
const THUMB_APART = 2.6; // bu kadar ayrılınca tamamen sökülmüş olur
const FIST_GRAB_TIME = 0.35;

const BLOOM_GAIN = 0.9; // parmak açıklığı 1 birim artınca kamera mesafesi e^-0.9 ≈ %40'ına iner
const BLOOM_MOVE = 0.14; // el bu kadar kayarsa yakınlaştırma biter, döndürmeye geçer

const TWIST_GAIN = 1.6; // elin 1 derece dönüşü = modelin 1.6 derece dönüşü
const DRAG_GAIN = 7; // ekran genişliği kadar sürükleme ≈ 400 derece

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// İki açı arasındaki en kısa fark (-π..π)
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const toNdc = (p) => [p.x * 2 - 1, -(p.y * 2 - 1)];

export function createModelGestures(ctx) {
  let pinch = null; // süren parça tutma: { slot, depth, id }
  let thumbs = false; // iki başparmak bağlantısı kuruldu mu
  let rotate = null; // { last, moved }
  let zoom = null;
  let fistsApart = false;
  let cooldownUntil = 0;
  let modelFist = null;
  let pointing = null; // { id, t }
  let bloom = null; // { slot, spread, x, y }: parmaklar toplanınca başlayan tek el yakınlaştırma
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const handWorld = new THREE.Vector3();
  const snaps = [createSnapDetector(), createSnapDetector()];

  function update(hands, dt, time) {
    if (pinch) return continueGrab(hands, dt);
    if (modelFist?.grabbing) return continueModelGrab(hands);

    for (const h of hands) {
      if (!snaps[h.slot].update(h, time)) continue;
      endRotate();
      ctx.unfocus();
      if (ctx.stepBy(-1)) {
        ctx.hud.showGesture('Şıklat · bir adım geri');
      } else {
        ctx.hud.showGesture('Şıklat · galeriye dön');
        ctx.backToGallery();
      }
      return;
    }

    const stillFist = hands.find((h) => h.isFist && h.speed < 0.35 && !overModel(h));
    const slowMo = hands.length === 2 && !!stillFist;
    ctx.setSlowMo(slowMo);
    if (slowMo) ctx.hud.showGesture('Ağır çekim');

    const active = slowMo ? hands.filter((h) => h !== stillFist) : hands;

    if (active.length === 2) {
      endRotate();
      clearSingle();
      return twoHands(active, time, dt);
    }
    zoom = null;
    fistsApart = false;
    if (active.length !== 1) bloom = null;
    if (thumbs) {
      thumbs = false;
      ctx.visuals.setArc(null, null, false);
    }
    if (active.length === 1) return oneHand(active[0], dt, time);
    endRotate();
    clearSingle();
  }

  function clearSingle() {
    pointing = null;
    ctx.ring.set(null, false);
    ctx.visuals.setArc(null, null, false);
  }

  function endRotate(h = null) {
    if (!rotate) return;
    // Bırakırken el hareket ediyor ya da dönüyorsa model savrulup yavaşça durur
    if (h && (rotate.moved > 0.03 || Math.abs(rotate.twistVel) > 1)) {
      ctx.rotateRelease(h.velocity.x, h.velocity.y, rotate.twistVel * TWIST_GAIN);
    }
    rotate = null;
  }

  function overModel(h) {
    return ctx.grab.hoverAt(...toNdc(h.palm)) !== null;
  }

  // ---------- İki el ----------
  function twoHands(hands, time, dt) {
    const [h1, h2] = hands;
    const d = dist(h1.palm, h2.palm);

    if (thumbs && !h1.isFist && !h2.isFist) return thumbLink(h1, h2, time, dt);
    thumbs = false;

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
      const pd = ctx.planeDistance();
      ctx.visuals.toWorld(h1.pinchPoint, pd, a);
      ctx.visuals.toWorld(h2.pinchPoint, pd, b);
      ctx.visuals.setArc(a, b, true, time);
      return;
    }
    zoom = null;
    if (!h1.isFist && !h2.isFist && !h1.isPinching && !h2.isPinching && thumbGap(h1, h2) < THUMB_TOUCH) {
      thumbs = true;
      ctx.hud.showGesture('Başparmaklar · birleştir');
      return thumbLink(h1, h2, time, dt);
    }
    ctx.visuals.setArc(null, null, false);
  }

  function thumbGap(h1, h2) {
    return dist(h1.points[4], h2.points[4]) / Math.max((h1.size + h2.size) / 2, 1e-3);
  }

  // Başparmaklar değmişken birleşik; eller ayrıldıkça sökülür, yaklaştıkça yeniden birleşir
  function thumbLink(h1, h2, time, dt) {
    const target = 1 - clamp01((thumbGap(h1, h2) - THUMB_TOUCH) / (THUMB_APART - THUMB_TOUCH));
    const before = ctx.getProgress();
    const next = THREE.MathUtils.damp(before, target, 14, dt);
    ctx.setProgress(next);
    if (next < before - 0.004) ctx.hud.showGesture('Ayır · sök');
    else if (next > before + 0.004) ctx.hud.showGesture('Yaklaştır · birleştir');
    const pd = ctx.planeDistance();
    ctx.visuals.toWorld(h1.points[4], pd, a);
    ctx.visuals.toWorld(h2.points[4], pd, b);
    ctx.visuals.setArc(a, b, true, time);
  }

  // ---------- Tek el ----------
  function oneHand(h, dt, time) {
    if (bloom && (bloom.slot !== h.slot || h.isFist || h.isPointing || Math.hypot(h.palm.x - bloom.x, h.palm.y - bloom.y) > BLOOM_MOVE)) {
      bloom = null;
    }
    if (h.isBunched && !bloom) {
      endRotate();
      clearSingle();
      bloom = { slot: h.slot, spread: h.tipSpread, x: h.palm.x, y: h.palm.y };
      ctx.hud.showGesture('Parmakları aç · yakınlaştır');
    }
    if (bloom) {
      const delta = h.tipSpread - bloom.spread;
      if (Math.abs(delta) > 0.01) {
        ctx.zoom(Math.exp(-delta * BLOOM_GAIN));
        ctx.hud.showGesture(delta > 0 ? 'Yakınlaştır' : 'Uzaklaştır');
        bloom.spread = h.tipSpread;
      }
      return;
    }
    // Pinch parça üstünde = parçayı tut
    if (h.isPinching) {
      endRotate();
      pointing = null;
      const hover = h.pinch3 ? null : ctx.grab.hoverAt(...toNdc(h.indexTip));
      ctx.ring.set(hover ? ctx.getPart(hover) : null, false);
      if (!hover) return;
      const depth = ctx.grab.depthOf(hover);
      ctx.visuals.toWorld(h.pinchPoint, depth, handWorld);
      if (ctx.grab.begin(hover, handWorld)) {
        pinch = { slot: h.slot, depth, id: hover };
        ctx.ring.set(ctx.getPart(hover), true);
        ctx.hud.showGesture('Parçayı tut');
        ctx.unfocus();
      }
      return;
    }

    if (h.isFist) {
      endRotate();
      clearSingle();
      if (!modelFist) modelFist = { t0: time, grabbing: false };
      else if (!modelFist.grabbing && time - modelFist.t0 > FIST_GRAB_TIME && overModel(h)) {
        if (ctx.grabModel()) {
          modelFist.grabbing = true;
          modelFist.slot = h.slot;
          ctx.unfocus();
          ctx.hud.showGesture('Modeli kavra');
        }
      }
      return;
    }
    modelFist = null;

    // İşaret parmağı: hedefleme halkası + kısa bekleyince yakından incele
    if (h.isPointing) {
      endRotate(h);
      const hover = ctx.grab.hoverAt(...toNdc(h.indexTip));
      ctx.ring.set(hover ? ctx.getPart(hover) : null, false);
      if (hover && ctx.isDetached(hover)) {
        if (pointing?.id !== hover) pointing = { id: hover, t: 0 };
        pointing.t += dt;
        ctx.ring.setProgress?.(Math.min(1, pointing.t / POINT_DWELL));
        if (pointing.t >= POINT_DWELL && ctx.focusedId() !== hover) {
          ctx.focus(hover);
          ctx.hud.showGesture('Yakından incele');
        }
      } else {
        pointing = null;
        ctx.ring.setProgress?.(0);
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
      // Sürükleme ve el çevirme: ikisi de anında döndürür. Sadece yeni kamera verisi gelince hesaplanır.
      if (!rotate) {
        rotate = { hand: h, t: time, last: { ...h.palm }, roll: h.rollValid ? h.roll : null, moved: 0, twistVel: 0, shown: false };
      } else if (h !== rotate.hand) {
        const sampleDt = Math.max(1e-3, time - rotate.t);
        const dx = h.palm.x - rotate.last.x;
        const dy = h.palm.y - rotate.last.y;
        rotate.moved += Math.hypot(dx, dy);
        let twist = h.rollValid && rotate.roll !== null ? angleDelta(h.roll, rotate.roll) : 0;
        if (Math.abs(twist) < 0.004) twist = 0; // titreme
        rotate.twistVel = THREE.MathUtils.lerp(rotate.twistVel, twist / sampleDt, 0.6);
        if (rotate.moved > 0.006 || twist) {
          ctx.rotate(dx * DRAG_GAIN, dy, twist * TWIST_GAIN);
          if (!rotate.shown && (rotate.moved > 0.03 || Math.abs(twist) > 0.05)) {
            rotate.shown = true;
            ctx.hud.showGesture('Döndür');
          }
        }
        rotate.hand = h;
        rotate.t = time;
        rotate.roll = h.rollValid ? h.roll : null;
        rotate.last = { ...h.palm };
      }
      return;
    }
    endRotate(h);
    ctx.ring.set(null, false);
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
