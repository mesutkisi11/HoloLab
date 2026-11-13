// Rehber ekranı: bütün hareketlerin listesi (animasyonlu küçük ikonlar).
// Uygulamalı eğitimden "Tüm liste" ile ya da ? tuşuyla açılır.

const GALLERY = [
  ['swipe', 'Açık elle sağa / sola kaydır', 'tasarımlar arasında gez'],
  ['pinch2', 'Başparmak + işaret iki kez değdir', 'seçili tasarımı aç'],
  ['fist', 'Avucunu kapat (kısa)', 'seçili tasarımı aç'],
  ['hold', 'Avucunu kapat ve tut, çöpe savur', 'tasarımı sil'],
  ['pull', 'Açık eli kendine çek (5 sn içinde)', 'silmeyi geri al'],
  ['add', 'En sondaki + yuvasına tıkla, U tuşuna bas ya da dosyayı pencereye sürükle', 'tasarım ekle · GLB GLTF OBJ STL FBX STEP IGES'],
];

const MODEL = [
  ['fists', 'İki başparmağı değdir, sonra ellerini ayır / yaklaştır', 'değince birleşir, ayrılınca sökülür'],
  ['grab', 'Parça üstünde pinch yapıp çek', 'parçayı çıkar; bırakınca oturur'],
  ['point', 'İşaret parmağını sökülmüş parçada tut', 'parçayı ölçüleriyle yakından incele'],
  ['drag', 'Açık elle sürükle, savurup bırak', 'döndür (savurunca dönmeye devam eder)'],
  ['swipe', 'Açık elle hızlı sağa / sola', 'sonraki / önceki adım'],
  ['push', 'Avucu hızla öne it', 'patlat (exploded view)'],
  ['zoom', 'İki elle pinch, ellerini aç / kapat', 'büyüt / küçült'],
  ['push', 'Beş parmak ucunu topla, sonra eli aç / tekrar topla', 'yakınlaştır / uzaklaştır'],
  ['fists', 'İki yumruğu birleştir', 'tam montaj'],
  ['hold', 'Yumruğu modelin üstünde tut, çöpe savur', 'modeli sil'],
  ['pinch3', 'Parmak şıklat', 'bir adım geri; en baştaysa galeriye dön'],
  ['up', 'Açık elle hızla yukarı kaydır', 'galeriye dön'],
];

const KEYS = 'Klavye: U tasarım yükle · Esc galeri · Enter aç · Space oynat · E sök · A birleştir · ← → adım · S ses · B görüntü kalitesi · C sinematik · V dikey/yatay · J koreografi JSON · Del sil · ? rehber';

export function createGuide({ onTutorial } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'guide';
  overlay.innerHTML = `
    <div class="guide-card">
      <div class="guide-title">Elini kameraya göster</div>
      <div class="guide-sub">HoloLab eller ile kontrol edilir. Parmak şıklatmak modelde bir adım geri alır. Avucu kapatmak her yerde "tut / seç" demektir. Ellerin kamerada belli olsun, iyi ışık algılamayı hızlandırır.</div>
      <div class="guide-cols">
        <div><div class="guide-head">Galeri</div>${rows(GALLERY)}</div>
        <div><div class="guide-head">Model</div>${rows(MODEL)}</div>
      </div>
      <button class="guide-tut">▶ Hareketleri canlı göster</button>
      <div class="guide-keys">${KEYS}</div>
      <div class="guide-close">devam etmek için tıkla veya bir tuşa bas</div>
    </div>`;
  document.body.appendChild(overlay);

  let visible = false;
  function show() {
    visible = true;
    overlay.classList.add('visible');
  }
  function hide() {
    if (!visible) return;
    visible = false;
    overlay.classList.remove('visible');
  }

  overlay.querySelector('.guide-tut').addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
    onTutorial?.();
  });
  overlay.addEventListener('click', hide);
  window.addEventListener('keydown', (e) => {
    if (e.key === '?') return visible ? hide() : show();
    if (visible) hide();
  });

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
