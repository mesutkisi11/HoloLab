import * as THREE from 'three';
import { HOLO_ORANGE } from '../scene/hologramMaterial.js';
import { partBounds } from '../models/partBuilder.js';

// Parçayı yakından incelerken çıkan teknik çizim işaretleri:
// köşe parantezli seçim kutusu, genişlik/yükseklik/derinlik ölçü çizgileri (mm) ve parça adı.
// Çizgiler parçanın içine eklenir, böylece parça hareket edince onunla gider.

const lineMat = () =>
  new THREE.LineBasicMaterial({
    color: HOLO_ORANGE,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

export function createFocusAnnotations(camera, canvas) {
  let group = null;
  let host = null;
  const labels = [];
  const anchors = [];
  const v = new THREE.Vector3();

  const nameEl = document.createElement('div');
  nameEl.className = 'focus-name';
  document.body.appendChild(nameEl);

  function label(text) {
    const el = document.createElement('div');
    el.className = 'dim-label';
    el.textContent = text;
    document.body.appendChild(el);
    labels.push(el);
    return el;
  }

  function hide() {
    if (group && host) host.remove(group);
    group?.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    group = null;
    host = null;
    for (const el of labels) el.remove();
    labels.length = 0;
    anchors.length = 0;
    nameEl.classList.remove('visible');
  }

  function show(part, mmPerUnit = 1000) {
    hide();
    host = part;
    group = new THREE.Group();
    group.renderOrder = 30;
    const { center, size } = partBounds(part);
    const min = center.clone().sub(size.clone().multiplyScalar(0.5));
    const max = center.clone().add(size.clone().multiplyScalar(0.5));
    const off = Math.max(size.x, size.y, size.z) * 0.18 + 0.004;
    const tick = off * 0.35;
    const pts = [];
    const seg = (a, b) => pts.push(...a, ...b);

    // Köşe parantezleri (8 köşe, her köşede 3 kısa çizgi)
    const c = Math.min(size.x, size.y, size.z, 0.04) * 0.35 + 0.004;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const sx = x === min.x ? 1 : -1;
          const sy = y === min.y ? 1 : -1;
          const sz = z === min.z ? 1 : -1;
          seg([x, y, z], [x + sx * c, y, z]);
          seg([x, y, z], [x, y + sy * c, z]);
          seg([x, y, z], [x, y, z + sz * c]);
        }

    // Ölçü çizgisi: uzatma çizgileri + ana çizgi + uç çentikleri
    const dim = (a, b, offsetDir, tickDir) => {
      const o = offsetDir.clone().multiplyScalar(off);
      const A = new THREE.Vector3(...a).add(o);
      const B = new THREE.Vector3(...b).add(o);
      seg(a, A.toArray());
      seg(b, B.toArray());
      seg(A.toArray(), B.toArray());
      const t = tickDir.clone().multiplyScalar(tick);
      seg(A.clone().sub(t).toArray(), A.clone().add(t).toArray());
      seg(B.clone().sub(t).toArray(), B.clone().add(t).toArray());
      return A.add(B).multiplyScalar(0.5);
    };
    const mm = (u) => `${(u * mmPerUnit).toFixed(u * mmPerUnit < 100 ? 1 : 0)} mm`;
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    anchors.push({ pos: dim([min.x, min.y, max.z], [max.x, min.y, max.z], Z.clone().add(Y.clone().multiplyScalar(-0.3)).normalize(), Y), el: label(mm(size.x)) });
    anchors.push({ pos: dim([max.x, min.y, max.z], [max.x, max.y, max.z], X, Z), el: label(mm(size.y)) });
    anchors.push({ pos: dim([max.x, min.y, min.z], [max.x, min.y, max.z], X.clone().add(Y.clone().multiplyScalar(-0.3)).normalize(), Y), el: label(mm(size.z)) });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, lineMat());
    lines.raycast = () => {};
    group.add(lines);
    part.add(group);

    anchors.push({ pos: new THREE.Vector3(min.x, max.y, min.z), el: nameEl, isName: true });
    nameEl.textContent = part.userData.part.name;
    nameEl.classList.add('visible');
  }

  // HTML etiketlerini 3B noktaların ekrandaki yerine taşı
  function update() {
    if (!group || !host) return;
    const rect = canvas.getBoundingClientRect();
    for (const a of anchors) {
      v.copy(a.pos);
      host.localToWorld(v);
      v.project(camera);
      const behind = v.z > 1;
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      a.el.style.transform = `translate(${x}px, ${y}px) translate(${a.isName ? '-100%, -130%' : '-50%, -50%'})`;
      a.el.style.opacity = behind ? '0' : '';
    }
  }

  return { show, hide, update };
}
