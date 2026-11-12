import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPart, addMesh } from '../models/partBuilder.js';

const MAX_EDGE_TRIANGLES = 30000; // çok büyük mesh'lerde kenar çizgisi hesaplamak pahalı

// GLB/GLTF dosyasını (ArrayBuffer) bizim parça sistemine çevirir:
// her Mesh bir parça olur, hologram malzemesi alır, model 1 birim boyuta sığdırılır.
export async function buildFromGlb(buffer, name = 'model') {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const source = gltf.scene;
  source.updateMatrixWorld(true);

  // Önce boyut ve merkez: modeli ortala ve ölçekle
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 0.9 / Math.max(size.x, size.y, size.z, 1e-6);

  const root = new THREE.Group();
  root.name = name;
  const used = new Set();
  let index = 0;

  source.traverse((obj) => {
    if (!obj.isMesh) return;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scl);

    // Parça adı: mesh adı, yoksa üst düğümün adı, yoksa numara
    let id = (obj.name || obj.parent?.name || `part_${index}`).replace(/\s+/g, '_');
    while (used.has(id)) id = `${id}_${index}`;
    used.add(id);
    index++;

    const part = createPart({ id, name: id, parent: root });
    part.position.copy(pos.sub(center).multiplyScalar(scale));
    part.quaternion.copy(quat);
    part.userData.part.home.position.copy(part.position);
    part.userData.part.home.quaternion.copy(part.quaternion);

    const geometry = obj.geometry;
    const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    const mesh = addMesh(part, geometry, {}, { edges: triangles < MAX_EDGE_TRIANGLES });
    mesh.scale.copy(scl).multiplyScalar(scale);
  });

  return root;
}
