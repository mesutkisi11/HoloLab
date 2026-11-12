import * as THREE from 'three';
import {
  createHologramMaterial,
  createEdgeMaterial,
  HOLO_CYAN,
  HOLO_ORANGE,
} from '../scene/hologramMaterial.js';

// Bir "parça" = kendi malzemesi olan bir Group. Konum/dönüş bilgisi "home"
// (birleşmiş hal) olarak saklanır; hareket sistemi buna göre çalışacak.
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

// Parçaya geometri ekler: hologram yüzeyi + kenar çizgileri
export function addMesh(
  part,
  geometry,
  { position = [0, 0, 0], rotation = [0, 0, 0] } = {},
  { edges = true } = {},
) {
  const { material, edgeMaterial } = part.userData.part;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.userData.partId = part.userData.part.id;

  if (edges) {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial);
    lines.raycast = () => {}; // kenar çizgileri ışın testine girmesin (performans)
    mesh.add(lines);
  }

  part.add(mesh);
  return mesh;
}

// Modeldeki tüm parçaları (Group'ları) listeler
export function collectParts(root) {
  const parts = [];
  root.traverse((obj) => {
    if (obj.userData.part) parts.push(obj);
  });
  return parts;
}

// Parçanın vurgu rengini ayarlar: 0 = cyan, 1 = turuncu/altın
export function setPartHighlight(part, value) {
  const data = part.userData.part;
  data.highlight = value;
  data.material.uniforms.uHighlight.value = value;
  data.edgeMaterial.color.copy(HOLO_CYAN).lerp(HOLO_ORANGE, value);
  data.edgeMaterial.opacity = 0.35 + value * 0.45;
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
export function setModelOpacity(root, value, parts = collectParts(root)) {
  for (const part of parts) {
    part.userData.part.material.uniforms.uOpacity.value = value;
    part.userData.part.edgeMaterial.opacity = 0.3 * value;
  }
}

// Tüm modeli belirli bir renge boyar (çöpe atarken kırmızımsı). null = normale dön
export function setModelTint(root, color, amount = 1) {
  for (const part of collectParts(root)) {
    const u = part.userData.part.material.uniforms;
    u.uHighlightColor.value.copy(color ?? HOLO_ORANGE);
    u.uHighlight.value = color ? amount : part.userData.part.highlight;
  }
}

// Modeli verilen boyuta sığdıracak ölçeği döndürür
export function fitScale(root, targetSize) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return targetSize / Math.max(size.x, size.y, size.z, 1e-6);
}
