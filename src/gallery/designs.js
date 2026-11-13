import { demoModels } from '../models/index.js';
import { designDb } from './db.js';
import { formatLabel } from './formats.js';
import { cloneModel } from '../models/partBuilder.js';

// Yükleyiciler (GLTF, FBX, STEP...) büyük; sadece ilk yüklenen tasarım açılınca indirilir
const loaders = () => import('./loaders.js');

// İlk kurulan model saklanır, sonraki her istek onun hızlı kopyasını alır
function cached(build) {
  let template = null;
  const fn = async () => {
    template ??= build().catch((err) => {
      template = null;
      throw err;
    });
    return cloneModel(await template);
  };
  fn.cached = true;
  return fn;
}

// Hazır örnek montajlar: Khronos glTF örnek deposundan çalışırken indirilir (depoda tutulmaz,
// lisansları ayrı). Demo gibi silinmez.
const LIBRARY_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0';
const LIBRARY = [
  { id: 'lib-gearbox', name: 'Dişli Kutusu', file: 'GearboxAssy.glb' },
  { id: 'lib-engine', name: 'İki Silindirli Motor', file: '2CylinderEngine.glb' },
  { id: 'lib-saw', name: 'Dekupaj Testeresi', file: 'ReciprocatingSaw.glb' },
  { id: 'lib-buggy', name: 'Buggy', file: 'Buggy.glb' },
];

function libraryDesign(item) {
  // İndirme hemen başlar: dört model aynı anda iner
  const url = `${LIBRARY_URL}/${item.file.replace('.glb', '')}/glTF-Binary/${item.file}`;
  let buffer = null;
  const download = () =>
    (buffer ??= fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${item.file} indirilemedi`);
      return res.arrayBuffer();
    })).catch((err) => {
      buffer = null;
      throw err;
    });
  download().catch(() => {});
  return {
    id: item.id,
    name: item.name,
    isDemo: true,
    format: 'GLB',
    build: async () => {
      const { buildDesign } = await loaders();
      return buildDesign({ id: item.id, name: item.name, buffer: await download() });
    },
  };
}

// Galerideki tüm tasarımlar: demo modeller + hazır montajlar + IndexedDB'deki yüklemeler.
// Her tasarım: { id, name, isDemo, format, build(): Promise<Group>, choreoData?, choreo? }
export function createDesignRegistry() {
  let designs = [];
  const records = new Map();
  const library = LIBRARY.map(libraryDesign);

  function toDesign(record) {
    return {
      id: record.id,
      name: record.name,
      isDemo: false,
      format: formatLabel(record),
      choreoData: record.choreo ?? null,
      build: async () => {
        const hadCad = !!record.cad;
        const { buildDesign } = await loaders();
        const root = await buildDesign(record);
        // CAD dosyası ilk kez okunduysa sonucu sakla: bir sonraki açılış anında olur
        if (!hadCad && record.cad) designDb.put(record).catch(() => {});
        return root;
      },
    };
  }

  async function refresh() {
    const stored = await designDb.list();
    records.clear();
    for (const r of stored) records.set(r.id, r);
    const uploaded = stored.sort((a, b) => a.createdAt - b.createdAt).map(toDesign);
    designs = [
      ...demoModels.map((m) => ({ ...m, format: 'DEMO', build: async () => m.build() })),
      ...library.filter((d) => d.ready),
      ...uploaded,
    ].map((d) => {
      const prev = designs.find((x) => x.id === d.id);
      return { ...d, build: prev?.build ?? (d.build.cached ? d.build : cached(d.build)) };
    });
    return designs;
  }

  // Bırakılan / seçilen dosyalar: her tasarım için bir kayıt; yeni kimlikleri döndürür
  async function addFiles(fileList) {
    const { groupIntoDesigns } = await loaders();
    const groups = await groupIntoDesigns(fileList);
    const ids = [];
    for (const g of groups) {
      const record = {
        id: `upl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: g.name,
        files: g.files,
        createdAt: Date.now(),
        choreo: null,
      };
      await designDb.put(record);
      ids.push(record.id);
    }
    await refresh();
    return ids;
  }

  async function remove(id) {
    await designDb.remove(id);
    await refresh();
  }

  // Elle düzenlenmiş koreografi JSON'unu bir tasarıma bağla
  async function attachChoreo(id, choreo) {
    const d = await designDb.get(id);
    if (!d) return false;
    d.choreo = choreo;
    await designDb.put(d);
    await refresh();
    return true;
  }

  // Hazır montajları sırayla kurar; her biri bitince galeriye eklenmesi için onReady çağrılır
  async function prepareLibrary(onReady) {
    let done = 0;
    for (const d of library) {
      try {
        d.build = cached(d.build);
        await d.build();
        d.ready = true;
      } catch (err) {
        console.warn(`Örnek montaj yüklenemedi: ${d.name}`, err);
      }
      await onReady(++done, library.length);
    }
  }

  return {
    refresh,
    prepareLibrary,
    addFiles,
    remove,
    attachChoreo,
    get list() {
      return designs;
    },
    byId: (id) => designs.find((d) => d.id === id) ?? null,
  };
}
