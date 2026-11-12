import * as THREE from 'three';
import { evalStep } from '../choreo/motions.js';
import { easeOutCubic, clamp01, smoothstep } from '../choreo/easing.js';

// Tek parçayı tutup çekme. El ve fare aynı modülü kullanır.
// Tutulan parça önce takılma ekseni boyunca çıkar, sonra eli serbestçe takip eder.
// Bırakınca: yakınsa kendi takılma hareketiyle oturur, uzaksa sökülmüş konumuna süzülür,
// hızlı savrulduysa o yöne kayıp havada asılı kalır.

const SNAP_PULL_RATIO = 1.6; // insert mesafesinin bu katından yakınsa yerine oturur
const THROW_SPEED = 1.2; // dünya birimi/sn üstü = fırlatma

// deps.choreo ve deps.root model değişince güncellenir; bu yüzden her kullanımda deps üzerinden okunur
export function createPartGrab(deps) {
  const { camera } = deps;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let grab = null; // aktif tutma
  const tweens = []; // bırakma sonrası animasyonlar

  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const parentPos = new THREE.Vector3();
  const axisW = new THREE.Vector3();
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  // Ekran noktasından (NDC) ışın atıp hangi parçaya değdiğini bulur
  function hoverAt(x, y) {
    if (!deps.root) return null;
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(deps.root, true).find((h) => h.object.isMesh);
    return hit ? hit.object.userData.partId : null;
  }

  function begin(partId, handWorld) {
    const step = deps.choreo?.getStep(partId);
    if (!step || grab) return false;
    cancelTween(partId);
    step.locked = true;

    const part = step.part;
    part.parent.getWorldQuaternion(parentQ);
    axisW.copy(step.axis).applyQuaternion(parentQ).normalize();

    grab = {
      step,
      part,
      start: handWorld.clone(),
      startPos: part.position.clone(),
      startQuat: part.quaternion.clone(),
      pull: 0,
      // Zaten sökülmüş/havada parça serbest taşınır; yerindeki parça önce eksen boyunca çıkar
      fromHome: step.s >= 0.999 && !step.float,
      last: handWorld.clone(),
      velocity: new THREE.Vector3(),
    };
    return true;
  }

  function move(handWorld, dt) {
    if (!grab) return;
    const { step, part } = grab;
    grab.velocity.subVectors(handWorld, grab.last).divideScalar(Math.max(dt, 1e-3));
    grab.last.copy(handWorld);

    tmpV.subVectors(handWorld, grab.start); // dünya uzayında el yer değiştirmesi
    part.parent.getWorldQuaternion(parentQ);
    const toLocal = tmpQ.copy(parentQ).invert();

    if (grab.fromHome) {
      // Eksen boyunca çekme miktarı (eksen "takılma" yönü, çıkış yönü tersi)
      const pull = Math.max(0, -tmpV.dot(axisW));
      grab.pull = pull;
      const insert = Math.max(step.insert, 0.02);

      // Dik bileşen, parça ekseni terk ettikçe yavaşça devreye girer
      const perpWeight = smoothstep(insert, insert * 2, pull);
      const perp = tmpV.clone().addScaledVector(axisW, -tmpV.dot(axisW)).applyQuaternion(toLocal);

      part.position
        .copy(step.home.position)
        .addScaledVector(step.axis, -pull)
        .addScaledVector(perp, perpWeight);

      // Vida: çekerken kendi ekseninde döner
      part.quaternion.copy(step.home.quaternion);
      if (step.screwTurns) {
        tmpQ.setFromAxisAngle(step.axis, step.screwTurns * Math.PI * 2 * clamp01(pull / insert));
        part.quaternion.premultiply(tmpQ);
      }
    } else {
      part.position.copy(grab.startPos).add(tmpV.clone().applyQuaternion(toLocal));
    }
  }

  function end() {
    if (!grab) return null;
    const { step, part } = grab;
    const velocity = grab.velocity.clone();
    const speed = velocity.length();
    grab = null;

    // Yerine ne kadar yakın?
    const insert = Math.max(step.insert, 0.02);
    const distToHome = part.position.distanceTo(step.home.position);
    const near = distToHome < insert * SNAP_PULL_RATIO + 0.03;

    if (speed > THROW_SPEED && !near) {
      startThrow(step, velocity);
      return 'throw';
    }
    if (near) {
      startSnap(step, distToHome / insert);
      return 'snap';
    }
    startDrift(step);
    return 'drift';
  }

  // Yerine oturma: kendi adımının takılma hareketini s0 -> 1 oynat
  function startSnap(step, pullRatio) {
    const s0 = 1 - step.insertFraction * clamp01(pullRatio) * 0.9;
    tweens.push({
      kind: 'snap',
      step,
      t: 0,
      duration: 0.45,
      from: { position: step.part.position.clone(), quaternion: step.part.quaternion.clone() },
      s0,
    });
  }

  // Sökülmüş konumuna süzülme
  function startDrift(step) {
    evalStep(step, 0, pose);
    tweens.push({
      kind: 'drift',
      step,
      t: 0,
      duration: 0.6,
      from: { position: step.part.position.clone(), quaternion: step.part.quaternion.clone() },
      to: { position: pose.position.clone(), quaternion: pose.quaternion.clone() },
    });
  }

  // Fırlatma: hız yönünde kayıp durur
  function startThrow(step, velocityWorld) {
    step.part.parent.getWorldQuaternion(parentQ);
    const vLocal = velocityWorld.clone().applyQuaternion(parentQ.clone().invert());
    tweens.push({
      kind: 'throw',
      step,
      t: 0,
      duration: 0.5,
      from: { position: step.part.position.clone(), quaternion: step.part.quaternion.clone() },
      to: {
        position: step.part.position.clone().addScaledVector(vLocal, 0.22),
        quaternion: step.part.quaternion.clone(),
      },
    });
  }

  function cancelTween(partId) {
    const i = tweens.findIndex((tw) => tw.step.id === partId);
    if (i >= 0) tweens.splice(i, 1);
  }

  function update(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = clamp01(tw.t / tw.duration);
      const part = tw.step.part;

      if (tw.kind === 'snap') {
        evalStep(tw.step, tw.s0 + (1 - tw.s0) * k, pose);
        // İlk anlarda mevcut pozdan koreografi pozuna yumuşak geçiş
        const blend = easeOutCubic(clamp01(k * 3));
        part.position.copy(tw.from.position).lerp(pose.position, blend);
        part.quaternion.copy(tw.from.quaternion).slerp(pose.quaternion, blend);
      } else {
        const e = easeOutCubic(k);
        part.position.copy(tw.from.position).lerp(tw.to.position, e);
        part.quaternion.copy(tw.from.quaternion).slerp(tw.to.quaternion, e);
      }

      if (k >= 1) {
        tweens.splice(i, 1);
        if (tw.kind === 'snap') deps.choreo.markSeated(tw.step.id);
        else if (tw.kind === 'drift') {
          tw.step.offset = -1;
          tw.step.float = null;
          tw.step.locked = false;
        } else {
          tw.step.float = { position: tw.to.position.clone(), quaternion: tw.to.quaternion.clone() };
          tw.step.offset = -1;
          tw.step.locked = false;
        }
      }
    }
  }

  // Kameradan parçaya olan uzaklık: eli parçanın derinliğine yerleştirmek için
  function depthOf(partId) {
    const step = deps.choreo?.getStep(partId);
    if (!step) return 1;
    step.part.getWorldPosition(parentPos);
    return parentPos.distanceTo(camera.position);
  }

  return {
    hoverAt,
    begin,
    move,
    end,
    update,
    depthOf,
    isGrabbing: () => !!grab,
    grabbedId: () => grab?.step.id ?? null,
  };
}
