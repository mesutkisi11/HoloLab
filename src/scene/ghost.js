import * as THREE from 'three';
import { createGhostMaterial } from './hologramMaterial.js';

// Modelin birleşmiş halinin tel kafes kopyası. Parçalar hareket ederken bu sabit kalır,
// böylece her parçanın nereye gideceği görünür. Parçaların kenar çizgilerini yeniden kullanır.
export function createGhost(modelRoot, shared = null) {
  const ghost = new THREE.Group();
  const material = createGhostMaterial();
  if (shared) {
    material.uniforms.uReveal = shared.uReveal;
    material.uniforms.uModelOpacity = shared.uModelOpacity;
  }

  modelRoot.updateMatrixWorld(true);
  modelRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const edgeChild = obj.children.find((c) => c.userData.isEdge);
    const geometry = edgeChild ? edgeChild.geometry : new THREE.EdgesGeometry(obj.geometry, 25);
    const lines = new THREE.LineSegments(geometry, material);
    lines.raycast = () => {};
    // Parçanın (birleşmiş) konumunu kopyala: hayalet, hiyerarşiden bağımsız dursun
    obj.matrixWorld.decompose(lines.position, lines.quaternion, lines.scale);
    ghost.add(lines);
  });

  ghost.userData.material = material;
  return ghost;
}
