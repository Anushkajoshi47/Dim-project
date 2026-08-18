/**
 * Anomaly manager.
 *
 * Owns the single active fault at any moment. Anomalies either arrive
 * spontaneously (low probability per routing tick) or are commanded from the
 * dashboard, and they always clear themselves after a bounded duration — the
 * demo needs to show the system degrading *and recovering*, not just breaking.
 *
 * Every other engine reads the same `ActiveAnomaly`, which is what makes a
 * single fault visibly propagate: LINK_DEGRADATION drops 13 dB out of the radio
 * link budget, which collapses the direct-downlink margin, which is what the
 * routing scorer then reacts to.
 */

import { config } from '../config';
import type { ActiveAnomaly, AnomalyKind, EventDto, Severity } from '../types';
import { SimClock } from './clock';
import { nextId, randRange } from './noise';

interface AnomalySpec {
  label: string;
  severity: Severity;
  description: string;
  /** Relative likelihood when an anomaly spawns spontaneously. */
  weight: number;
}

export const ANOMALY_SPECS: Record<AnomalyKind, AnomalySpec> = {
  LINK_DEGRADATION: {
    label: 'UHF downlink degradation',
    severity: 'WARN',
    description:
      "SomaiyaSat's UHF power amplifier is down ~13 dB — suspected partial antenna deployment. The S-band crosslink and SomaiyaPod's own downlink are unaffected, so the relay path stays available.",
    weight: 34,
  },
  PACKET_LOSS_SPIKE: {
    label: 'Packet loss spike',
    severity: 'WARN',
    description: 'Frame error rate spiking on the downlink; AX.25 retransmissions climbing.',
    weight: 28,
  },
  BATTERY_DIP: {
    label: 'EPS load transient',
    severity: 'WARN',
    description: 'Unexpected 1.9 W parasitic load on the unregulated bus, draining the pack.',
    weight: 20,
  },
  THERMAL_EXCURSION: {
    label: 'RF thermal excursion',
    severity: 'WARN',
    description: 'Power-amplifier heatsink running hot — PA duty cycle above thermal design point.',
    weight: 12,
  },
  OBC_RESET: {
    label: 'OBC watchdog reset',
    severity: 'CRITICAL',
    description: 'On-board computer watchdog tripped; flight software restarted from safe image.',
    weight: 6,
  },
};

export class AnomalyManager {
  private current: ActiveAnomaly | null = null;
  /** Sim time before which no spontaneous anomaly may start. */
  private quietUntil: number;

  constructor(
    private clock: SimClock,
    private emit: (e: EventDto) => void,
    private onObcReset: (reason: string) => void,
  ) {
    // Let the mission settle for two simulated minutes before the first fault.
    this.quietUntil = clock.now() + 120_000;
  }

  get active(): ActiveAnomaly | null {
    return this.current;
  }

  /** Called once per routing tick; may start or expire an anomaly. */
  tick(): ActiveAnomaly | null {
    const now = this.clock.now();

    if (this.current && now >= this.current.endsAt) {
      const finished = this.current;
      this.current = null;
      this.quietUntil = now + 60_000;
      this.emit({
        id: nextId('evt'),
        simTime: now,
        severity: 'SUCCESS',
        source: 'SYSTEM',
        message: `${finished.label} cleared — subsystem back within nominal limits`,
        data: { kind: finished.kind },
      });
      return null;
    }

    if (!this.current && now > this.quietUntil && Math.random() < config.anomaly.spontaneousChance) {
      return this.trigger(this.pickWeighted());
    }

    return this.current;
  }

  private pickWeighted(): AnomalyKind {
    const kinds = Object.keys(ANOMALY_SPECS) as AnomalyKind[];
    const total = kinds.reduce((a, k) => a + ANOMALY_SPECS[k].weight, 0);
    let roll = Math.random() * total;
    for (const k of kinds) {
      roll -= ANOMALY_SPECS[k].weight;
      if (roll <= 0) return k;
    }
    return 'LINK_DEGRADATION';
  }

  /** Start an anomaly now. Replaces any anomaly already running. */
  trigger(kind: AnomalyKind, durationSec?: number): ActiveAnomaly {
    const spec = ANOMALY_SPECS[kind];
    const now = this.clock.now();
    const duration =
      durationSec ?? randRange(config.anomaly.minDurationSec, config.anomaly.maxDurationSec);

    this.current = {
      kind,
      label: spec.label,
      startedAt: now,
      endsAt: now + duration * 1000,
      severity: spec.severity,
      description: spec.description,
    };

    this.emit({
      id: nextId('evt'),
      simTime: now,
      severity: spec.severity,
      source: 'SYSTEM',
      message: `ANOMALY — ${spec.label}: ${spec.description}`,
      data: { kind, durationSec: Math.round(duration) },
    });

    if (kind === 'OBC_RESET') this.onObcReset('WATCHDOG TIMEOUT');

    return this.current;
  }

  clear(): ActiveAnomaly | null {
    if (!this.current) return null;
    const finished = this.current;
    this.current = null;
    this.quietUntil = this.clock.now() + 60_000;
    this.emit({
      id: nextId('evt'),
      simTime: this.clock.now(),
      severity: 'SUCCESS',
      source: 'COMMAND',
      message: `${finished.label} cleared by ground command`,
      data: { kind: finished.kind },
    });
    return null;
  }

  reset(): void {
    this.current = null;
    this.quietUntil = this.clock.now() + 120_000;
  }
}