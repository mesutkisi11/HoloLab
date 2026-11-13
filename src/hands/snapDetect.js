// Parmak şıklatma: başparmak ile orta parmak ucu birbirine bastırılır (işaret parmağı ayrı),
// sonra çok kısa sürede ayrılır ve orta parmak avuca çarpıp bükülür.

const TOUCH = 0.34; // başparmak-orta ucu arası (el boyu oranı): bunun altı = bastırıyor
const INDEX_AWAY = 0.38; // işaret parmağı başparmaktan bu kadar uzak olmalı (pinch ile karışmasın)
const RELEASE = 0.55; // şıklatma sonrası başparmak-orta arası en az
const WINDOW = 0.3; // bırakma bu sürede tamamlanmalı
const COOLDOWN = 0.45;

export function createSnapDetector() {
  let lastTouch = null;
  let lastSnap = -10;

  function update(h, time) {
    if (lastTouch !== null && time - lastTouch > WINDOW) lastTouch = null;
    if (!h) return false;
    if (!h.isFist && h.middleDist < TOUCH && h.pinchDist > INDEX_AWAY) {
      lastTouch = time;
      return false;
    }
    if (lastTouch === null || time - lastSnap < COOLDOWN) return false;
    // Orta parmak bükülmüş ve başparmaktan ayrılmışsa: şıklatma
    if (h.middleDist > RELEASE && !h.fingersUp[1]) {
      lastTouch = null;
      lastSnap = time;
      return true;
    }
    return false;
  }

  return { update, reset: () => (lastTouch = null) };
}
