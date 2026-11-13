import * as THREE from 'three';

// Galeri ekranı el hareketleri:
//   açık elle sağa/sola kaydır   -> tasarımlar arasında gez (yavaş = sürükle, hızlı = birkaç tane atla)
//   kısa yumruk (< 0.35 sn)      -> seçili tasarımı aç
//   yumruk tut (>= 0.35 sn)      -> tasarımı kavra (çöpe atmak için), açınca bırak
//   açık elle kendine çek        -> geri al (silme sonrası 5 sn; trash modülü dinler)

const DRAG_GAIN = 4; // ekranın çeyreği kadar hareket = bir tasarım
const HOLD_TIME = 0.35;

export function createGalleryGestures(ctx) {
  let drag = null;
  let fist = null; // { t0, grabbing }
  const world = new THREE.Vector3();

  function update(hands, dt, time) {
    const h = hands[0];
    if (!h) {
      endDrag(0);
      endFist(time, null);
      return;
    }

    // --- Yumruk: kısa = aç, uzun = kavra ---
    if (h.isFist) {
      if (!fist) fist = { t0: time, grabbing: false };
      else if (!fist.grabbing && time - fist.t0 >= HOLD_TIME) {
        fist.grabbing = !!ctx.grabSelected();
        if (fist.grabbing) ctx.hud.showGesture('Kavra');
      }
      if (fist.grabbing) {
        ctx.visuals.toWorld(h.palm, ctx.planeDistance(), world);
        ctx.moveGrabbed(world);
      }
      endDrag(0);
      return;
    }
    if (fist) {
      endFist(time, h);
      return;
    }

    // --- Açık el: sürükle / kaydır ---
    if (h.isOpen) {
      if (!drag) drag = { x0: h.palm.x, c0: ctx.getCursor() };
      ctx.setCursor(drag.c0 - (h.palm.x - drag.x0) * DRAG_GAIN);
      drag.vx = h.velocity.x;
      return;
    }
    endDrag(drag?.vx ?? 0);
  }

  function endDrag(vx) {
    if (!drag) return;
    drag = null;
    // Hızlı bırakınca birkaç tasarım birden geçsin
    const extra = THREE.MathUtils.clamp(Math.round(-vx * 0.6), -3, 3);
    ctx.snap(extra);
    if (Math.abs(extra) > 0) ctx.hud.showGesture(extra > 0 ? 'Hızlı kaydır →' : '← Hızlı kaydır');
  }

  function endFist(time, hand) {
    if (!fist) return;
    const f = fist;
    fist = null;
    if (f.grabbing) {
      ctx.releaseGrabbed(hand?.velocity ?? { x: 0, y: 0 }, hand);
    } else if (hand && time - f.t0 < HOLD_TIME) {
      ctx.openSelected();
    }
  }

  return { update };
}
