// Köşedeki küçük yazılar: durum (el takibi yükleniyor vb.) ve algılanan hareketin adı
export function createHud() {
  const status = document.createElement('div');
  status.className = 'hud-status';
  document.body.appendChild(status);

  const gesture = document.createElement('div');
  gesture.className = 'hud-gesture';
  document.body.appendChild(gesture);

  let hideTimer = null;

  return {
    setStatus(text) {
      status.textContent = text;
      status.classList.toggle('visible', !!text);
    },
    showGesture(name) {
      if (gesture.textContent === name && gesture.classList.contains('visible')) return;
      gesture.textContent = name;
      gesture.classList.add('visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => gesture.classList.remove('visible'), 1200);
    },
  };
}
