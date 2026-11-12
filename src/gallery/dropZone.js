// Sayfaya sürükle-bırak: .glb/.gltf dosyaları galeriye, .json dosyaları koreografi olarak
export function createDropZone({ onModel, onChoreo, hud }) {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.textContent = 'Bırak: GLB / GLTF ekle · JSON koreografi yükle';
  document.body.appendChild(overlay);

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
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('visible');
    for (const file of e.dataTransfer.files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        hud.setStatus(`Yükleniyor: ${file.name}`);
        await onModel(file);
        hud.setStatus('');
      } else if (lower.endsWith('.json')) {
        try {
          await onChoreo(JSON.parse(await file.text()));
        } catch (err) {
          console.warn(err);
          hud.showGesture('JSON okunamadı');
        }
      }
    }
  });
}
