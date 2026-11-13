// Başparmak ile işaret parmağını kısa kısa birbirine değdirme (dokunma) algılayıcı.
// Parmaklar kapanıp kısa sürede açılırsa bir "dokunma"; iki dokunma arka arkaya gelirse "çift dokunma".

const CLOSE = 0.32; // el boyuna oranla parmak uçları arası: bunun altı = değdi
const OPEN = 0.45; // bunun üstü = ayrıldı
const MAX_HOLD = 0.45; // bundan uzun tutmak dokunma sayılmaz (sök/tak gibi)
const MAX_GAP = 0.7; // iki dokunma arası en fazla
const MAX_MOVE = 0.08; // dokunurken el bu kadar kayarsa sayılmaz

export function createPinchTap() {
  let closed = null; // { t, x, y }
  let lastTap = -10;

  function reset() {
    closed = null;
    lastTap = -10;
  }

  // Dönüş: 'tap' | 'double' | null
  function update(h, time) {
    if (!h || h.isFist) {
      closed = null;
      return null;
    }
    if (!closed) {
      if (h.pinchDist < CLOSE) closed = { t: time, x: h.palm.x, y: h.palm.y };
      return null;
    }
    if (h.pinchDist < OPEN) return null;
    const held = time - closed.t;
    const moved = Math.hypot(h.palm.x - closed.x, h.palm.y - closed.y);
    closed = null;
    if (held > MAX_HOLD || moved > MAX_MOVE) {
      lastTap = -10;
      return null;
    }
    if (time - lastTap < MAX_GAP) {
      lastTap = -10;
      return 'double';
    }
    lastTap = time;
    return 'tap';
  }

  return { update, reset };
}
