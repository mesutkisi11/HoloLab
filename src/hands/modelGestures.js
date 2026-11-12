import * as THREE from 'three';
import { clamp01 } from '../choreo/easing.js';

// Model ekranındaki el hareketleri. Her hareket küçük bir durum makinesi:
// başlangıç koşulu -> aktifken ne yapılır -> bitiş koşulu.

const SCRUB_GAIN = 2.0; // avuçlar ekranın yarısı kadar açılınca tam söküm

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createModelGestures(ctx) {
  // ctx: { getProgress, setProgress, hud, visuals, planeDistance() }
  let scrub = null;
  const palmA = new THREE.Vector3();
  const palmB = new THREE.Vector3();

  function update(hands, dt, time) {
    updateScrub(hands, dt, time);
  }

  // İki açık el: aralarındaki mesafe değişimi doğrudan ilerlemeyi sürer
  function updateScrub(hands, dt, time) {
    const twoOpen = hands.length === 2 && hands[0].isOpen && hands[1].isOpen;
    if (!twoOpen) {
      if (scrub) ctx.visuals.setArc(null, null, false);
      scrub = null;
      return;
    }
    const d = dist(hands[0].palm, hands[1].palm);
    if (!scrub) {
      scrub = { d0: d, p0: ctx.getProgress() };
      ctx.hud.showGesture('İki elle sök / birleştir');
    }
    const target = clamp01(scrub.p0 - (d - scrub.d0) * SCRUB_GAIN);
    // Küçük titremeleri yumuşat: hedefe doğru hızlıca ama anında değil
    ctx.setProgress(THREE.MathUtils.damp(ctx.getProgress(), target, 18, dt));

    const pd = ctx.planeDistance();
    ctx.visuals.toWorld(hands[0].palm, pd, palmA);
    ctx.visuals.toWorld(hands[1].palm, pd, palmB);
    ctx.visuals.setArc(palmA, palmB, true, time);
  }

  return { update };
}
