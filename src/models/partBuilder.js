import * as THREE from 'three';
import {
  createHologramMaterial,
  createEdgeMaterial,
  HOLO_ORANGE,
} from '../scene/hologramMaterial.js';

// Bir "parça" = kendi malzemesi olan bir Group. Konum/dönüş bilgisi "home"
// (birleşmiş hal) olarak saklanır; hareket sistemi buna göre çalışır.
export function createPart({ id, name, parent, position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const group = new THREE.Group();
  group.name = id;
  group.position.set(...position);
  group.rotation.set(...rotation);
  group.userData.part = {
    id,
    name,
    home: { position: group.position.clone(), quaternion: group.quaternion.clone() },
    material: createHologramMaterial(),
    edgeMaterial: createEdgeMaterial(),
    highlight: 0,
  };
  parent.add(group);
  return group;
}

// Parçaya geometri ekler: hologram yüzeyi + teknik çizim kenar çizgileri.
// edgeAngle: iki yüz arasındaki açı bundan büyükse kenar çizilir (derece).
export function addMesh(
  part,
  geometry,
  { position = [0, 0, 0], rotation = [0, 0, 0], scale = null } = {},
  { edges = true, edgeAngle = 25 } = {},
) {
  const { material, edgeMaterial } = part.userData.part;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.userData.partId = part.userData.part.id;

  if (edges) {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), edgeMaterial);
    lines.raycast = () => {}; // kenar çizgileri ışın testine girmesin (performans)
    lines.userData.isEdge = true;
    mesh.add(lines);
  }

  part.add(mesh);
  return mesh;
}

// Kurulmuş modelin hızlı kopyası: geometri, kenar çizgileri ve BVH paylaşılır (yeniden hesaplanmaz),
// her parçaya yeni malzeme verilir. Model her açılışta sıfırdan kurulmasın diye kullanılır.
export function cloneModel(src) {
  const saved = new Map();
  src.traverse((o) => {
    if (!o.userData.part) return;
    saved.set(o, o.userData.part);
    o.userData.part = null;
  });
  const copy = src.clone(true);
  for (const [o, data] of saved) o.userData.part = data;

  const from = [];
  const to = [];
  src.traverse((o) => from.push(o));
  copy.traverse((o) => to.push(o));
  from.forEach((o, i) => {
    const target = to[i];
    if (o.userData.isEdge) target.raycast = () => {};
    const data = saved.get(o);
    if (!data) return;
    const material = createHologramMaterial();
    const edgeMaterial = createEdgeMaterial();
    target.userData.part = {
      ...data,
      home: { position: data.home.position.clone(), quaternion: data.home.quaternion.clone() },
      material,
      edgeMaterial,
      highlight: 0,
    };
    for (const child of target.children) {
      if (!child.isMesh) continue;
      child.material = material;
      for (const line of child.children) if (line.userData.isEdge) line.material = edgeMaterial;
    }
  });
  return copy;
}

// Modeldeki tüm parçaları (Group'ları) listeler
export function collectParts(root) {
  const parts = [];
  root.traverse((obj) => {
    if (obj.userData.part) parts.push(obj);
  });
  return parts;
}

// Bir modelin bütün parçalarının ortak kullandığı değerler: belirme yüksekliği ve genel saydamlık.
// Tek bir nesneyi değiştirmek tüm parçaları günceller.
// Yoğunluk: ışıklar üst üste toplandığı için çok parçalı modeller beyaza döner; çizgi ve yüzey
// miktarına göre parlaklık kısılır (drone ölçüsündeki modeller olduğu gibi kalır).
export function bindModelUniforms(root) {
  const { surface, edges } = modelDensity(root);
  const shared = {
    uReveal: { value: 1000 },
    uModelOpacity: { value: 1 },
    uSurfaceDensity: { value: surface },
    uEdgeDensity: { value: edges },
  };
  for (const part of collectParts(root)) {
    const { material, edgeMaterial } = part.userData.part;
    for (const mat of [material, edgeMaterial]) {
      mat.uniforms.uReveal = shared.uReveal;
      mat.uniforms.uModelOpacity = shared.uModelOpacity;
    }
    material.uniforms.uDensity = shared.uSurfaceDensity;
    edgeMaterial.uniforms.uDensity = shared.uEdgeDensity;
  }
  root.userData.uniforms = shared;
  return shared;
}

function modelDensity(root) {
  let edgeVerts = 0;
  let tris = 0;
  root.traverse((x) => {
    if (x.userData.isEdge) edgeVerts += x.geometry.attributes.position.count;
    else if (x.isMesh) tris += (x.geometry.index?.count ?? x.geometry.attributes.position.count) / 3;
  });
  const fade = (ref, n, k) => THREE.MathUtils.clamp(Math.pow(ref / Math.max(n, 1), k), 0.2, 1);
  return { surface: fade(60000, tris, 0.7), edges: fade(35000, edgeVerts, 1) };
}

// Parçanın vurgu rengi: 0 = cyan, 1 = turuncu/altın
export function setPartHighlight(part, value) {
  const data = part.userData.part;
  data.highlight = value;
  data.material.uniforms.uHighlight.value = value;
  data.edgeMaterial.uniforms.uHighlight.value = value;
}

// Parçanın kendi saydamlığı (odak modunda diğer parçaları söndürmek için)
export function setPartOpacity(part, value) {
  part.userData.part.material.uniforms.uOpacity.value = value;
  part.userData.part.edgeMaterial.uniforms.uOpacity.value = value;
}

// Köşe koordinatları üretir: [[x,z], [-x,z], [x,-z], [-x,-z]]
export function corners(x, z) {
  return [
    [x, z],
    [-x, z],
    [x, -z],
    [-x, -z],
  ];
}

// Tüm modelin saydamlığı (galeride yandaki tasarımları söndürmek için)
export function setModelOpacity(root, value, parts = null) {
  if (root.userData.uniforms) {
    root.userData.uniforms.uModelOpacity.value = value;
    return;
  }
  for (const part of parts ?? collectParts(root)) {
    part.userData.part.material.uniforms.uModelOpacity.value = value;
    part.userData.part.edgeMaterial.uniforms.uModelOpacity.value = value;
  }
}

// Tüm modeli belirli bir renge boyar (çöpe atarken kırmızımsı). null = normale dön
export function setModelTint(root, color, amount = 1) {
  for (const part of collectParts(root)) {
    for (const mat of [part.userData.part.material, part.userData.part.edgeMaterial]) {
      mat.uniforms.uHighlightColor.value.copy(color ?? HOLO_ORANGE);
      mat.uniforms.uHighlight.value = color ? amount : part.userData.part.highlight;
    }
  }
}

// Modeli verilen boyuta sığdıracak ölçeği döndürür
export function fitScale(root, targetSize) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return targetSize / Math.max(size.x, size.y, size.z, 1e-6);
}

// Parçanın kendi mesh'lerini (alt parçalar hariç) çevreleyen küre: kadraj hesabı için
export function partBounds(part) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  part.updateWorldMatrix(true, false);
  const inv = part.matrixWorld.clone().invert();
  for (const child of part.children) {
    if (!child.isMesh) continue;
    child.geometry.computeBoundingBox();
    child.updateWorldMatrix(false, false);
    tmp.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld).applyMatrix4(inv);
    box.union(tmp);
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.01, 0.01, 0.01));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center, size, radius: size.length() / 2 };
}
