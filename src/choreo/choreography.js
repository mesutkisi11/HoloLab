import * as THREE from 'three';
import { prepareStep, evalStep } from './motions.js';
import { clamp01 } from './easing.js';

const SEATED = 0.999;

// Koreografi motoru: tek bir "progress" (0 sökülmüş, 1 birleşmiş) değerini
// tüm parçaların konumuna çevirir. İleri-geri serbestçe değişebilir.
export function createChoreography(parts, data) {
  const byId = new Map(parts.map((p) => [p.userData.part.id, p]));

  // JSON'da "parts": [...] ile birden çok parça aynı adımı paylaşabilir
  const steps = [];
  for (const raw of data.steps) {
    const ids = raw.parts ?? [raw.part];
    for (const id of ids) {
      const part = byId.get(id);
      if (!part) {
        console.warn(`Koreografi: parça bulunamadı: ${id}`);
        continue;
      }
      steps.push({ ...prepareStep(raw, part), s: 0, prevS: 0, seatedAt: -1, shakeAxis: null });
    }
  }

  const duration = Math.max(0.001, ...steps.map((st) => st.startTime + st.duration));
  const listeners = new Map();
  const scratch = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  let progress = 1;
  let completed = true;
  let now = 0;

  const emit = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };

  function update(dt) {
    now += dt;
    const t = progress * duration;
    let allSeated = true;

    for (const step of steps) {
      step.prevS = step.s;
      step.s = clamp01((t - step.startTime) / step.duration);
      if (step.s < SEATED) allSeated = false;

      evalStep(step, step.s, scratch);
      step.part.position.copy(scratch.position);
      step.part.quaternion.copy(scratch.quaternion);

      // Oturma / sökülme olayları
      if (step.prevS < SEATED && step.s >= SEATED) {
        step.seatedAt = now;
        emit('seated', step);
      } else if (step.prevS >= SEATED && step.s < SEATED) {
        emit('unseated', step);
      }
      if (step.prevS <= 0.001 && step.s > 0.001) emit('start', step);

      // Oturma anında kısa sarsıntı ve parlama
      const age = now - step.seatedAt;
      if (step.seatedAt >= 0 && age < 0.3) {
        const shake = 0.006 * Math.exp(-age * 14) * Math.sin(age * 90);
        step.part.position.addScaledVector(step.axis, shake);
        step.part.userData.part.material.uniforms.uFlash.value = Math.exp(-age * 9);
      } else {
        step.part.userData.part.material.uniforms.uFlash.value = 0;
      }
    }

    if (allSeated && !completed) {
      completed = true;
      emit('complete');
    } else if (!allSeated && progress < 0.98) {
      completed = false;
    }
  }

  return {
    steps,
    duration,
    update,
    setProgress(p) {
      progress = clamp01(p);
    },
    getProgress: () => progress,
    // Parça şu an hareket ediyor mu? (vurgu rengi için)
    isMoving(partId) {
      const st = steps.find((s) => s.id === partId);
      return !!st && st.s > 0.001 && st.s < SEATED;
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    // Adım adım gezinme için: her adımın bittiği progress değerleri (sıralı, tekil)
    seatPoints() {
      const pts = steps.map((st) => (st.startTime + st.duration) / duration);
      return [...new Set(pts.map((p) => Math.round(p * 1000) / 1000))].sort((a, b) => a - b);
    },
  };
}
