// STEP / IGES (CAD) dosyalarını tarayıcıda okur. OpenCascade'in WebAssembly sürümü
// (occt-import-js) sadece gerektiğinde, ayrı bir iş parçacığında yüklenir; büyük montajlar
// okunurken arayüz donmaz. Sonuç: her katı cisim için üçgen ağı + montaj ağacı.

const OCCT_CDN = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';

const workerSource = `
importScripts('${OCCT_CDN}occt-import-js.js');
const ready = occtimportjs({ locateFile: (name) => '${OCCT_CDN}' + name });
self.onmessage = async (e) => {
  const { buffer, format } = e.data;
  try {
    const occt = await ready;
    const bytes = new Uint8Array(buffer);
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.0015,
      angularDeflection: 0.5,
    };
    const result =
      format === 'iges' ? occt.ReadIgesFile(bytes, params)
      : format === 'brep' ? occt.ReadBrepFile(bytes, params)
      : occt.ReadStepFile(bytes, params);
    if (!result || !result.success) throw new Error('CAD dosyası okunamadı');
    const transfer = [];
    const meshes = result.meshes.map((m) => {
      const position = new Float32Array(m.attributes.position.array);
      const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      const index = new Uint32Array(m.index.array);
      transfer.push(position.buffer, index.buffer);
      if (normal) transfer.push(normal.buffer);
      return { name: m.name || '', position, normal, index };
    });
    self.postMessage({ ok: true, meshes, root: result.root }, transfer);
  } catch (err) {
    self.postMessage({ ok: false, message: String((err && err.message) || err) });
  }
};
`;

let workerUrl = null;

export function readCad(buffer, format) {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    const done = (fn, value) => {
      worker.terminate();
      fn(value);
    };
    worker.onmessage = (e) => {
      if (e.data.ok) done(resolve, { meshes: e.data.meshes, root: e.data.root });
      else done(reject, new Error(e.data.message));
    };
    worker.onerror = (e) => done(reject, new Error(e.message || 'CAD okuyucu yüklenemedi'));
    // Kopya gönder: orijinal tampon IndexedDB'ye kaydedilmeye devam etsin
    const copy = buffer.slice(0);
    worker.postMessage({ buffer: copy, format }, [copy]);
  });
}
