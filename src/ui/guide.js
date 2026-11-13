// Rehber ekranı: ilk açılışta "elini kameraya göster" + hareket listesi (animasyonlu küçük ikonlar).
// Bir kez görüldükten sonra köşedeki "?" ile tekrar açılır.

const SEEN_KEY = 'hololab-guide-seen';

const GALLERY = [
  ['swipe', 'Açık elle sağa / sola kaydır', 'tasarımlar arasında gez'],
  ['fist', 'Avucunu kapat (kısa)', 'seçili tasarımı aç'],
  ['hold', 'Avucunu kapat ve tut, çöpe savur', 'tasarımı sil'],
  ['pull', 'Açık eli kendine çek (5 sn içinde)', 'silmeyi geri al'],
  ['add', 'En sondaki + yuvasına tıkla, U tuşuna bas ya da dosyayı pencereye sürükle', 'tasarım ekle · GLB GLTF OBJ STL FBX STEP IGES'],
];

const MODEL = [
  ['pinch2', 'Başparmak + işaret birleştir, aç / kapat', 'bir katmanı sök / tak'],
  ['pinch3', 'Başparmak + işaret + orta birleştir, aç / kapat', 'tümünü sök / tak'],
  ['grab', 'Parça üstünde pinch yapıp çek', 'parçayı çıkar; bırakınca oturur'],
  ['point', 'İşaret parmağını sökülmüş parçada tut', 'parçayı ölçüleriyle yakından incele'],
  ['drag', 'Açık elle sürükle, savurup bırak', 'döndür (savurunca dönmeye devam eder)'],
  ['swipe', 'Açık elle hızlı sağa / sola', 'sonraki / önceki adım'],
  ['push', 'Avucu hızla öne it', 'patlat (exploded view)'],
  ['zoom', 'İki elle pinch, ellerini aç / kapat', 'yakınlaştır'],
  ['fists', 'İki yumruğu birleştir', 'tam montaj'],
  ['hold', 'Yumruğu modelin üstünde tut, çöpe savur', 'modeli sil'],
  ['up', 'Açık elle yukarı kaydır', 'galeriye dön'],
];

const KEYS = 'Klavye: U tasarım yükle · Esc galeri · Enter aç · Space oynat · E sök · A birleştir · ← → adım · S ses · B görüntü kalitesi · C sinematik · V dikey/yatay · J koreografi JSON · Del sil · ? rehber';

export function createGuide() {
  const overlay = document.createElement('div');
  overlay.className = 'guide';
  overlay.innerHTML = `
    <div class="guide-card">
      <div class="guide-title">Elini kameraya göster</div>
      <div class="guide-sub">HoloLab eller ile kontrol edilir. Avucu kapatmak her yerde "tut / seç" demektir. Ellerin kamerada belli olsun, iyi ışık algılamayı hızlandırır.</div>
      <div class="guide-cols">
        <div><div class="guide-head">Galeri</div>${rows(GALLERY)}</div>
        <div><div class="guide-head">Model</div>${rows(MODEL)}</div>
      </div>
      <div class="guide-keys">${KEYS}</div>
      <div class="guide-close">devam etmek için tıkla veya bir tuşa bas</div>
    </div>`;
  document.body.appendChild(overlay);

  const btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Rehber');
  document.body.appendChild(btn);

  let visible = false;
  function show() {
    visible = true;
    overlay.classList.add('visible');
  }
  function hide() {
    if (!visible) return;
    visible = false;
    overlay.classList.remove('visible');
    localStorage.setItem(SEEN_KEY, '1');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    visible ? hide() : show();
  });
  overlay.addEventListener('click', hide);
  window.addEventListener('keydown', (e) => {
    if (e.key === '?') return visible ? hide() : show();
    if (visible) hide();
  });

  if (!localStorage.getItem(SEEN_KEY)) show();

  return { show, hide, isVisible: () => visible };
}

function rows(list) {
  return list
    .map(
      ([icon, gesture, effect]) =>
        `<div class="guide-row"><span class="gi gi-${icon}"><i></i><i></i></span><b>${gesture}</b><span>${effect}</span></div>`,
    )
    .join('');
}
