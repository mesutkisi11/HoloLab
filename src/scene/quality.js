// Kalite seviyeleri. Uygulama ekran kartına göre bir seviyeyle başlar,
// kareler uzun sürerse kendiliğinden bir alt seviyeye iner. B tuşu elle değiştirir.

export const TIER_ORDER = ['high', 'medium', 'low'];

export const TIERS = {
  high: { pixelRatio: 1.5, msaa: 4, bloom: true, bloomScale: 0.5, dust: 700, post: true, label: 'Yüksek kalite' },
  medium: { pixelRatio: 1, msaa: 2, bloom: true, bloomScale: 0.35, dust: 320, post: true, label: 'Orta kalite' },
  low: { pixelRatio: 0.8, msaa: 0, bloom: false, bloomScale: 0.25, dust: 0, post: false, label: 'Performans modu' },
};

const STORAGE_KEY = 'hololab-quality';

export function savedTier() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return TIERS[v] ? v : null;
  } catch {
    return null;
  }
}

export function saveTier(tier) {
  try {
    localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    /* özel pencerede depolama kapalı olabilir */
  }
}

// Ekran kartının adına bakarak tahmin: yazılım çizimi -> düşük, dahili GPU -> orta, harici -> yüksek
export function detectTier(renderer) {
  const forced = new URLSearchParams(location.search).get('tier');
  if (TIERS[forced]) return forced;
  const saved = savedTier();
  if (saved) return saved;
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
  if (/intel|uhd|iris|radeon\(tm\)|radeon graphics|vega|mali|adreno|powervr|apple gpu/i.test(name)) return 'medium';
  return 'high';
}

// Kare süresini izler; 3 saniye boyunca ortalama 24 ms'yi (≈40 FPS) aşarsa bir alt seviye ister.
export function createFrameMonitor(onTooSlow) {
  const samples = [];
  let warmup = 3;
  let cooldown = 0;

  return {
    push(rawDt) {
      // Sekme arka plana gidince gelen dev aralıkları sayma
      if (rawDt > 0.25) return;
      if (warmup > 0) {
        warmup -= rawDt;
        return;
      }
      if (cooldown > 0) {
        cooldown -= rawDt;
        return;
      }
      samples.push(rawDt);
      if (samples.length < 180) return;
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      samples.length = 0;
      if (avg > 0.024) {
        cooldown = 3;
        onTooSlow(avg);
      }
    },
    reset() {
      samples.length = 0;
      warmup = 2;
    },
  };
}
