// Ekran HUD'u: köşe çerçeveleri, marka satırı, durum yazısı, algılanan hareketin adı
// ve sağ altta küçük telemetri (FPS, kalite, el takibi gecikmesi, parça sayısı, montaj yüzdesi).
// Açıklama paneli değil; sadece Stark atölyesi hissi veren kısa durum göstergeleri.

export function createHud() {
  const frame = document.createElement('div');
  frame.className = 'hud-frame';
  frame.innerHTML = '<i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>';
  document.body.appendChild(frame);

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = 'HOLOLAB<small>HOLOGRAFİK MONTAJ ATÖLYESİ</small>';
  document.body.appendChild(brand);

  const status = document.createElement('div');
  status.className = 'hud-status';
  document.body.appendChild(status);

  const gesture = document.createElement('div');
  gesture.className = 'hud-gesture';
  document.body.appendChild(gesture);

  const telemetry = document.createElement('div');
  telemetry.className = 'hud-telemetry';
  document.body.appendChild(telemetry);

  let hideTimer = null;
  let lastTelemetry = '';

  return {
    setStatus(text) {
      status.textContent = text;
      status.classList.toggle('visible', !!text);
    },
    showGesture(name) {
      if (gesture.textContent === name && gesture.classList.contains('visible')) {
        clearTimeout(hideTimer);
      } else {
        gesture.textContent = name;
        gesture.classList.remove('flash');
        void gesture.offsetWidth; // animasyonu yeniden başlat
        gesture.classList.add('visible', 'flash');
      }
      hideTimer = setTimeout(() => gesture.classList.remove('visible'), 1400);
    },
    // rows: [['FPS', '60'], ['EL', 'İŞÇİ 12 ms'], ...] — sadece değişince DOM'a yazılır
    setTelemetry(rows) {
      const html = rows.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('');
      if (html === lastTelemetry) return;
      lastTelemetry = html;
      telemetry.innerHTML = html;
    },
  };
}
