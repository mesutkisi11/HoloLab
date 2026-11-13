import { demoModels } from '../models/index.js';
import { designDb } from './db.js';
import { formatLabel } from './formats.js';

// Yükleyiciler (GLTF, FBX, STEP...) büyük; sadece ilk yüklenen tasarım açılınca indirilir
const loaders = () => import('./loaders.js');

// Galerideki tüm tasarımlar: demo modeller + IndexedDB'deki yüklemeler.
// Her tasarım: { id, name, isDemo, format, build(): Promise<Group>, choreoData?, choreo? }
export function createDesignRegistry() {
  let designs = [];
  const records = new Map();

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
      ...uploaded,
    ];
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

  return {
    refresh,
    addFiles,
    remove,
    attachChoreo,
    get list() {
      return designs;
    },
    byId: (id) => designs.find((d) => d.id === id) ?? null,
  };
}
