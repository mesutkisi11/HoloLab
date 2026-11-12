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
    // Sadece kenar çizgileri: üçgen ağı yerine temiz bir teknik çizim görünümü
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(obj.geometry, 25), material);
    // Parçanın dünya konumunu kopyala: hayalet, hiyerarşiden bağımsız dursun
    obj.matrixWorld.decompose(lines.position, lines.quaternion, lines.scale);
    ghost.add(lines);
  });

  return ghost;
}
