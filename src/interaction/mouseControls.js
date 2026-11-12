import * as THREE from 'three';

// Fare / dokunma yedeği: parçayı sürükleyerek çıkarma. Döndürme ve yakınlaştırma OrbitControls'ta.
export function createMouseControls({ canvas, camera, grab, orbit, ring, getPart, isActive }) {
  const world = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  let active = null; // { id, depth }
  let lastT = 0;

  function toWorld(clientX, clientY, depth, out) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    return out.copy(camera.position).addScaledVector(dir, depth / Math.max(1e-4, dir.dot(forward)));
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isActive()) return;
    const id = grab.hoverAt((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    if (!id) return;
    const depth = grab.depthOf(id);
    toWorld(e.clientX, e.clientY, depth, world);
    if (grab.begin(id, world)) {
      active = { id, depth };
      orbit.enabled = false;
      ring.set(getPart(id), true);
      lastT = performance.now();
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const now = performance.now();
    const dt = Math.max((now - lastT) / 1000, 1e-3);
    lastT = now;
    toWorld(e.clientX, e.clientY, active.depth, world);
    grab.move(world, dt);
  });

  const release = () => {
    if (!active) return;
    grab.end();
    ring.set(null, false);
    active = null;
    orbit.enabled = true;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
