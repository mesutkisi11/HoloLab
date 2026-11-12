import { demoModels } from '../models/index.js';
import { designDb } from './db.js';
import { buildFromGlb } from './loadGlb.js';

// Galerideki tüm tasarımlar: demo modeller + IndexedDB'deki yüklemeler.
// Her tasarım: { id, name, isDemo, build(): Promise<Group>, choreoData?, choreo? }
export function createDesignRegistry() {
  let designs = [];

  async function refresh() {
    const stored = await designDb.list();
    const uploaded = stored
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((d) => ({
        id: d.id,
        name: d.name,
        isDemo: false,
        choreoData: d.choreo ?? null,
        build: () => buildFromGlb(d.buffer, d.name),
      }));
    designs = [...demoModels.map((m) => ({ ...m, build: async () => m.build() })), ...uploaded];
    return designs;
  }

  async function addFile(file) {
    const buffer = await file.arrayBuffer();
    const design = {
      id: `upl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name.replace(/\.(glb|gltf)$/i, ''),
      buffer,
      createdAt: Date.now(),
      choreo: null,
    };
    await designDb.put(design);
    await refresh();
    return design.id;
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
    addFile,
    remove,
    attachChoreo,
    get list() {
      return designs;
    },
    byId: (id) => designs.find((d) => d.id === id) ?? null,
  };
}
