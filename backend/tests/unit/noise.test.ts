import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clamp, lerp, round, gaussian, randRange,
  OrnsteinUhlenbeck, LagFilter, Ewma, nextId,
} from '../../src/sim/noise';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clamp', () => {
  it('passes through a value inside the band', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to the lower bound', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps to the upper bound', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('handles the boundaries themselves (boundary value analysis)', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
  });

  it('returns the midpoint at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('round', () => {
  it('defaults to 2 decimal places', () => {
    expect(round(1.23456)).toBe(1.23);
  });

  it('honours an explicit precision', () => {
    expect(round(1.23456, 4)).toBe(1.2346);
    expect(round(1.5, 0)).toBe(2);
  });
});

describe('gaussian', () => {
  
  it('produces a standard normal distribution', () => {
    const n = 20_000;
    const samples = Array.from({ length: n }, () => gaussian());

    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

    expect(mean).toBeCloseTo(0, 1);          // within ±0.05
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });

  it('never returns NaN or Infinity', () => {
    for (let i = 0; i < 5000; i++) {
      expect(Number.isFinite(gaussian())).toBe(true);
    }
  });
});

describe('randRange', () => {
  it('stays inside the requested band', () => {
    for (let i = 0; i < 1000; i++) {
      const v = randRange(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('returns the low bound when Math.random is pinned to 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randRange(10, 20)).toBe(10);
  });
});

describe('OrnsteinUhlenbeck', () => {
  it('starts at the mean when no initial value is given', () => {
    expect(new OrnsteinUhlenbeck(50, 0.1, 1).get()).toBe(50);
  });

  it('starts at the initial value when one is given', () => {
    expect(new OrnsteinUhlenbeck(50, 0.1, 1, 72).get()).toBe(72);
  });

  it('stays numerically stable at very large time steps', () => {
    const ou = new OrnsteinUhlenbeck(20, 0.5, 2, 20);
    for (let i = 0; i < 500; i++) {
      const v = ou.step(240);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v - 20)).toBeLessThan(30); // no runaway
    }
  });

  it('reverts toward the mean with zero volatility', () => {
    const ou = new OrnsteinUhlenbeck(0, 1.0, 0, 100);
    ou.step(10);
    expect(Math.abs(ou.get())).toBeLessThan(1);
  });

  it('setMean redirects where it reverts to', () => {
    const ou = new OrnsteinUhlenbeck(0, 1.0, 0, 0);
    ou.setMean(50);
    ou.step(20);
    expect(ou.get()).toBeCloseTo(50, 1);
  });

  it('reset forces an exact value', () => {
    const ou = new OrnsteinUhlenbeck(0, 1, 1);
    ou.reset(-7.5);
    expect(ou.get()).toBe(-7.5);
  });
});

describe('LagFilter', () => {
  it('does not move on a zero-length step', () => {
    const lag = new LagFilter(10, 5);
    expect(lag.step(100, 0)).toBe(10);
  });

  it('converges to the target over many time constants', () => {
    const lag = new LagFilter(0, 5);
    for (let i = 0; i < 100; i++) lag.step(25, 1);
    expect(lag.get()).toBeCloseTo(25, 3);
  });

  it('reaches ~63% of the step after exactly one time constant', () => {
    const lag = new LagFilter(0, 5);
    expect(lag.step(100, 5)).toBeCloseTo(63.21, 1);
  });

  it('never steps discontinuously', () => {
    const lag = new LagFilter(0, 30);
    const first = lag.step(1000, 1);
    expect(first).toBeLessThan(100); // nowhere near the target after 1 s
  });
});

describe('Ewma', () => {
  it('converges to a constant input stream', () => {
    const ewma = new Ewma(0, 10);
    for (let i = 0; i < 200; i++) ewma.push(5, 1);
    expect(ewma.get()).toBeCloseTo(5, 3);
  });

  it('moves exactly halfway in one half-life', () => {
    const ewma = new Ewma(0, 10);
    expect(ewma.push(100, 10)).toBeCloseTo(50, 6);
  });
});

describe('nextId', () => {
  it('applies the requested prefix', () => {
    expect(nextId('evt')).toMatch(/^evt-/);
  });

  it('never collides across many calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => nextId('pkt')));
    expect(ids.size).toBe(10_000);
  });
});
