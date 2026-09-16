import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SimClock } from '../../src/sim/clock';

const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimClock', () => {
  it('starts at the epoch', () => {
    const clock = new SimClock(EPOCH, 1);
    expect(clock.now()).toBe(EPOCH);
    expect(clock.missionElapsed()).toBe(0);
  });

  it('advances one-for-one at 1x speed', () => {
    const clock = new SimClock(EPOCH, 1);
    vi.advanceTimersByTime(10_000);
    expect(clock.now()).toBe(EPOCH + 10_000);
    expect(clock.missionElapsed()).toBe(10);
  });

  it('advances 30x sim time per wall second at 30x speed', () => {
    const clock = new SimClock(EPOCH, 30);
    vi.advanceTimersByTime(1_000);
    expect(clock.now()).toBe(EPOCH + 30_000);
  });

  it('clamps speed to the documented 0.25x–240x band', () => {
    const clock = new SimClock(EPOCH, 1);
    expect(clock.setSpeed(1000)).toBe(240);
    expect(clock.setSpeed(0.001)).toBe(0.25);
    expect(clock.setSpeed(60)).toBe(60);
    expect(clock.getSpeed()).toBe(60);
  });

  it('never moves sim time backwards across a speed change', () => {
    const clock = new SimClock(EPOCH, 240);
    vi.advanceTimersByTime(5_000);          // 1 200 000 ms of sim time
    const before = clock.now();

    clock.setSpeed(1);                       // drastic slowdown
    const after = clock.now();

    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBe(before);              // re-anchored, not recomputed
  });

  it('preserves elapsed sim time across repeated speed changes', () => {
    const clock = new SimClock(EPOCH, 1);
    vi.advanceTimersByTime(1_000);           // +1 000
    clock.setSpeed(10);
    vi.advanceTimersByTime(1_000);           // +10 000
    clock.setSpeed(0.5);
    vi.advanceTimersByTime(2_000);           // +1 000
    expect(clock.now()).toBe(EPOCH + 12_000);
  });

  it('advance() jumps forward by the requested simulated milliseconds', () => {
    const clock = new SimClock(EPOCH, 1);
    clock.advance(60_000);
    expect(clock.now()).toBe(EPOCH + 60_000);
  });

  it('advance() ignores zero and negative jumps', () => {
    const clock = new SimClock(EPOCH, 1);
    clock.advance(0);
    clock.advance(-50_000);
    expect(clock.now()).toBe(EPOCH);
  });

  it('reset() returns to the epoch', () => {
    const clock = new SimClock(EPOCH, 30);
    vi.advanceTimersByTime(10_000);
    clock.reset();
    expect(clock.now()).toBe(EPOCH);
  });

  it('state() reports a coherent ClockState', () => {
    const clock = new SimClock(EPOCH, 30);
    vi.advanceTimersByTime(2_000);
    const s = clock.state();

    expect(s.simTime).toBe(EPOCH + 60_000);
    expect(s.wallTime).toBe(EPOCH + 2_000);
    expect(s.speed).toBe(30);
    expect(s.missionElapsed).toBe(60);
  });
});
