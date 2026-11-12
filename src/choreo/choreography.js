import * as THREE from 'three';
import { prepareStep, evalStep } from './motions.js';
import { clamp01 } from './easing.js';

const SEATED = 0.999;

// Koreografi motoru: tek bir "progress" (0 sökülmüş, 1 birleşmiş) değerini
// tüm parçaların konumuna çevirir. İleri-geri serbestçe değişebilir.
//
// Her adımda ek durumlar:
//   offset  : -1 ise parça "sökülmüş" sayılır (elle çıkarılıp bırakıldı), global ilerleme onu getirmez
//   float   : parça havada asılı (fırlatıldı), sabit yerel poz
//   locked  : parça şu an elle tutuluyor / kendi animasyonunu oynatıyor, motor dokunmaz
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
      steps.push({
        ...prepareStep(raw, part),
        s: 0,
        prevS: 0,
        seatedAt: -1,
        offset: 0,
        float: null,
        locked: false,
      });
    }
  }
  const stepById = new Map(steps.map((st) => [st.id, st]));

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
      step.s = clamp01((t - step.startTime) / step.duration + step.offset);
      if (step.s < SEATED) allSeated = false;

      if (step.locked) continue;

      if (step.float) {
        step.part.position.copy(step.float.position);
        step.part.quaternion.copy(step.float.quaternion);
        continue;
      }

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

      applySettle(step);
    }

    if (allSeated && !completed) {
      completed = true;
      emit('complete');
    } else if (!allSeated && progress < 0.98) {
      completed = false;
    }
  }

  // Oturma anında kısa sarsıntı ve parlama
  function applySettle(step) {
    const age = now - step.seatedAt;
    const mat = step.part.userData.part.material.uniforms.uFlash;
    if (step.seatedAt >= 0 && age < 0.3) {
      const shake = 0.006 * Math.exp(-age * 14) * Math.sin(age * 90);
      step.part.position.addScaledVector(step.axis, shake);
      mat.value = Math.exp(-age * 9);
    } else {
      mat.value = 0;
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
    getStep: (id) => stepById.get(id),
    // Parça şu an hareket ediyor mu? (vurgu rengi için)
    isMoving(partId) {
      const st = stepById.get(partId);
      return !!st && (st.locked || (st.s > 0.001 && st.s < SEATED));
    },
    // Parçayı "oturdu" olarak işaretle (elle yerine takıldı)
    markSeated(id) {
      const st = stepById.get(id);
      if (!st) return;
      st.offset = 0;
      st.float = null;
      st.locked = false;
      st.seatedAt = now;
      st.s = 1;
      emit('seated', st);
    },
    // Tüm elle yapılan değişiklikleri sıfırla (tam montaj öncesi)
    clearOverrides() {
      for (const st of steps) {
        st.offset = 0;
        st.float = null;
        st.locked = false;
      }
    },
    hasOverrides: () => steps.some((st) => st.offset !== 0 || st.float),
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    // Katman sınırları: her grubun (JSON'daki "group") bittiği progress değerleri.
    // Kademeli sök/tak bu sınırlar arasında çalışır.
    layerBounds() {
      const ends = new Map();
      for (const st of steps) {
        const g = st.group ?? st.id;
        ends.set(g, Math.max(ends.get(g) ?? 0, (st.startTime + st.duration) / duration));
      }
      const pts = [0, ...ends.values()].map((p) => Math.round(p * 1000) / 1000);
      return [...new Set(pts)].sort((a, b) => a - b);
    },
    layerNameAt(p) {
      let best = null;
      for (const st of steps) {
        const end = (st.startTime + st.duration) / duration;
        if (end > p + 0.001 && (!best || end < best.end)) best = { end, group: st.group ?? st.id };
      }
      return best?.group ?? null;
    },
    // Adım adım gezinme için: her adımın bittiği progress değerleri (sıralı, tekil)
    seatPoints() {
      const pts = steps.map((st) => (st.startTime + st.duration) / duration);
      return [0, ...new Set(pts.map((p) => Math.round(p * 1000) / 1000))].sort((a, b) => a - b);
    },
  };
}
