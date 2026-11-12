import * as THREE from 'three';

// Sinematik demo modu: arayüz gizlenir, kamera modelin etrafında süzülür,
// "sök -> birleştir" döngüsü oynar. El kontrolü açık kalır. V: 9:16 / 16:9.
export function createCinematic(app, modelScreen) {
  let on = false;
  let portrait = false;
  let t = 0;
  let phase = 'disassemble';
  let wait = 0;

  function toggle() {
    on = !on;
    document.body.classList.toggle('cinematic', on);
    modelScreen.orbit.enabled = !on;
    if (on) {
      t = 0;
      phase = 'disassemble';
      wait = 0;
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
    // Kamera: yavaş yörünge + nefes alan yükseklik ve mesafe
    const target = modelScreen.orbit.target;
    const angle = t * 0.22;
    const elev = 0.45 + 0.3 * Math.sin(t * 0.31);
    const radius = 1.75 + 0.35 * Math.sin(t * 0.17);
    app.camera.position.set(
      target.x + Math.cos(angle) * radius,
      target.y + elev,
      target.z + Math.sin(angle) * radius,
    );
    app.camera.lookAt(target);

    // Sök -> bekle -> birleştir -> bekle -> tekrar
    const p = modelScreen.current.choreo.getProgress();
    if (phase === 'disassemble' && p <= 0.001) {
      phase = 'wait1';
      wait = 0;
    } else if (phase === 'wait1' && (wait += dt) > 1.2) {
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

  return { toggle, toggleAspect, update, isOn: () => on, lookAt: new THREE.Vector3() };
}
