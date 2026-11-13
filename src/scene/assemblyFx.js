import * as THREE from 'three';
import { HOLO_CYAN, HOLO_ORANGE, sharedTime, getGlowTexture } from './hologramMaterial.js';
import { partBounds } from '../models/partBuilder.js';

// Montaj efektleri:
//  - Bağ çizgileri: yerinden çıkmış her parçadan hayaletteki yuvasına uzanan kesikli çizgi
//  - Yuva noktası: parçanın gideceği yerde küçük parlayan nokta
//  - Oturma dalgası: parça yerine oturunca o noktada genişleyen halka

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export function createAssemblyFx(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);

  let tethers = null;
  let entries = [];

  // --- Oturma dalgası havuzu ---
  const pulseMat = () =>
    new THREE.ShaderMaterial({
      ...additive,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: HOLO_ORANGE.clone() }, uT: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uT;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = exp(-pow((r - 0.9) * 18.0, 2.0));
          float inner = exp(-pow((r - 0.55) * 30.0, 2.0)) * 0.4;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3), (ring + inner) * (1.0 - uT));
        }
      `,
    });
  const pulses = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pulseMat());
    m.visible = false;
    m.raycast = () => {};
    m.userData.t = 1;
    group.add(m);
    return m;
  });
  let nextPulse = 0;

  function pulseAt(worldPos, size) {
    const p = pulses[nextPulse++ % pulses.length];
    p.position.copy(worldPos);
    p.userData.t = 0;
    p.userData.size = Math.max(0.04, size);
    p.visible = true;
  }

  // --- Bağ çizgileri ---
  function attach(steps, root) {
    detach();
    root.updateMatrixWorld(true);
    entries = steps.map((step) => {
      const b = partBounds(step.part);
      // Yuva: parçanın birleşmiş haldeki merkezi, model (root) uzayında
      const home = step.part.localToWorld(b.center.clone());
      root.worldToLocal(home);
      return { step, localCenter: b.center, home, radius: b.radius };
    });

    const n = entries.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(n * 2), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n * 2), 1));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.ShaderMaterial({
        ...additive,
        uniforms: { uTime: sharedTime, uColor: { value: HOLO_CYAN.clone() } },
        vertexShader: /* glsl */ `
          attribute float aDist;
          attribute float aAlpha;
          varying float vDist;
          varying float vAlpha;
          void main() {
            vDist = aDist;
            vAlpha = aAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uColor;
          varying float vDist;
          varying float vAlpha;
          void main() {
            float dash = step(0.45, fract(vDist * 45.0 - uTime * 1.5));
            gl_FragColor = vec4(uColor, dash * vAlpha * 0.5);
          }
        `,
      }),
    );
    lines.frustumCulled = false;
    lines.raycast = () => {};

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    dotGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    const dots = new THREE.Points(
      dotGeo,
      new THREE.ShaderMaterial({
        ...additive,
        uniforms: { uMap: { value: getGlowTexture() }, uColor: { value: HOLO_CYAN.clone() } },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 9.0;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            gl_FragColor = vec4(uColor, texture2D(uMap, gl_PointCoord).r * vAlpha);
          }
        `,
      }),
    );
    dots.frustumCulled = false;
    dots.raycast = () => {};

    tethers = { lines, dots, root };
    group.add(lines, dots);
  }

  function detach() {
    if (!tethers) return;
    group.remove(tethers.lines, tethers.dots);
    tethers.lines.geometry.dispose();
    tethers.lines.material.dispose();
    tethers.dots.geometry.dispose();
    tethers.dots.material.dispose();
    tethers = null;
    entries = [];
  }

  const cur = new THREE.Vector3();
  const home = new THREE.Vector3();

  function update(dt, visibility = 1) {
    for (const p of pulses) {
      if (!p.visible) continue;
      p.userData.t += dt / 0.45;
      const t = Math.min(1, p.userData.t);
      p.scale.setScalar(p.userData.size * (0.5 + t * 0.9));
      p.quaternion.copy(camera.quaternion);
      p.material.uniforms.uT.value = t;
      if (t >= 1) p.visible = false;
    }

    if (!tethers) return;
    const pos = tethers.lines.geometry.attributes.position;
    const dist = tethers.lines.geometry.attributes.aDist;
    const alpha = tethers.lines.geometry.attributes.aAlpha;
    const dotPos = tethers.dots.geometry.attributes.position;
    const dotAlpha = tethers.dots.geometry.attributes.aAlpha;

    entries.forEach((e, i) => {
      const s = e.step.locked ? 0.5 : e.step.s;
      const away = 1 - s;
      cur.copy(e.localCenter);
      e.step.part.localToWorld(cur);
      home.copy(e.home);
      tethers.root.localToWorld(home);
      const len = cur.distanceTo(home);
      // Yerine çok yakınsa çizgi görünmesin
      const a = len < 0.01 || s >= 0.999 ? 0 : Math.min(1, away * 3) * visibility;
      pos.setXYZ(i * 2, cur.x, cur.y, cur.z);
      pos.setXYZ(i * 2 + 1, home.x, home.y, home.z);
      dist.setX(i * 2, len);
      dist.setX(i * 2 + 1, 0);
      alpha.setX(i * 2, a * 0.4);
      alpha.setX(i * 2 + 1, a);
      dotPos.setXYZ(i, home.x, home.y, home.z);
      dotAlpha.setX(i, a * 0.8);
    });
    pos.needsUpdate = true;
    dist.needsUpdate = true;
    alpha.needsUpdate = true;
    dotPos.needsUpdate = true;
    dotAlpha.needsUpdate = true;
  }

  // Parça yerine oturunca: o noktada dalga
  function onSeated(step) {
    const e = entries.find((x) => x.step === step);
    if (!e) return;
    cur.copy(e.localCenter);
    step.part.localToWorld(cur);
    pulseAt(cur, Math.min(0.18, e.radius * 1.4));
  }

  return { attach, detach, update, onSeated, group };
}
