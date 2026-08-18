/**
 * Autonomous inter-satellite routing engine.
 *
 * A transparent heuristic scorer — deliberately not a black box. Each candidate
 * route (direct to ground / relay via SomaiyaPod / store-and-forward) is scored
 * against four weighted features:
 *
 *   link margin · battery headroom · queue depth · historical packet loss
 *
 * The weighted sums go through a softmax, so the winning route's probability is
 * a genuine confidence figure that falls when two routes are closely matched.
 * The per-factor contributions are kept on the wire so the dashboard can show
 * *why* a route won, and a natural-language rationale is generated from the
 * dominant factors. A hysteresis band stops the router flapping between two
 * near-equal options.
 *
 * All of the inputs are physical values coming out of the orbit, telemetry and
 * radio engines, so an anomaly that hurts the link budget visibly moves the
 * decision.
 */

import { config } from '../config';
import type {
  ActiveAnomaly,
  EventDto,
  LinkQuality,
  OrbitFrame,
  PacketEvent,
  RadioFrame,
  RouteId,
  RouteScore,
  RoutingDecisionDto,
  RoutingFrame,
  TelemetryFrame,
} from '../types';
import { SimClock } from './clock';
import { freeSpacePathLoss } from './orbit';
import { Ewma, OrnsteinUhlenbeck, clamp, gaussian, nextId, round } from './noise';

const C_KM_S = 299792.458;
const DEG = Math.PI / 180;

/** SomaiyaPod downlink and the S-band inter-satellite link. */
const POD_DOWNLINK_MHZ = 437.62;
const POD_TX_POWER_W = 0.4;
/** Ground-downlink noise bandwidth used for the pod's link budget, Hz. */
const GS_NOISE_BW_HZ = 15000;

/**
 * S-band crosslink. Sized so the link actually closes over the constellation's
 * ~1100 km along-track separation: 0.5 W into a 9 dBi patch at each end, and a
 * narrow 12 kHz noise bandwidth consistent with a 9.6 kbps crosslink — which is
 * what keeps the thermal noise floor low enough to leave usable margin.
 */
const ISL_FREQ_MHZ = 2405;
const ISL_TX_POWER_W = 0.5;
const ISL_ANTENNA_GAIN_DBI = 10;
const ISL_LINE_LOSS_DB = 0.5;
const ISL_NOISE_BW_HZ = 12000;
const REQUIRED_SNR_DB = 8;

const ROUTE_LABELS: Record<RouteId, string> = {
  DIRECT: 'Direct → Ground',
  RELAY_POD: 'Relay via SomaiyaPod',
  STORE_FORWARD: 'Store & Forward',
};

/** Feature weights. Kept here (not buried in the scorer) so they are auditable. */
const WEIGHTS = {
  linkMargin: 0.4,
  batteryHeadroom: 0.2,
  queuePressure: 0.22,
  reliability: 0.18,
};

interface RoutingInputs {
  satMarginDb: number | null;
  podMarginDb: number | null;
  islMarginDb: number | null;
  islRangeKm: number;
  islLos: boolean;
  satSoc: number;
  podSoc: number;
  queueFill: number;
  historicalLoss: number;
  timeToAosSec: number | null;
  elevation: number;
  latencyDirect: number;
  latencyRelay: number;
}

export class RoutingEngine {
  private queue = 0; // packets waiting on the downlink queue
  private saturated = false;
  private lossEwma = new Ewma(0.012, 90);
  private podSoc = new OrnsteinUhlenbeck(72, 0.02, 0.4, 74);
  /** Crosslink fading, ~0.6 dB one-sigma. */
  private islFade = new OrnsteinUhlenbeck(0, 0.2, 0.38);
  private throughput = new Ewma(0, 20);
  private currentRoute: RouteId = 'STORE_FORWARD';
  private recent: RoutingDecisionDto[] = [];
  private lastSim: number;
  private lastDecision: RoutingDecisionDto | null = null;

  constructor(
    private clock: SimClock,
    private emit: (e: EventDto) => void,
    private onDecision: (d: RoutingDecisionDto) => void,
  ) {
    this.lastSim = clock.now();
  }

  /* ------------------------------------------------------- link budgets */

  /** Margin in dB for a satellite→ground link, or null if below the horizon. */
  private groundMargin(
    elevation: number,
    rangeKm: number,
    freqMhz: number,
    txPowerW: number,
    extraLossDb: number,
  ): number | null {
    if (elevation < config.groundStation.minElevation) return null;
    const eirp = 10 * Math.log10(txPowerW * 1000) + 2.1 - 0.7;
    const fspl = freeSpacePathLoss(rangeKm, freqMhz);
    const atmospheric = 0.55 / Math.max(Math.sin(elevation * DEG), 0.09);
    const noise = -174 + 10 * Math.log10(GS_NOISE_BW_HZ) + 2.5;
    const rssi =
      eirp - fspl - atmospheric + config.groundStation.gainDbi - config.groundStation.lineLossDb - extraLossDb;
    return rssi - noise - REQUIRED_SNR_DB;
  }

  /**
   * Margin on the SomaiyaSat ⇄ SomaiyaPod S-band crosslink.
   *
   * A leader–follower formation holds a nearly constant separation, so range
   * alone would leave this margin visibly frozen. It isn't in reality: the
   * crosslink runs between two body-mounted patch antennas, so however well the
   * ADCS is pointing directly sets how much of the pattern each end sees. The
   * pointing-loss term is what makes the crosslink degrade while the spacecraft
   * is still detumbling and firm up once fine pointing is acquired.
   */
  private islMargin(
    rangeKm: number,
    los: boolean,
    pointingErrorDeg: number,
    dt: number,
  ): number | null {
    if (!los) return null;
    const eirp = 10 * Math.log10(ISL_TX_POWER_W * 1000) + ISL_ANTENNA_GAIN_DBI - ISL_LINE_LOSS_DB;
    const fspl = freeSpacePathLoss(rangeKm, ISL_FREQ_MHZ);
    const noise = -174 + 10 * Math.log10(ISL_NOISE_BW_HZ) + 3.2;
    // Patch beamwidth is wide, so a couple of degrees costs little, but a
    // tumbling bus swings the pattern well off boresight.
    const pointingLoss = Math.min(9, Math.abs(pointingErrorDeg) * 0.32);
    const rssi =
      eirp - fspl + ISL_ANTENNA_GAIN_DBI - ISL_LINE_LOSS_DB - pointingLoss + this.islFade.step(dt);
    return rssi - noise - REQUIRED_SNR_DB;
  }

  /* ------------------------------------------------------------ scoring */

  private gatherInputs(
    orbit: OrbitFrame,
    telemetry: TelemetryFrame,
    radio: RadioFrame,
    dt: number,
  ): RoutingInputs {
    const sat = orbit.satellites[0];
    const pod = orbit.satellites[1];

    // LINK_DEGRADATION is a fault on SomaiyaSat's own UHF transmitter, so it is
    // already baked into radio.linkMargin. SomaiyaPod flies a separate radio and
    // the crosslink is a different band entirely — neither is affected, which is
    // precisely why rerouting through the relay recovers the downlink.
    const satMarginDb = radio.linkMargin;
    const podMarginDb = this.groundMargin(
      pod.look.elevation,
      pod.look.range,
      POD_DOWNLINK_MHZ,
      POD_TX_POWER_W,
      0,
    );
    const islMarginDb = this.islMargin(
      orbit.interSatRange,
      orbit.interSatLos,
      telemetry.attitude.pointingError,
      dt,
    );

    // SomaiyaPod's own power state — it charges in sunlight like the primary.
    this.podSoc.setMean(pod.sunlit ? 88 : 58);
    const podSoc = clamp(this.podSoc.step(dt), 20, 99);

    const timeToAosSec =
      orbit.pass.inPass || orbit.pass.aos === null ? null : (orbit.pass.aos - this.clock.now()) / 1000;

    return {
      satMarginDb,
      podMarginDb,
      islMarginDb,
      islRangeKm: orbit.interSatRange,
      islLos: orbit.interSatLos,
      satSoc: telemetry.power.stateOfCharge,
      podSoc,
      queueFill: this.queue / config.routing.queueCapacity,
      historicalLoss: this.lossEwma.get(),
      timeToAosSec,
      elevation: sat.look.elevation,
      latencyDirect: (sat.look.range / C_KM_S) * 1000 + 42,
      latencyRelay:
        ((orbit.interSatRange + pod.look.range) / C_KM_S) * 1000 + 96,
    };
  }

  /** Squash a dB margin into 0–1: 0 dB is marginal, 15 dB is comfortable. */
  private marginScore(db: number | null): number {
    if (db === null) return 0;
    return clamp(1 / (1 + Math.exp(-(db - 4) / 4)), 0, 1);
  }

  private scoreRoutes(inp: RoutingInputs): RouteScore[] {
    const reliability = 1 - clamp(inp.historicalLoss * 6, 0, 1);
    const queuePressure = clamp(inp.queueFill, 0, 1);

    const build = (
      route: RouteId,
      feasible: boolean,
      factors: RouteScore['factors'],
      estLatency: number,
      estPacketLoss: number,
      note: string,
    ): RouteScore => ({
      route,
      label: ROUTE_LABELS[route],
      score: feasible ? clamp(factors.reduce((a, f) => a + f.contribution, 0), 0, 1) : 0,
      probability: 0,
      feasible,
      factors: factors.map((f) => ({ ...f, value: round(f.value, 3), contribution: round(f.contribution, 4) })),
      estLatency: round(estLatency, 1),
      estPacketLoss: round(clamp(estPacketLoss, 0, 1), 4),
      note,
    });

    const f = (name: string, value: number, weight: number) => ({
      name,
      value,
      weight,
      contribution: value * weight,
    });

    /* ---- direct to ground ---- */
    const directFeasible = inp.satMarginDb !== null && inp.satMarginDb > 0;
    const directMargin = this.marginScore(inp.satMarginDb);
    const direct = build(
      'DIRECT',
      directFeasible,
      [
        f('Link margin', directMargin, WEIGHTS.linkMargin),
        f('Battery headroom', clamp((inp.satSoc - 25) / 65, 0, 1), WEIGHTS.batteryHeadroom),
        // A full queue is a strong argument for dumping data now.
        f('Queue pressure', queuePressure, WEIGHTS.queuePressure),
        f('Reliability', reliability, WEIGHTS.reliability),
      ],
      inp.latencyDirect,
      directFeasible ? clamp(0.02 + Math.exp(-(inp.satMarginDb ?? 0) / 5) * 0.28, 0, 0.6) : 1,
      directFeasible
        ? `${inp.satMarginDb?.toFixed(1)} dB margin at ${inp.elevation.toFixed(0)}° elevation`
        : 'SomaiyaSat below ground-station horizon',
    );

    /* ---- relay via SomaiyaPod ---- */
    const relayFeasible =
      inp.islLos && inp.islMarginDb !== null && inp.islMarginDb > 0 && inp.podMarginDb !== null && inp.podMarginDb > 0;
    // End-to-end margin is limited by the weaker of the two hops.
    const relayEndToEnd =
      inp.islMarginDb === null || inp.podMarginDb === null
        ? null
        : Math.min(inp.islMarginDb, inp.podMarginDb);
    const relay = build(
      'RELAY_POD',
      relayFeasible,
      [
        f('Link margin', this.marginScore(relayEndToEnd), WEIGHTS.linkMargin),
        // Relaying spends SomaiyaPod's power, so its SoC gates the route.
        f('Battery headroom', clamp((Math.min(inp.satSoc, inp.podSoc) - 25) / 65, 0, 1), WEIGHTS.batteryHeadroom),
        f('Queue pressure', queuePressure * 0.85, WEIGHTS.queuePressure),
        f('Reliability', reliability * 0.92, WEIGHTS.reliability),
      ],
      inp.latencyRelay,
      relayFeasible ? clamp(0.03 + Math.exp(-(relayEndToEnd ?? 0) / 5) * 0.3, 0, 0.6) : 1,
      relayFeasible
        ? `ISL ${inp.islRangeKm.toFixed(0)} km, end-to-end ${relayEndToEnd?.toFixed(1)} dB`
        : inp.islLos
          ? 'SomaiyaPod has no ground contact'
          : 'Earth occulting the crosslink',
    );

    /* ---- store & forward ---- */
    // Always available. Attractive when there is no link, the queue is shallow,
    // or the battery is too low to justify keying the transmitter.
    const noLinkNow = !directFeasible && !relayFeasible;
    const storeLatency = inp.timeToAosSec !== null ? inp.timeToAosSec * 1000 : 300_000;
    // Always feasible by construction. A full buffer does not make the route
    // unavailable — it makes it lossy, and the overflow is accounted for when
    // the queue is advanced. Marking it infeasible would leave the router with
    // no legal option at all whenever the spacecraft is out of contact.
    const store = build(
      'STORE_FORWARD',
      true,
      [
        f('Link margin', noLinkNow ? 0.95 : 0.2, WEIGHTS.linkMargin),
        f('Battery headroom', clamp(1 - (inp.satSoc - 25) / 65, 0, 1), WEIGHTS.batteryHeadroom),
        // Inverted: an empty queue means there is nothing urgent to send.
        f('Queue pressure', 1 - queuePressure, WEIGHTS.queuePressure),
        f('Reliability', 0.99, WEIGHTS.reliability),
      ],
      storeLatency,
      0.0005,
      inp.timeToAosSec !== null
        ? `Buffering until AOS in ${Math.round(inp.timeToAosSec / 60)} min`
        : 'Buffering to non-volatile store',
    );

    /* ---- softmax over feasible routes ---- */
    const routes = [direct, relay, store];
    const temperature = 0.09;
    const exps = routes.map((r) => (r.feasible ? Math.exp(r.score / temperature) : 0));
    const total = exps.reduce((a, b) => a + b, 0) || 1;
    routes.forEach((r, i) => {
      r.probability = round(exps[i] / total, 4);
    });

    return routes;
  }

  /* -------------------------------------------------------- explanation */

  private explain(winner: RouteScore, all: RouteScore[], inp: RoutingInputs, anomaly: ActiveAnomaly | null): string {
    const runnerUp = all
      .filter((r) => r.route !== winner.route && r.feasible)
      .sort((a, b) => b.score - a.score)[0];

    const top = [...winner.factors].sort((a, b) => b.contribution - a.contribution)[0];
    const parts: string[] = [];

    if (anomaly) parts.push(`${anomaly.label} active`);

    switch (winner.route) {
      case 'DIRECT':
        parts.push(
          `direct downlink holds ${inp.satMarginDb?.toFixed(1)} dB margin at ${inp.elevation.toFixed(0)}° elevation`,
        );
        break;
      case 'RELAY_POD':
        parts.push(
          `SomaiyaSat has no usable ground link, but the ${inp.islRangeKm.toFixed(0)} km crosslink to SomaiyaPod is clear at ${inp.islMarginDb?.toFixed(1)} dB`,
        );
        break;
      case 'STORE_FORWARD':
        parts.push(
          inp.timeToAosSec !== null
            ? `no contact available, buffering ${this.queue.toFixed(0)} packets until AOS in ${Math.round(inp.timeToAosSec / 60)} min`
            : `no contact available, buffering ${this.queue.toFixed(0)} packets on the payload store`,
        );
        break;
    }

    parts.push(`dominant factor "${top.name}" (${(top.contribution * 100).toFixed(0)}% of score)`);
    parts.push(`battery ${inp.satSoc.toFixed(0)}% / queue ${(inp.queueFill * 100).toFixed(0)}%`);

    if (runnerUp) {
      parts.push(
        `next best ${runnerUp.label} at ${(runnerUp.probability * 100).toFixed(0)}% — ${runnerUp.note}`,
      );
    } else {
      parts.push('no alternative route is currently feasible');
    }

    const sentence = parts.join('; ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  }

  /* --------------------------------------------------------------- tick */

  tick(
    orbit: OrbitFrame,
    telemetry: TelemetryFrame,
    radio: RadioFrame,
    anomaly: ActiveAnomaly | null,
    force = false,
  ): RoutingFrame {
    const now = this.clock.now();
    const dt = clamp((now - this.lastSim) / 1000, 0.05, 900);
    this.lastSim = now;

    const inp = this.gatherInputs(orbit, telemetry, radio, dt);
    const candidates = this.scoreRoutes(inp);

    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    const currentScore = candidates.find((c) => c.route === this.currentRoute);

    // Hysteresis: hold the incumbent unless it is now infeasible or clearly beaten.
    const HYSTERESIS = 0.05;
    const mustSwitch = !currentScore?.feasible;
    const shouldSwitch = best.score > (currentScore?.score ?? 0) + HYSTERESIS;
    const changed = best.route !== this.currentRoute && (mustSwitch || shouldSwitch || force);
    if (changed) this.currentRoute = best.route;

    const chosen = candidates.find((c) => c.route === this.currentRoute) ?? best;

    /* -- packet flow: generate, transmit, drop -- */
    const generated = config.routing.packetRate * dt;
    const overflow = Math.max(0, this.queue + generated - config.routing.queueCapacity);
    this.queue = clamp(this.queue + generated, 0, config.routing.queueCapacity);
    // Log the onset of saturation once, not on every tick while it persists.
    if (overflow > 0 && !this.saturated) {
      this.saturated = true;
      this.emit({
        id: nextId('evt'),
        simTime: now,
        severity: 'WARN',
        source: 'ROUTING',
        message: `Payload buffer saturated at ${config.routing.queueCapacity} packets — ${Math.round(overflow)} frames dropped before next contact`,
        data: { overflow: Math.round(overflow) },
      });
    } else if (overflow === 0) {
      this.saturated = false;
    }

    let drained = 0;
    const packets: PacketEvent[] = [];
    // Only a route that actually closes may move data. Without this guard a
    // fully-infeasible situation would let the router "transmit" into the void.
    if (chosen.route !== 'STORE_FORWARD' && chosen.feasible) {
      // Downlink capacity scales with link margin.
      const capacity = config.routing.packetRate * (chosen.route === 'DIRECT' ? 2.6 : 1.7) * dt;
      drained = Math.min(this.queue, capacity);
      this.queue -= drained;

      const lossRate =
        chosen.estPacketLoss + (anomaly?.kind === 'PACKET_LOSS_SPIKE' ? 0.22 : 0) + Math.abs(gaussian()) * 0.004;
      this.lossEwma.push(clamp(lossRate, 0, 1), dt);

      // A handful of representative packets for the link-graph animation.
      const hops: [PacketEvent['from'], PacketEvent['to']][] =
        chosen.route === 'DIRECT'
          ? [['SOMAIYASAT', 'GROUND']]
          : [
              ['SOMAIYASAT', 'SOMAIYAPOD'],
              ['SOMAIYAPOD', 'GROUND'],
            ];
      for (let i = 0; i < 3; i += 1) {
        for (const [from, to] of hops) {
          packets.push({
            id: nextId('pkt'),
            from,
            to,
            durationMs: chosen.route === 'DIRECT' ? 900 : 750,
            lost: Math.random() < lossRate,
            simTime: now,
          });
        }
      }
    } else {
      this.lossEwma.push(0, dt);
    }
    this.throughput.push((drained * 1024 * 8) / Math.max(dt, 0.001) / 1000, dt); // kbps

    /* -- decision record -- */
    const decision: RoutingDecisionDto = {
      id: nextId('dec'),
      simTime: now,
      route: chosen.route,
      label: chosen.label,
      confidence: chosen.probability,
      estLatency: chosen.estLatency,
      estPacketLoss: chosen.estPacketLoss,
      reasoning: this.explain(chosen, candidates, inp, anomaly),
      candidates,
      queueDepth: Math.round(this.queue),
      changed,
    };

    this.lastDecision = decision;
    this.recent.push(decision);
    if (this.recent.length > config.routing.decisionHistory) this.recent.shift();
    this.onDecision(decision);

    if (changed) {
      this.emit({
        id: nextId('evt'),
        simTime: now,
        severity: 'INFO',
        source: 'ROUTING',
        message: `Route → ${chosen.label} @ ${(chosen.probability * 100).toFixed(0)}% confidence · ${chosen.estLatency < 10_000 ? `${chosen.estLatency.toFixed(0)} ms` : `${(chosen.estLatency / 1000).toFixed(0)} s`} est. latency`,
        data: { route: chosen.route, confidence: chosen.probability },
      });
    }

    /* -- link states for the graph -- */
    const links: LinkQuality[] = [
      {
        id: 'SAT_GS',
        up: inp.satMarginDb !== null && inp.satMarginDb > 0,
        quality: this.marginScore(inp.satMarginDb),
        marginDb: round(inp.satMarginDb ?? -99, 1),
        latencyMs: round(inp.latencyDirect, 1),
        packetLoss: round(candidates[0].estPacketLoss, 4),
      },
      {
        id: 'SAT_POD',
        up: inp.islLos && (inp.islMarginDb ?? -1) > 0,
        quality: this.marginScore(inp.islMarginDb),
        marginDb: round(inp.islMarginDb ?? -99, 1),
        latencyMs: round((inp.islRangeKm / C_KM_S) * 1000 + 8, 1),
        packetLoss: round(inp.islLos ? 0.002 : 1, 4),
      },
      {
        id: 'POD_GS',
        up: (inp.podMarginDb ?? -1) > 0,
        quality: this.marginScore(inp.podMarginDb),
        marginDb: round(inp.podMarginDb ?? -99, 1),
        latencyMs: round((orbit.satellites[1].look.range / C_KM_S) * 1000 + 44, 1),
        packetLoss: round(candidates[1].estPacketLoss, 4),
      },
    ];

    return {
      clock: this.clock.state(),
      decision,
      links,
      packets,
      queueDepth: Math.round(this.queue),
      historicalLoss: round(this.lossEwma.get(), 5),
      throughput: round(this.throughput.get(), 1),
      activeAnomaly: anomaly,
      recentDecisions: [...this.recent].slice(-12),
    };
  }

  get latestDecision(): RoutingDecisionDto | null {
    return this.lastDecision;
  }

  reset(): void {
    this.queue = 0;
    this.currentRoute = 'STORE_FORWARD';
    this.recent = [];
    this.lastDecision = null;
    this.lastSim = this.clock.now();
    this.lossEwma = new Ewma(0.012, 90);
    this.throughput = new Ewma(0, 20);
  }
}