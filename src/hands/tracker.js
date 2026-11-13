// El takibi yöneticisi. Önce ayrı iş parçacığında (Web Worker) çalışmayı dener;
// tarayıcı desteklemiyorsa ana iş parçacığında çalışan eski yönteme döner.
// Her iki durumda da aynı arayüz: latest() -> { seq, ts, landmarks, handedness }

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createTracker(video) {
  const canWorker =
    typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
  if (canWorker && !new URLSearchParams(location.search).has('mainthread')) {
    try {
      return await createWorkerTracker(video);
    } catch (err) {
      console.warn('El takibi işçisi başlatılamadı, ana iş parçacığına dönülüyor:', err);
    }
  }
  return createMainThreadTracker(video);
}

// Yeni kamera karesi geldiği anda çağır (requestVideoFrameCallback); yoksa her ekran karesinde kontrol et
function onEachVideoFrame(video, fn) {
  if ('requestVideoFrameCallback' in video) {
    const loop = () => {
      fn();
      video.requestVideoFrameCallback(loop);
    };
    video.requestVideoFrameCallback(loop);
    return;
  }
  let lastTime = -1;
  const poll = () => {
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      fn();
    }
    requestAnimationFrame(poll);
  };
  poll();
}

async function createWorkerTracker(video) {
  const worker = new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('işçi 40 sn içinde hazır olmadı')), 40000);
    worker.onmessage = (e) => {
      if (e.data.type === 'ready') {
        clearTimeout(timer);
        resolve(e.data);
      } else if (e.data.type === 'error') {
        clearTimeout(timer);
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(e.error ?? new Error(e.message || 'işçi hatası'));
    };
    worker.postMessage({ type: 'init' });
  });

  let busy = false;
  let seq = 0;
  let latest = null;
  let inferMs = 0;

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'result') {
      busy = false;
      latest = m;
      inferMs = inferMs * 0.8 + m.ms * 0.2;
    } else if (m.type === 'warn') {
      console.warn('El takibi:', m.message);
    }
  };

  // Sadece bir kare "yolda" olabilir: işçi meşgulse yeni kare atlanır, hep en tazesi işlenir
  async function send() {
    if (busy || video.readyState < 2) return;
    busy = true;
    try {
      const bitmap = await createImageBitmap(video);
      worker.postMessage({ type: 'frame', bitmap, ts: performance.now(), seq: ++seq }, [bitmap]);
    } catch {
      busy = false;
    }
  }
  onEachVideoFrame(video, send);

  return {
    mode: 'worker',
    delegate: ready.delegate,
    latest: () => latest,
    get inferMs() {
      return inferMs;
    },
  };
}

async function createMainThreadTracker(video) {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let delegate = 'GPU';
  let landmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }

  let latest = null;
  let seq = 0;
  let inferMs = 0;
  let lastTs = 0;
  onEachVideoFrame(video, () => {
    if (video.readyState < 2) return;
    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;
    const t0 = performance.now();
    const r = landmarker.detectForVideo(video, ts);
    inferMs = inferMs * 0.8 + (performance.now() - t0) * 0.2;
    latest = {
      seq: ++seq,
      ts,
      landmarks: r.landmarks ?? [],
      handedness: (r.handednesses ?? r.handedness ?? []).map((h) => h[0]?.categoryName ?? null),
    };
  });

  return {
    mode: 'main',
    delegate,
    latest: () => latest,
    get inferMs() {
      return inferMs;
    },
  };
}
