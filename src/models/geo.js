import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Kodla model üretmek için geometri yardımcıları.
// Hepsi THREE.BufferGeometry döndürür; place() ile konumlandırılıp merge() ile birleştirilir.
// Birleştirmek çizim çağrısı (draw call) sayısını azaltır: daha fazla detay, aynı performans.

// Geometriyi yerinde döndürüp taşır (birleştirmeden önce kullanılır)
export function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...(scale ?? [1, 1, 1])),
  );
  geo.applyMatrix4(m);
  return geo;
}

// Farklı türdeki geometrileri birleştirir (sadece konum + normal tutulur)
export function merge(geos) {
  const prepared = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(ng.attributes)) {
      if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
    }
    if (!ng.attributes.normal) ng.computeVertexNormals();
    return ng;
  });
  return mergeGeometries(prepared, false);
}

// --- 2B şekiller ---
export function roundedRectShape(w, h, r, cx = 0, cy = 0, PathClass = THREE.Shape) {
  const s = new PathClass();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function circleHole(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

// Yuvarlak uçlu oluk (stadyum) deliği
export function slotHole(cx, cy, len, width, angle = 0) {
  const p = new THREE.Path();
  const r = width / 2;
  const half = len / 2 - r;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ax = cx - dx * half;
  const ay = cy - dy * half;
  const bx = cx + dx * half;
  const by = cy + dy * half;
  p.absarc(bx, by, r, angle - Math.PI / 2, angle + Math.PI / 2, false);
  p.absarc(ax, ay, r, angle + Math.PI / 2, angle + (3 * Math.PI) / 2, false);
  return p;
}

export function roundedRectHole(w, h, r, cx, cy) {
  return roundedRectShape(w, h, r, cx, cy, THREE.Path);
}

// Delikli plaka: XZ düzleminde yatar, kalınlığı Y ekseninde, merkezi y=0.
// Şekil koordinatları: (x, z) — holes içindeki y değeri dünya Z'sine karşılık gelir.
export function plate(w, d, t, { radius = 0.01, holes = [], bevel = 0.0012 } = {}) {
  const shape = roundedRectShape(w, d, radius);
  shape.holes.push(...holes);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: t - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
  });
  // Extrude +Z yönünde; plakayı yatırıp ortala
  geo.translate(0, 0, -(t - bevel * 2) / 2);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// Yuvarlatılmış kutu: X boyunca uzanan çubuk (kesit Y-Z'de yuvarlatılmış dikdörtgen)
export function roundedBar(len, h, w, r, bevel = 0.002) {
  const shape = roundedRectShape(w, h, r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: len - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelSegments: 1,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(len - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

// Eksenler boyunca silindirler
export const cylY = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cylX = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
export const cylZ = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
export const hexY = (r, h) => new THREE.CylinderGeometry(r, r, h, 6);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Döner profil: [[yarıçap, y], ...] noktalarını Y ekseni etrafında döndürür (motor çanı, mercek)
export function lathe(profile, segments = 32) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

// Bir eğri boyunca boru (kablo, bükülmüş ayak)
export function tube(points, radius, segments = 24, radial = 16) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segments, radius, radial, false);
}

// Vida dişi: şaft etrafında sarmal ince boru
export function threadHelix(radius, length, pitch, wire = 0.0005) {
  const turns = Math.max(2, Math.floor(length / pitch));
  const pts = [];
  const steps = turns * 14;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 14) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, (i / steps) * length - length / 2, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, wire, 3, false);
}

// Kanat profilli, burulmalı pervane kanatları (Y ekseni etrafında döner)
export function propBlades({
  span = 0.16,
  hub = 0.012,
  rootChord = 0.03,
  tipChord = 0.012,
  twistRoot = 0.5,
  twistTip = 0.13,
  thick = 0.004,
  blades = 2,
  dir = 1,
  sections = 14,
  profile = 12,
} = {}) {
  const positions = [];
  const indices = [];
  for (let b = 0; b < blades; b++) {
    const phi = (b / blades) * Math.PI * 2;
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const base = positions.length / 3;
    for (let i = 0; i <= sections; i++) {
      const t = i / sections;
      const r = hub + (span - hub) * t;
      // Uca doğru daralan ve yuvarlanan veter (chord)
      let chord = THREE.MathUtils.lerp(rootChord, tipChord, t);
      if (t > 0.82) chord *= Math.sqrt(Math.max(0.05, 1 - ((t - 0.82) / 0.18) ** 2));
      if (t < 0.12) chord *= 0.55 + 0.45 * (t / 0.12);
      const twist = THREE.MathUtils.lerp(twistRoot, twistTip, t) * dir;
      const th = thick * (1 - 0.65 * t);
      const sweep = t * t * 0.01;
      for (let j = 0; j < profile; j++) {
        const a = (j / profile) * Math.PI * 2;
        const c = (Math.cos(a) * chord) / 2;
        const camber = 0.0012 * (1 - (2 * c / chord) ** 2);
        const k = (Math.sin(a) * th) / 2 + camber;
        // Burulma: kesiti kanat ekseni (X) etrafında döndür
        const y = c * Math.sin(twist) + k * Math.cos(twist);
        const z = c * Math.cos(twist) - k * Math.sin(twist) + sweep * dir;
        // Kanadı göbek etrafında yerleştir
        positions.push(r * cphi + z * sphi, y, -r * sphi + z * cphi);
      }
    }
    const ring = (i, j) => base + i * profile + (j % profile);
    for (let i = 0; i < sections; i++) {
      for (let j = 0; j < profile; j++) {
        indices.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1));
        indices.push(ring(i, j), ring(i + 1, j + 1), ring(i, j + 1));
      }
    }
    // Uç kapağı
    const tipCenter = positions.length / 3;
    const tipR = span;
    positions.push(tipR * cphi, 0, -tipR * sphi);
    for (let j = 0; j < profile; j++) indices.push(ring(sections, j), tipCenter, ring(sections, j + 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Altıgen başlı / imbus vida: baş + şaft + diş. dir 'down' = baş üstte, şaft aşağıda
export function screwGeometry(direction = 'down', { length = 0.03, shaftR = 0.0035, headR = 0.0072, headH = 0.007 } = {}) {
  const sign = direction === 'down' ? -1 : 1;
  const head = lathe(
    [
      [0, 0],
      [headR, 0],
      [headR, headH * 0.75],
      [headR * 0.82, headH],
      [0, headH],
    ],
    20,
  );
  // Başı "y=0'da oturan" hale getir: 'down' için baş yukarıda (0..h), 'up' için aşağıda (-h..0)
  if (sign > 0) head.rotateX(Math.PI);
  head.translate(0, sign < 0 ? -0.0005 : 0.0005, 0);
  const socket = hexY(headR * 0.45, 0.0006);
  socket.translate(0, sign < 0 ? headH : -headH, 0);
  const shaft = cylY(shaftR, shaftR, length, 12);
  shaft.translate(0, sign * (length / 2), 0);
  const thread = threadHelix(shaftR + 0.0003, length * 0.8, 0.0022);
  thread.translate(0, sign * (length * 0.55), 0);
  return merge([head, socket, shaft, thread]);
}
