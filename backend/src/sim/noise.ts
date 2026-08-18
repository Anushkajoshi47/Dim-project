/**
 * Small numeric helpers shared by the simulation engines.
 *
 * The data-realism rule "never a frozen value, never a straight line" is
 * implemented mostly through `OrnsteinUhlenbeck`: band-limited noise that
 * wanders slowly around a mean instead of jittering white-noise style, which is
 * what real analogue sensor telemetry actually looks like.
 */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const round = (v: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Box–Muller standard normal. */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const randRange = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Ornstein–Uhlenbeck process — mean-reverting correlated noise.
 *
 * `theta` sets how hard it is pulled back to the mean (1/s), `sigma` the
 * volatility per sqrt(second); the stationary standard deviation is
 * `sigma / sqrt(2 * theta)`. Step with the elapsed *simulated* seconds.
 *
 * Uses the exact discretisation, not explicit Euler. That matters here: the sim
 * clock runs at up to 240x, so a 1 s wall tick can be a 240 s simulated step,
 * and an Euler update diverges as soon as `theta * dt > 2`. The exact form is
 * unconditionally stable at any step size.
 */
export class OrnsteinUhlenbeck {
  private value: number;

  constructor(
    private mean: number,
    private theta: number,
    private sigma: number,
    initial?: number,
  ) {
    this.value = initial ?? mean;
  }

  step(dt: number): number {
    const decay = Math.exp(-this.theta * Math.max(dt, 0));
    const variance = (this.sigma * this.sigma * (1 - decay * decay)) / (2 * this.theta);
    this.value = this.mean + (this.value - this.mean) * decay + Math.sqrt(variance) * gaussian();
    return this.value;
  }

  get(): number {
    return this.value;
  }

  setMean(mean: number): void {
    this.mean = mean;
  }

  nudge(delta: number): void {
    this.value += delta;
  }

  reset(value: number): void {
    this.value = value;
  }
}

/**
 * First-order lag toward a target — used for temperatures and any other channel
 * that must never step discontinuously.
 *
 * `tau` is the time constant in simulated seconds.
 */
export class LagFilter {
  constructor(
    private value: number,
    private tau: number,
  ) {}

  step(target: number, dt: number): number {
    const alpha = 1 - Math.exp(-dt / Math.max(this.tau, 1e-3));
    this.value += (target - this.value) * alpha;
    return this.value;
  }

  get(): number {
    return this.value;
  }

  reset(value: number): void {
    this.value = value;
  }
}

/** Exponentially weighted moving average with a half-life in seconds. */
export class Ewma {
  constructor(
    private value: number,
    private halfLife: number,
  ) {}

  push(sample: number, dt: number): number {
    const alpha = 1 - Math.pow(0.5, dt / Math.max(this.halfLife, 1e-3));
    this.value += (sample - this.value) * alpha;
    return this.value;
  }

  get(): number {
    return this.value;
  }
}

let idCounter = 0;
/** Monotonic, collision-free id for events/packets/decisions. */
export function nextId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
