import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// MediaPipe HandLandmarker: her karede iki ele kadar, el başına 21 nokta verir.
export async function createTracker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  let lastVideoTime = -1;
  let lastResult = null;

  return {
    // Aynı video karesini iki kez işlememek için currentTime kontrolü
    detect(video) {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return lastResult;
      lastVideoTime = video.currentTime;
      lastResult = landmarker.detectForVideo(video, performance.now());
      return lastResult;
    },
  };
}
