import * as THREE from 'three';
import { HOLO_CYAN, sharedTime, sharedScan, getGlowTexture } from './hologramMaterial.js';

// Atölye ortamı: arka plan kubbesi, teknik çizim zemini, projektör diski, ışık konisi,
// havada süzülen toz, modelin etrafındaki jiroskop halkaları ve periyodik tarama ışını.
// Hepsi tek tek çok ucuz shader'lar; kalite seviyesine göre toz sayısı değişir.

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const basicVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// --- Arka plan: yukarıdan aşağı koyu lacivert geçiş ---
function createBackdrop() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 top = vec3(0.0004, 0.0012, 0.0028);
        vec3 horizon = vec3(0.0018, 0.0085, 0.014);
        vec3 bottom = vec3(0.0003, 0.0015, 0.003);
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.raycast = () => {};
  return mesh;
}

// --- Zemin: ince ve kalın çizgili ızgara, merkezden yayılan nabız halkaları ---
function createFloor() {
  const mat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: sharedTime, uColor: { value: HOLO_CYAN.clone() } },
    vertexShader: basicVertex,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vWorldPos;

      float gridLine(vec2 p, float spacing, float width) {
        vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
        vec2 w = fwidth(p) * width;
        vec2 l = 1.0 - smoothstep(vec2(0.0), w, g);
        return max(l.x, l.y);
      }

      void main() {
        vec2 p = vWorldPos.xz;
        float r = length(p);
        float minor = gridLine(p, 0.1, 1.0);
        float major = gridLine(p, 0.5, 1.4);
        float fade = exp(-r * 0.9);
        float pulse = fract(uTime * 0.12);
        float ring = exp(-pow((r - pulse * 3.5) * 9.0, 2.0)) * (1.0 - pulse);
        float a = (minor * 0.025 + major * 0.06) * fade + ring * 0.06 * fade;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.raycast = () => {};
  return mesh;
}

// --- Projektör diski: kadran halkaları, tik işaretleri, dönen tarama kanadı ---
function createProjectorDisc() {
  const mat = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uTime: sharedTime, uColor: { value: HOLO_CYAN.clone() }, uEnergy: { value: 0 } },
    vertexShader: basicVertex,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uEnergy;
      varying vec2 vUv;

      float ring(float r, float r0, float w) {
        float aa = fwidth(r);
        return 1.0 - smoothstep(w, w + aa * 1.5, abs(r - r0));
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x) / 6.2831853 + 0.5;

        float rings = ring(r, 0.16, 0.0015) * 0.6 + ring(r, 0.42, 0.001) * 0.4 + ring(r, 0.78, 0.0015) * 0.5
                    + ring(r, 0.9, 0.001) * 0.3 + ring(r, 0.97, 0.0015) * 0.4;

        // Tik işaretleri (cetvel gibi): ince ve kalın çentikler, uzaklaşınca bulanıp yığılmasın diye sönümlenir
        float fineAA = fwidth(a * 180.0);
        float fineD = abs(fract(a * 180.0 + 0.5) - 0.5);
        float fine = (1.0 - smoothstep(0.06, 0.06 + fineAA, fineD)) * step(0.8, r) * step(r, 0.84);
        fine *= 1.0 - smoothstep(0.15, 0.4, fineAA);
        float coarseAA = fwidth(a * 36.0);
        float coarseD = abs(fract(a * 36.0 + 0.5) - 0.5);
        float coarse = (1.0 - smoothstep(0.03, 0.03 + coarseAA, coarseD)) * step(0.79, r) * step(r, 0.88);
        float ticks = fine * 0.35 + coarse * 0.6;

        // Dönen kesikli halkalar
        float dashA = step(0.55, fract(a * 24.0 + uTime * 0.03)) * ring(r, 0.6, 0.003);
        float dashB = step(0.3, fract(a * 6.0 - uTime * 0.05)) * ring(r, 0.68, 0.0025);

        // Radar gibi dönen tarama kanadı
        float sweepAngle = fract(a - uTime * 0.09);
        float sweep = exp(-sweepAngle * 9.0) * step(r, 0.78) * smoothstep(0.16, 0.3, r) * 0.18;

        // Merkezdeki yayıcı
        float core = exp(-r * 16.0) * (0.55 + 0.25 * sin(uTime * 3.0)) + ring(r, 0.1 + 0.02 * sin(uTime * 2.0), 0.003) * 0.6;

        float alpha = (rings + ticks + dashA * 0.7 + dashB * 0.5 + sweep + core) * (1.0 + uEnergy * 0.6);
        alpha *= 1.0 - smoothstep(0.97, 1.0, r);
        gl_FragColor = vec4(uColor * (1.0 + core), alpha * 0.55);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.003;
  mesh.raycast = () => {};
  return mesh;
}

// --- Işık konisi: diskten yukarı açılan, kenarları parlayan hacim hissi ---
function createBeam() {
  const geo = new THREE.CylinderGeometry(0.62, 0.17, 0.85, 64, 1, true);
  geo.translate(0, 0.425, 0);
  const mat = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uTime: sharedTime, uColor: { value: HOLO_CYAN.clone() }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        vY = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying float vY;

      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.6);
        float height = vY / 0.85;
        float fade = (1.0 - smoothstep(0.0, 1.0, height)) * smoothstep(0.0, 0.05, height);
        // Yukarı akan dikey ışık çizgileri
        float col = floor(vUv.x * 90.0);
        float streak = smoothstep(0.6, 1.0, hash(col)) * (0.5 + 0.5 * sin(height * 14.0 - uTime * 2.0 + hash(col + 7.0) * 6.28));
        float a = (edge * 0.05 + streak * 0.025 + 0.005) * fade * uStrength;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  return mesh;
}

// --- Toz: GPU'da hareket eden noktalar (CPU güncellemesi yok) ---
function createDust(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 0.15 + Math.sqrt(Math.random()) * 1.1;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.random() * 1.3;
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: {
      uTime: sharedTime,
      uColor: { value: HOLO_CYAN.clone() },
      uMap: { value: getGlowTexture() },
      uScale: { value: window.innerHeight * 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.015 + aSeed * 0.03), 1.3);
        float ang = uTime * 0.05 * (0.5 + aSeed);
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.006 + aSeed * 0.008) * uScale / -mv.z;
        vAlpha = (0.25 + 0.75 * sin(uTime * (0.6 + aSeed) + aSeed * 40.0) * 0.5 + 0.5) * smoothstep(1.3, 0.9, p.y) * smoothstep(0.0, 0.15, p.y);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        float m = texture2D(uMap, gl_PointCoord).r;
        gl_FragColor = vec4(uColor, m * vAlpha * 0.35);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.raycast = () => {};
  return points;
}

// --- Jiroskop halkaları: modelin etrafında farklı eksenlerde dönen, tik işaretli ince halkalar ---
function createGyroRing(radius, segments, ticks, gap) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const t = i / segments;
    if (t > 1 - gap) continue; // halkada boşluk: kesik görünüm
    pts.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius, Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
  }
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2 * (1 - gap);
    const len = i % 5 === 0 ? 0.035 : 0.015;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * (radius - len), 0, Math.sin(a) * (radius - len));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: HOLO_CYAN, opacity: 0.22, ...additive });
  const lines = new THREE.LineSegments(geo, mat);
  lines.raycast = () => {};
  return lines;
}

// --- Tarama ışını halkası: modelin içinden aşağıdan yukarı geçen parlak düzlem ---
function createScanRing() {
  const mat = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: HOLO_CYAN.clone() }, uAlpha: { value: 0 } },
    vertexShader: basicVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float rim = exp(-pow((r - 0.97) * 140.0, 2.0));
        float fill = (1.0 - smoothstep(0.2, 0.98, r)) * 0.03;
        gl_FragColor = vec4(uColor, (rim * 0.8 + fill) * uAlpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.raycast = () => {};
  return mesh;
}

export function createEnvironment(scene, tierSettings) {
  const group = new THREE.Group();
  scene.add(group);

  group.add(createBackdrop(), createFloor());
  const disc = createProjectorDisc();
  const beam = createBeam();
  group.add(disc, beam);

  let dust = null;
  function setDust(count) {
    if (dust) {
      group.remove(dust);
      dust.geometry.dispose();
      dust.material.dispose();
      dust = null;
    }
    if (count > 0) {
      dust = createDust(count);
      group.add(dust);
    }
  }
  setDust(tierSettings.dust);

  // Jiroskop halkaları modelin merkezinde, modelin boyutuna göre ölçeklenir
  const gyro = new THREE.Group();
  const rings = [
    { mesh: createGyroRing(1, 180, 72, 0.12), axis: new THREE.Vector3(0.3, 1, 0.1).normalize(), speed: 0.12, tilt: [0.35, 0, 0.2] },
    { mesh: createGyroRing(1.08, 160, 40, 0.3), axis: new THREE.Vector3(1, 0.2, 0).normalize(), speed: -0.08, tilt: [1.2, 0.4, 0] },
    { mesh: createGyroRing(1.16, 200, 120, 0.05), axis: new THREE.Vector3(0, 1, 0), speed: 0.05, tilt: [-0.2, 0, -0.35] },
  ];
  for (const r of rings) {
    r.pivot = new THREE.Group();
    r.pivot.rotation.set(...r.tilt);
    r.pivot.add(r.mesh);
    gyro.add(r.pivot);
  }
  group.add(gyro);

  const scanRing = createScanRing();
  group.add(scanRing);

  const bounds = { center: new THREE.Vector3(0, 0.28, 0), radius: 0.5, minY: 0, maxY: 0.6 };
  let energy = 0;
  let scanTimer = 2;
  let scanT = -1;
  let gyroVisible = 1;
  let gyroTarget = 1;

  return {
    group,
    // Model kutusunu bildir: halkalar, tarama ve koni buna göre ayarlanır
    setModelBounds(box) {
      if (box.isEmpty()) return;
      box.getCenter(bounds.center);
      const size = box.getSize(new THREE.Vector3());
      bounds.radius = Math.max(0.15, Math.hypot(size.x, size.z) / 2);
      bounds.minY = box.min.y;
      bounds.maxY = box.max.y;
    },
    // Hareket olduğunda halkalar hızlanır, disk parlar (0..1)
    setEnergy(e) {
      energy = Math.max(energy, e);
    },
    setGyroVisible(v) {
      gyroTarget = v ? 1 : 0;
    },
    setTier(settings) {
      setDust(settings.dust);
    },
    // Hemen bir tarama başlat (model açılınca)
    triggerScan() {
      scanT = 0;
    },
    update(dt) {
      energy = Math.max(0, energy - dt * 1.5);
      disc.material.uniforms.uEnergy.value = energy;

      gyroVisible = THREE.MathUtils.damp(gyroVisible, gyroTarget, 4, dt);
      gyro.visible = gyroVisible > 0.02;
      const r = THREE.MathUtils.damp(gyro.scale.x, bounds.radius * 1.15, 3, dt);
      gyro.scale.setScalar(r);
      gyro.position.lerp(bounds.center, 1 - Math.exp(-3 * dt));
      for (const ring of rings) {
        ring.mesh.rotateOnAxis(ring.axis, ring.speed * dt * (1 + energy * 6));
        ring.mesh.material.opacity = (0.1 + energy * 0.15) * gyroVisible;
      }

      // Periyodik tarama: 8 saniyede bir modelin altından üstüne 1.6 saniyede geçer
      if (scanT < 0) {
        scanTimer -= dt;
        if (scanTimer <= 0) {
          scanT = 0;
          scanTimer = 8;
        }
      }
      if (scanT >= 0) {
        scanT += dt / 1.6;
        const y = THREE.MathUtils.lerp(bounds.minY - 0.05, bounds.maxY + 0.05, scanT);
        sharedScan.value = y;
        scanRing.position.set(bounds.center.x, y, bounds.center.z);
        scanRing.scale.setScalar(Math.min(1.3, bounds.radius * 2.1));
        scanRing.material.uniforms.uAlpha.value = Math.sin(Math.PI * Math.min(1, scanT)) * 0.5;
        if (scanT >= 1) {
          scanT = -1;
          sharedScan.value = -100;
          scanRing.material.uniforms.uAlpha.value = 0;
        }
      }
    },
  };
}
