// Alttaki ince söküm/montaj kaydırıcısı (yedek kontrol). 0 = sökülmüş, 1 = birleşmiş.
export function createSlider(onChange) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1000';
  input.value = '1000';
  input.className = 'progress-slider';
  input.setAttribute('aria-label', 'Montaj ilerlemesi');
  document.body.appendChild(input);

  input.addEventListener('input', () => onChange(Number(input.value) / 1000));

  return {
    set(value) {
      input.value = String(Math.round(value * 1000));
    },
    show(visible) {
      input.style.display = visible ? '' : 'none';
    },
  };
}
