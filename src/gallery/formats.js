// Desteklenen dosya biçimleri ve küçük yardımcılar (yükleyicilerden ayrı: ilk açılışta hafif kalsın)
export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'step', 'stp', 'iges', 'igs'];

export const extOf = (name) => name.split('.').pop().toLowerCase();

// Galeride görünen biçim etiketi: GLB, STEP, STL ×5 ...
export function formatLabel(record) {
  const models = (record.files ?? []).filter((f) => MODEL_EXTENSIONS.includes(extOf(f.name)));
  if (!models.length) return 'GLB';
  const e = extOf(models[0].name).toUpperCase();
  return models.length > 1 ? `${e} ×${models.length}` : e === 'STP' ? 'STEP' : e;
}
