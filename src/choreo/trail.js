import * as THREE from 'three';
import { HOLO_ORANGE } from '../scene/hologramMaterial.js';

const POINTS = 20;

// Hareket eden parçanın arkasında kısa, sönen parlak iz
export function createTrails(scene, parts) {
  const trails = parts.map((part) => {
    const positions = new Float32Array(POINTS * 3);
    const colors = new Float32Array(POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    return { part, line, points: [], ages: [] };
  });

  const world = new THREE.Vector3();

  return {
    update(dt, isMoving) {
      for (const tr of trails) {
        const moving = isMoving(tr.part.userData.part.id);
        if (moving) {
          tr.part.getWorldPosition(world);
          tr.points.unshift(world.clone());
          tr.ages.unshift(0);
          if (tr.points.length > POINTS) {
            tr.points.pop();
            tr.ages.pop();
          }
        }
        for (let i = 0; i < tr.ages.length; i++) tr.ages[i] += dt * 2.5;
        while (tr.ages.length && tr.ages[tr.ages.length - 1] > 1) {
          tr.ages.pop();
          tr.points.pop();
        }

        if (tr.points.length < 2) {
          tr.line.visible = false;
          continue;
        }
        tr.line.visible = true;
        const pos = tr.line.geometry.attributes.position;
        const col = tr.line.geometry.attributes.color;
        for (let i = 0; i < POINTS; i++) {
          const idx = Math.min(i, tr.points.length - 1);
          const p = tr.points[idx];
          pos.setXYZ(i, p.x, p.y, p.z);
          const fade = Math.max(0, 1 - tr.ages[idx]) * (1 - i / POINTS);
          col.setXYZ(i, HOLO_ORANGE.r * fade, HOLO_ORANGE.g * fade, HOLO_ORANGE.b * fade);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }
    },
    dispose() {
      for (const tr of trails) {
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
      }
    },
  };
}
