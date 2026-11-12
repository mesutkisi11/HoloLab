// One Euro filtresi: titreyen sinyali yumuşatır ama hızlı hareketlerde gecikme yapmaz.
// Yavaşken çok yumuşatır (titreme yok), hızlıyken az yumuşatır (takip hızlı).

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, t) {
    if (this.lastT === null) {
      this.lastT = t;
      this.lastX = value;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;

    const rawD = (value - this.lastX) / dt;
    this.lastX = value;
    const d = this.dx.filter(rawD, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(d);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }
}

// Bir 3B nokta için üç filtre
export class PointFilter {
  constructor(opts) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
    this.fz = new OneEuroFilter(opts);
  }
  filter(p, t) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t), z: this.fz.filter(p.z, t) };
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
