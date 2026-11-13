// Alttaki ince söküm/montaj kaydırıcısı (yedek kontrol). 0 = sökülmüş, 1 = birleşmiş.
// Yanında montaj yüzdesi ve katman adı küçük bir göstergeyle yazar.
export function createSlider(onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'progress-wrap';
  wrap.innerHTML = `
    <span class="progress-label">SÖKÜLMÜŞ</span>
    <input type="range" min="0" max="1000" value="1000" class="progress-slider" aria-label="Montaj ilerlemesi" />
    <span class="progress-label">BİRLEŞMİŞ</span>
    <span class="progress-value">100%</span>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input');
  const value = wrap.querySelector('.progress-value');

  input.addEventListener('input', () => onChange(Number(input.value) / 1000));

  let shown = -1;
  return {
    set(p) {
      input.value = String(Math.round(p * 1000));
      const pct = Math.round(p * 100);
      if (pct !== shown) {
        shown = pct;
        value.textContent = `${String(pct).padStart(3, '0')}%`;
      }
    },
    show(visible) {
      wrap.style.display = visible ? '' : 'none';
    },
  };
}
