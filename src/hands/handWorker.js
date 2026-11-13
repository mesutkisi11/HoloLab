import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// El algılama işçisi (Web Worker). Ana iş parçacığından ayrı çalışır; böylece
// her karede 15-40 ms süren el algılama, 3D sahnenin akıcılığını bozmaz.
// Ana taraf kameradan aldığı kareyi ImageBitmap olarak gönderir, işçi sonucu geri yollar.

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarker = null;
let lastTs = 0;

async function create(delegate) {
  // useModule=true: WASM yükleyicinin ES modül sürümü (modül işçide importScripts çalışmaz)
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL, true);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      landmarker = await create('GPU');
      self.postMessage({ type: 'ready', delegate: 'GPU' });
    } catch (gpuError) {
      try {
        landmarker = await create('CPU');
        self.postMessage({ type: 'ready', delegate: 'CPU', note: String(gpuError) });
      } catch (cpuError) {
        self.postMessage({ type: 'error', message: String(cpuError) });
      }
    }
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap } = msg;
    if (!landmarker) {
      bitmap.close();
      self.postMessage({ type: 'result', seq: msg.seq, ts: msg.ts, landmarks: [], handedness: [], ms: 0 });
      return;
    }
    // VIDEO modunda zaman damgaları kesin artan olmalı
    const ts = Math.max(msg.ts, lastTs + 1);
    lastTs = ts;
    const t0 = performance.now();
    let result = null;
    try {
      result = landmarker.detectForVideo(bitmap, ts);
    } catch (err) {
      self.postMessage({ type: 'warn', message: String(err) });
    }
    bitmap.close();
    self.postMessage({
      type: 'result',
      seq: msg.seq,
      ts: msg.ts,
      landmarks: result?.landmarks ?? [],
      handedness: (result?.handednesses ?? result?.handedness ?? []).map((h) => h[0]?.categoryName ?? null),
      ms: performance.now() - t0,
    });
  }
};
