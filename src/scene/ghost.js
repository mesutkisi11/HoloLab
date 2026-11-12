import * as THREE from 'three';
import { createGhostMaterial } from './hologramMaterial.js';

// Modelin birleşmiş halinin tel kafes kopyası. Parçalar hareket ederken bu sabit kalır,
// böylece her parçanın nereye gideceği görünür.
export function createGhost(modelRoot) {
  const ghost = new THREE.Group();
  const material = createGhostMaterial();

  modelRoot.updateMatrixWorld(true);
  modelRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const mesh = new THREE.Mesh(obj.geometry, material);
    // Parçanın dünya konumunu kopyala: hayalet, hiyerarşiden bağımsız dursun
    obj.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    ghost.add(mesh);
  });

  return ghost;
}
