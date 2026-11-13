import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree } from 'three-mesh-bvh';
import { createPart, addMesh } from '../models/partBuilder.js';
import { readCad } from './cadImport.js';
import { MODEL_EXTENSIONS, extOf } from './formats.js';

// Yüklenen dosyaları uygulamanın parça sistemine çevirir.
// Desteklenen: GLB, GLTF (+ .bin/doku), OBJ, STL, FBX, STEP/STP, IGES/IGS.
// Birden çok STL/OBJ aynı anda bırakılırsa her dosya bir parça olur (tek montaj).

const CAD = ['step', 'stp', 'iges', 'igs'];
const Z_UP = ['step', 'stp', 'iges', 'igs', 'stl']; // CAD ve 3B baskı dosyaları genelde Z yukarı
// Kaynak birimin milimetre karşılığı (ölçü çizgileri için yaklaşık)
const MM_PER_SOURCE_UNIT = { glb: 1000, gltf: 1000, fbx: 10, obj: 1, stl: 1, step: 1, stp: 1, iges: 1, igs: 1 };

const MAX_PARTS = 180;
const EDGE_TRIANGLE_LIMIT = 60000;
const TARGET_SIZE = 0.9;

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// Bırakılan dosyaları tasarımlara ayırır: [{ name, files: [{ name, buffer }] }]
export async function groupIntoDesigns(fileList) {
  const files = await Promise.all(
    [...fileList].map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })),
  );
  const models = files.filter((f) => MODEL_EXTENSIONS.includes(extOf(f.name)));
  const resources = files.filter((f) => !MODEL_EXTENSIONS.includes(extOf(f.name)) && extOf(f.name) !== 'json');
  if (models.length === 0) return [];

  const pieceFormats = models.every((f) => ['stl', 'obj'].includes(extOf(f.name)));
  if (models.length > 1 && pieceFormats) {
    return [{ name: commonName(models), files: [...models, ...resources] }];
  }
  return models.map((m) => ({ name: baseName(m.name), files: [m, ...resources] }));
}

function commonName(files) {
  const names = files.map((f) => baseName(f.name));
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[\s_\-.]+$/, '');
  return prefix.length >= 3 ? prefix : `Montaj (${files.length} parça)`;
}

// --- Kaynak nesne üretimi (format başına) ---
async function loadSource(record) {
  const files = record.files ?? [{ name: `${record.name}.glb`, buffer: record.buffer }];
  const models = files.filter((f) => MODEL_EXTENSIONS.includes(extOf(f.name)));
  const resources = files.filter((f) => !MODEL_EXTENSIONS.includes(extOf(f.name)));
  if (!models.length) throw new Error('Model dosyası bulunamadı');

  // Çok dosyalı montaj: her dosya tek parça
  if (models.length > 1) {
    const group = new THREE.Group();
    for (const f of models) {
      const obj = await loadSingle(f, resources, record);
      obj.name = baseName(f.name);
      obj.userData.forcePart = true;
      group.add(obj);
    }
    const e = extOf(models[0].name);
    if (Z_UP.includes(e)) group.rotation.x = -Math.PI / 2;
    return { source: group, mm: MM_PER_SOURCE_UNIT[e] ?? 1 };
  }

  const f = models[0];
  const e = extOf(f.name);
  const source = await loadSingle(f, resources, record);
  if (Z_UP.includes(e)) {
    const wrap = new THREE.Group();
    source.rotation.x -= Math.PI / 2;
    wrap.add(source);
    return { source: wrap, mm: MM_PER_SOURCE_UNIT[e] ?? 1 };
  }
  return { source, mm: MM_PER_SOURCE_UNIT[e] ?? 1 };
}

async function loadSingle(file, resources, record) {
  const e = extOf(file.name);
  if (e === 'glb' || e === 'gltf') return loadGltf(file, resources);
  if (e === 'obj') return new OBJLoader().parse(new TextDecoder().decode(file.buffer));
  if (e === 'stl') {
    const geo = new STLLoader().parse(file.buffer);
    const mesh = new THREE.Mesh(geo);
    mesh.name = baseName(file.name);
    return mesh;
  }
  if (e === 'fbx') return new FBXLoader().parse(file.buffer, '');
  if (CAD.includes(e)) {
    // İlk okumadan sonra sonuç kayda eklenir; tekrar açılışta OpenCascade hiç çalışmaz
    if (!record.cad) record.cad = await readCad(file.buffer, e.startsWith('ig') ? 'iges' : 'step');
    return cadToObject(record.cad, baseName(file.name));
  }
  throw new Error(`Desteklenmeyen biçim: ${e}`);
}

async function loadGltf(file, resources) {
  const urls = new Map();
  for (const r of resources) urls.set(r.name, URL.createObjectURL(new Blob([r.buffer])));
  const manager = new THREE.LoadingManager();
  // .gltf içindeki "scene.bin", "texture.png" gibi adları bırakılan dosyalara yönlendir
  manager.setURLModifier((url) => {
    const name = decodeURIComponent(url.split('/').pop());
    return urls.get(name) ?? url;
  });
  const loader = new GLTFLoader(manager);
  // Draco sıkıştırmalı GLB'ler için çözücü (three.js ile birlikte derlenir, CDN gerekmez)
  const draco = new DRACOLoader();
  loader.setDRACOLoader(draco);
  const data = extOf(file.name) === 'gltf' ? new TextDecoder().decode(file.buffer) : file.buffer;
  try {
    const gltf = await loader.parseAsync(data, '');
    return gltf.scene;
  } finally {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    draco.dispose();
  }
}

function cadToObject(cad, name) {
  const geos = cad.meshes.map((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (!m.normal) g.computeVertexNormals();
    return g;
  });
  const build = (node) => {
    const group = new THREE.Group();
    group.name = node.name || name;
    for (const i of node.meshes ?? []) {
      const mesh = new THREE.Mesh(geos[i]);
      mesh.name = cad.meshes[i].name || node.name || name;
      group.add(mesh);
    }
    for (const child of node.children ?? []) group.add(build(child));
    return group;
  };
  return build(cad.root);
}

// --- Parça sistemine çevirme ---
function collectMeshes(obj) {
  const meshes = [];
  obj.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });
  return meshes;
}

// Parça olacak düğümleri seç: tek çocuklu zinciri in, sonra o seviyedeki düğümleri al
function choosePartNodes(source) {
  const forced = source.children.filter((c) => c.userData.forcePart);
  if (forced.length) return forced;
  const meshes = collectMeshes(source);
  if (meshes.length <= MAX_PARTS) return meshes;

  let level = [source];
  while (level.length === 1 && level[0].children.length > 0 && !level[0].isMesh) level = level[0].children;
  level = level.filter((n) => collectMeshes(n).length > 0);
  if (level.length >= 2 && level.length <= MAX_PARTS) return level;

  // Son çare: en büyük mesh'ler ayrı parça, geri kalanı tek parçada
  const bySize = meshes
    .map((m) => ({ m, s: new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).length() }))
    .sort((a, b) => b.s - a.s);
  const big = bySize.slice(0, MAX_PARTS - 1).map((x) => x.m);
  const rest = new THREE.Group();
  rest.name = 'Diğer parçalar';
  rest.userData.meshList = bySize.slice(MAX_PARTS - 1).map((x) => x.m);
  return [...big, rest];
}

function triangleCount(geo) {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

// Kaynağı merkezleyip ölçekler ve her parça düğümünü createPart ile bir parçaya çevirir
export async function buildDesign(record) {
  const { source, mm } = await loadSource(record);
  source.updateMatrixWorld(true);

  const box = new THREE.Box3();
  for (const m of collectMeshes(source)) box.expandByObject(m);
  if (box.isEmpty()) throw new Error('Modelde görünür geometri yok');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z, 1e-9);

  // Dünya -> model: merkeze al, ölçekle, tabanı hafif aşağıda tut
  const toModel = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  toModel.premultiply(new THREE.Matrix4().makeTranslation(0, -0.2 + (size.y * scale) / 2, 0));

  const root = new THREE.Group();
  root.name = record.name;
  root.userData.mmPerUnit = mm / scale;

  const used = new Set();
  const nodes = choosePartNodes(source);
  nodes.forEach((node, index) => {
    const meshes = node.userData.meshList ?? (node.isMesh ? [node] : collectMeshes(node));
    if (!meshes.length) return;

    // Parça pivotu = parçanın sınır kutusu merkezi (model uzayında)
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      return g;
    });
    const pbox = new THREE.Box3();
    for (const g of geos) {
      g.computeBoundingBox();
      pbox.union(g.boundingBox);
    }
    const pivot = pbox.getCenter(new THREE.Vector3());
    for (const g of geos) g.translate(-pivot.x, -pivot.y, -pivot.z);

    let id = (node.name || meshes[0].name || `parca_${index}`).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || `parca_${index}`;
    while (used.has(id)) id = `${id}_${index}`;
    used.add(id);

    const part = createPart({ id, name: node.name || id, parent: root, position: pivot.toArray() });
    let merged = null;
    if (geos.length > 1) {
      try {
        const allIndexed = geos.every((g) => g.index);
        merged = mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      } catch {
        merged = null;
      }
    }
    for (const g of merged ? [merged] : geos) {
      const tris = triangleCount(g);
      if (tris > 5000) computeBoundsTree.call(g); // hızlı ışın testi (BVH)
      addMesh(part, g, {}, { edges: tris < EDGE_TRIANGLE_LIMIT, edgeAngle: 30 });
    }
  });

  return root;
}
