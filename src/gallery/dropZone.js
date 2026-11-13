import { MODEL_EXTENSIONS, extOf } from './formats.js';

// Sayfaya sürükle-bırak + gizli dosya seçici.
// Model dosyaları (GLB, GLTF, OBJ, STL, FBX, STEP, IGES ve yardımcı .bin/doku dosyaları) galeriye,
// .json dosyaları koreografi olarak gider.
const ACCEPT = [...MODEL_EXTENSIONS, 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'json'].map((e) => `.${e}`).join(',');

export function createDropZone({ onModels, onChoreo, hud }) {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-frame">
      <div class="drop-title">Tasarımı bırak</div>
      <div class="drop-formats">GLB · GLTF · OBJ · STL · FBX · STEP · IGES</div>
      <div class="drop-note">Birden fazla STL / OBJ bırakırsan her dosya bir parça olur</div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = 'none';
  document.body.appendChild(input);

  async function handle(files) {
    const list = [...files];
    const models = list.filter((f) => extOf(f.name) !== 'json');
    const jsons = list.filter((f) => extOf(f.name) === 'json');
    if (models.some((f) => MODEL_EXTENSIONS.includes(extOf(f.name)))) {
      hud.setStatus(`Yükleniyor · ${models[0].name}${models.length > 1 ? ` +${models.length - 1}` : ''}`);
      try {
        await onModels(models);
      } catch (err) {
        console.warn(err);
        hud.showGesture('Dosya okunamadı');
      }
      hud.setStatus('');
    } else if (models.length) {
      hud.showGesture('Desteklenmeyen dosya');
    }
    for (const f of jsons) {
      try {
        await onChoreo(JSON.parse(await f.text()));
      } catch (err) {
        console.warn(err);
        hud.showGesture('JSON okunamadı');
      }
    }
  }

  input.addEventListener('change', () => {
    if (input.files.length) handle(input.files);
    input.value = '';
  });

  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    overlay.classList.add('visible');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('visible');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('visible');
    if (e.dataTransfer.files.length) handle(e.dataTransfer.files);
  });

  return {
    // Dosya seçiciyi aç: tarayıcı kuralı gereği sadece tıklama veya tuş basımı içinden çalışır
    openPicker() {
      input.click();
    },
  };
}
