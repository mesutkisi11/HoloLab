import * as THREE from 'three';

// Sinematik demo modu: arayüz gizlenir, kamera modelin etrafında süzülerek döner,
// "sök -> birleştir" döngüsü baştan sona oynar. El kontrolü açık kalır. V: 9:16 / 16:9.
export function createCinematic(app, modelScreen) {
  let on = false;
  let portrait = false;
  let t = 0;
  let phase = 'disassemble';
  let wait = 0;
  const target = new THREE.Vector3();

  function toggle() {
    on = !on;
    document.body.classList.toggle('cinematic', on);
    modelScreen.orbit.enabled = !on;
    modelScreen.setCameraLock(on);
    if (on) {
      t = 0;
      phase = 'disassemble';
      wait = 0;
      target.copy(modelScreen.getFit().center);
      modelScreen.playTo(0, 0.8);
    } else {
      app.setAspect(null);
      portrait = false;
    }
  }

  function toggleAspect() {
    if (!on) toggle();
    portrait = !portrait;
    app.setAspect(portrait ? 9 / 16 : 16 / 9);
  }

  function update(dt) {
    if (!on || !modelScreen.current) return;
    t += dt;
    const fit = modelScreen.getFit();
    target.lerp(fit.center, 1 - Math.exp(-2 * dt));
    // Yavaş yörünge + nefes alan yükseklik ve mesafe; dikeyde biraz daha uzak
    const angle = t * 0.2;
    const dist = fit.dist * (portrait ? 1.25 : 1.0) * (0.95 + 0.12 * Math.sin(t * 0.17));
    const elev = 0.35 + 0.22 * Math.sin(t * 0.29);
    app.camera.position.set(
      target.x + Math.cos(angle) * Math.cos(elev) * dist,
      target.y + Math.sin(elev) * dist,
      target.z + Math.sin(angle) * Math.cos(elev) * dist,
    );
    app.camera.lookAt(target);
    modelScreen.orbit.target.copy(target);

    // Sök -> bekle -> birleştir -> bekle -> tekrar
    const p = modelScreen.current.choreo.getProgress();
    if (phase === 'disassemble' && p <= 0.001) {
      phase = 'wait1';
      wait = 0;
    } else if (phase === 'wait1' && (wait += dt) > 1.4) {
      phase = 'assemble';
      modelScreen.playTo(1, 0.8);
    } else if (phase === 'assemble' && p >= 0.999) {
      phase = 'wait2';
      wait = 0;
    } else if (phase === 'wait2' && (wait += dt) > 3.5) {
      phase = 'disassemble';
      modelScreen.playTo(0, 0.8);
    }
  }

  return { toggle, toggleAspect, update, isOn: () => on };
}
