// Web Audio ile üretilen mekanik sesler. Dışarıdan ses dosyası yok; her şey osilatör + gürültü.
// Tarayıcı kuralı: ses ancak kullanıcı bir kez tıklayınca/tuşa basınca başlayabilir.

const STORAGE_KEY = 'hololab-sound';

export function createSounds() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let hum = null; // { osc, gain }
  let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  let lastTick = 0;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    master.connect(ctx.destination);

    // 1 saniyelik beyaz gürültü: tıkırtı ve vuş seslerinin hammaddesi
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  // İlk kullanıcı etkileşiminde sesi aç
  const unlock = () => {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  function noise(duration, { freq = 1000, q = 1, gain = 0.3, type = 'bandpass' } = {}) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration);
    return { filter, g };
  }

  function tone(freq, duration, { type = 'sine', gain = 0.2, slideTo = null } = {}) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      if (master) master.gain.setTargetAtTime(enabled ? 0.5 : 0, ctx.currentTime, 0.05);
      return enabled;
    },
    // Hareket sırasında hafif vızıltı (açık/kapalı)
    hum(active) {
      if (!ctx) return;
      if (!hum) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(filter).connect(g).connect(master);
        osc.start();
        hum = { osc, gain: g };
      }
      hum.gain.gain.setTargetAtTime(active ? 0.08 : 0, ctx.currentTime, 0.12);
    },
    // Oturma anı: "klak"
    click() {
      noise(0.08, { freq: 1800, q: 2, gain: 0.5 });
      tone(900, 0.06, { type: 'square', gain: 0.08, slideTo: 300 });
    },
    // Vida dönerken tıkırtı (çağrıldıkça aralıklı)
    tick(now) {
      if (now - lastTick < 0.07) return;
      lastTick = now;
      noise(0.025, { freq: 3200, q: 4, gain: 0.25 });
    },
    // Galeride kaydırma: "vuş"
    whoosh() {
      const n = noise(0.35, { freq: 400, q: 0.7, gain: 0.25 });
      if (n) n.filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.3);
    },
    // Çöpe atma: dağılma
    scatter() {
      noise(0.7, { freq: 900, q: 0.5, gain: 0.45, type: 'highpass' });
      for (let i = 0; i < 14; i++) {
        setTimeout(() => tone(600 + Math.random() * 1800, 0.08, { gain: 0.06 }), i * 40);
      }
    },
    // Final dalgası
    chime() {
      tone(520, 0.9, { gain: 0.12 });
      tone(780, 1.2, { gain: 0.08 });
      tone(1040, 1.5, { gain: 0.05 });
    },
  };
}
