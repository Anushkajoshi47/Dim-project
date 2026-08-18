import { config } from '../config';
import type { ClockState } from '../types';

/**
 * Simulation clock.
 *
 * Every engine reads time from here rather than from `Date.now()`, so a single
 * speed multiplier accelerates the whole simulation coherently and timestamps
 * stay internally consistent. Changing the speed re-anchors the clock so sim
 * time never jumps backwards.
 */
export class SimClock {
  readonly epoch: number;
  private speed: number;
  /** Wall-clock instant of the last speed change. */
  private anchorWall: number;
  /** Sim-clock instant of the last speed change. */
  private anchorSim: number;

  constructor(epoch = config.epoch, speed = config.speed) {
    this.epoch = epoch;
    this.speed = speed;
    this.anchorWall = Date.now();
    this.anchorSim = epoch;
  }

  now(): number {
    return this.anchorSim + (Date.now() - this.anchorWall) * this.speed;
  }

  getSpeed(): number {
    return this.speed;
  }

  setSpeed(speed: number): number {
    const clamped = Math.min(240, Math.max(0.25, speed));
    // Re-anchor before switching rate so elapsed sim time is preserved.
    this.anchorSim = this.now();
    this.anchorWall = Date.now();
    this.speed = clamped;
    return clamped;
  }

  /**
   * Jump the simulation clock forward by `ms` of simulated time.
   *
   * Used by the SKIP_TO_AOS control. Sim time only ever moves forward, so every
   * timestamp downstream stays monotonic and internally consistent; the engines
   * see it as one large elapsed step and integrate through it.
   */
  advance(ms: number): void {
    if (ms <= 0) return;
    this.anchorSim = this.now() + ms;
    this.anchorWall = Date.now();
  }

  /** Simulated seconds since the mission epoch. */
  missionElapsed(): number {
    return (this.now() - this.epoch) / 1000;
  }

  reset(): void {
    this.anchorSim = this.epoch;
    this.anchorWall = Date.now();
  }

  state(): ClockState {
    const simTime = this.now();
    return {
      simTime,
      wallTime: Date.now(),
      speed: this.speed,
      missionElapsed: (simTime - this.epoch) / 1000,
    };
  }
}
