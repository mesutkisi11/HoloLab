// Web kamerasını açar ve köşede aynalanmış küçük bir önizleme gösterir.
export async function startCamera() {
  const video = document.createElement('video');
  video.className = 'cam-preview';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);

  // getUserMedia: tarayıcıdan kamera izni ister. HTTPS veya localhost gerekir.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });

  return video;
}
