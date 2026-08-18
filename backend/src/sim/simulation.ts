/**
 * Simulation orchestrator.
 *
 * Owns the simulation clock, the four engines and the mock uplink, and is the
 * only place that decides what gets broadcast on which socket.io channel.
 *
 * Tick topology — the engines are chained, not independent:
 *
 *   orbit (1 Hz) ──► telemetry (1 Hz) ──► radio (0.5 Hz) ──► routing (0.33 Hz)
 *      eclipse ─────────┘   pointing error ──┘   link margin ──┘
 *
 * Each engine consumes the most recent frame from the one above it, so a change
 * upstream (entering eclipse, an anomaly, a commanded mode change) propagates
 * all the way to the routing decision within one routing tick.
 */

import type { Server } from 'socket.io';
import { config } from '../config';
import { history } from '../db/history';
import { isDatabaseAvailable } from '../db/prisma';
import type {
  AnomalyKind,
  CommandDto,
  CommandType,
  EventDto,
  OrbitFrame,
  RadioFrame,
  RadioMode,
  RoutingFrame,
  SnapshotFrame,
  TelemetryFrame,
} from '../types';
import { AnomalyManager } from './anomaly';
import { SimClock } from './clock';
import { nextId, randRange, round } from './noise';
import { OrbitEngine } from './orbitEngine';
import { RADIO_MODES, RadioEngine } from './radio';
import { RoutingEngine } from './routing';
import { TelemetryEngine } from './telemetry';

export class Simulation {
  readonly clock = new SimClock();
  private orbitEngine: OrbitEngine;
  private telemetryEngine: TelemetryEngine;
  private radioEngine: RadioEngine;
  private routingEngine: RoutingEngine;
  private anomalies: AnomalyManager;

  private orbitFrame!: OrbitFrame;
  private telemetryFrame!: TelemetryFrame;
  private radioFrame!: RadioFrame;
  private routingFrame!: RoutingFrame;

  private events: EventDto[] = [];
  private commands: CommandDto[] = [];

  private timers: NodeJS.Timeout[] = [];
  private io: Server | null = null;
  private lastPersist = 0;

  constructor() {
    const emit = (e: EventDto) => this.pushEvent(e);

    this.orbitEngine = new OrbitEngine(this.clock);
    this.telemetryEngine = new TelemetryEngine(this.clock, emit);
    this.radioEngine = new RadioEngine(this.clock, emit);
    this.anomalies = new AnomalyManager(this.clock, emit, (reason) =>
      this.telemetryEngine.forceReboot(reason),
    );
    this.routingEngine = new RoutingEngine(this.clock, emit, (d) => history.recordDecision(d));

    // Prime every frame once so nothing downstream sees an undefined input.
    this.orbitFrame = this.orbitEngine.tick();
    this.telemetryFrame = this.telemetryEngine.tick(this.orbitFrame, null);
    this.radioFrame = this.radioEngine.tick(this.orbitFrame, this.telemetryFrame, null);
    this.routingFrame = this.routingEngine.tick(
      this.orbitFrame,
      this.telemetryFrame,
      this.radioFrame,
      null,
    );
  }

  attach(io: Server): void {
    this.io = io;
  }

  /* ----------------------------------------------------------- lifecycle */

  start(): void {
    if (this.timers.length) return;

    this.pushEvent({
      id: nextId('evt'),
      simTime: this.clock.now(),
      severity: 'SUCCESS',
      source: 'SYSTEM',
      message: `${config.mission.designator} simulation online — epoch ${new Date(
        this.clock.epoch,
      ).toISOString()}, ${this.clock.getSpeed()}× sim rate`,
    });

    this.timers.push(setInterval(() => this.tickOrbitAndTelemetry(), config.tick.orbit));
    this.timers.push(setInterval(() => this.tickRadio(), config.tick.radio));
    this.timers.push(setInterval(() => this.tickRouting(), config.tick.routing));

    history.start();
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
    history.stop();
  }

  /* ---------------------------------------------------------------- ticks */

  private tickOrbitAndTelemetry(): void {
    this.orbitFrame = this.orbitEngine.tick();
    this.telemetryFrame = this.telemetryEngine.tick(this.orbitFrame, this.anomalies.active);

    this.io?.emit('orbit', this.orbitFrame);
    this.io?.emit('telemetry', this.telemetryFrame);

    this.persistTelemetry();
  }

  private tickRadio(): void {
    this.radioFrame = this.radioEngine.tick(
      this.orbitFrame,
      this.telemetryFrame,
      this.anomalies.active,
    );
    this.io?.emit('radio', this.radioFrame);
  }

  private tickRouting(force = false): void {
    const anomaly = this.anomalies.tick();
    this.routingFrame = this.routingEngine.tick(
      this.orbitFrame,
      this.telemetryFrame,
      this.radioFrame,
      anomaly,
      force,
    );
    this.io?.emit('routing', this.routingFrame);
  }

  /**
   * Persist a downsampled slice of every channel. Throttled to the configured
   * persist interval so a 1 Hz loop does not produce a write per tick.
   */
  private persistTelemetry(): void {
    const wall = Date.now();
    if (wall - this.lastPersist < config.tick.persist) return;
    this.lastPersist = wall;

    const t = this.telemetryFrame;
    const sim = t.clock.simTime;
    const sat = this.orbitFrame.satellites[0];

    history.recordTelemetry('power', sim, {
      batteryVoltage: t.power.batteryVoltage,
      stateOfCharge: t.power.stateOfCharge,
      batteryCurrent: t.power.batteryCurrent,
      solarPowerIn: t.power.solarPowerIn,
      loadPower: t.power.loadPower,
      eclipse: t.power.eclipse,
    });
    history.recordTelemetry(
      'thermal',
      sim,
      Object.fromEntries(t.thermal.sensors.map((s) => [s.id, s.value])),
    );
    history.recordTelemetry('attitude', sim, {
      pitch: t.attitude.pitch,
      roll: t.attitude.roll,
      yaw: t.attitude.yaw,
      spinRate: t.attitude.spinRate,
      pointingError: t.attitude.pointingError,
      mode: t.attitude.mode,
    });
    history.recordTelemetry('obc', sim, {
      cpuLoad: t.obc.cpuLoad,
      memoryUse: t.obc.memoryUse,
      uptime: t.obc.uptime,
      storageFree: t.obc.storageFree,
      rebootCount: t.obc.rebootCount,
    });
    history.recordTelemetry('orbit', sim, {
      lat: round(sat.lat, 4),
      lon: round(sat.lon, 4),
      altitude: sat.altitude,
      elevation: round(sat.look.elevation, 3),
      sunlit: sat.sunlit,
      orbitNumber: sat.orbitNumber,
    });
    history.recordTelemetry('radio', sim, {
      mode: this.radioFrame.mode,
      rssi: this.radioFrame.rssi,
      snr: this.radioFrame.snr,
      doppler: this.radioFrame.doppler,
      elevation: this.radioFrame.elevation,
    });
  }

  /* --------------------------------------------------------------- events */

  private pushEvent(event: EventDto): void {
    this.events.push(event);
    if (this.events.length > config.eventLogLength) this.events.shift();
    history.recordEvent(event);
    this.io?.emit('event', event);
  }

  /* ------------------------------------------------------- mock uplink */

  /**
   * Accept a ground command. Returns immediately with a PENDING record; the ack
   * lands 1–3 s later (real time) to mimic uplink scheduling + round-trip delay,
   * and the command's effect is applied at ack time, not at submit time.
   */
  submitCommand(type: CommandType, params: Record<string, unknown> = {}): CommandDto {
    const uplinkDelay = Math.round(randRange(1000, 3000));
    const command: CommandDto = {
      id: nextId('cmd'),
      type,
      params,
      status: 'PENDING',
      issuedAt: Date.now(),
      simTime: this.clock.now(),
      ackAt: null,
      uplinkDelay,
      result: null,
    };

    this.commands.push(command);
    if (this.commands.length > config.commandLogLength) this.commands.shift();
    history.recordCommand(command);

    this.pushEvent({
      id: nextId('evt'),
      simTime: command.simTime,
      severity: 'INFO',
      source: 'COMMAND',
      message: `Uplink queued — ${type}${
        Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''
      }, awaiting ack (${uplinkDelay} ms)`,
      data: { commandId: command.id },
    });

    this.io?.emit('command', command);

    setTimeout(() => this.applyCommand(command), uplinkDelay);

    return command;
  }

  private applyCommand(command: CommandDto): void {
    let result = 'Executed';
    let status: CommandDto['status'] = 'ACKED';

    try {
      switch (command.type) {
        case 'SET_RADIO_MODE': {
          const mode = String(command.params.mode) as RadioMode;
          if (!RADIO_MODES[mode]) throw new Error(`unknown radio mode "${mode}"`);
          const spec = this.radioEngine.setMode(mode);
          // Refresh the radio frame immediately so the panel does not wait for
          // the next 2 s radio tick to show the new mode.
          this.radioFrame = this.radioEngine.tick(
            this.orbitFrame,
            this.telemetryFrame,
            this.anomalies.active,
          );
          this.io?.emit('radio', this.radioFrame);
          result = `Payload reconfigured to ${spec.label} · ${spec.downlink.toFixed(3)} MHz · ${spec.txPower.toFixed(2)} W · ${spec.modulation}`;
          break;
        }
        case 'FORCE_ROUTE_EVAL': {
          this.tickRouting(true);
          const d = this.routingEngine.latestDecision;
          result = `Route re-evaluated → ${d?.label ?? 'n/a'} at ${((d?.confidence ?? 0) * 100).toFixed(0)}% confidence`;
          break;
        }
        case 'TRIGGER_ANOMALY': {
          const kind = String(command.params.kind ?? 'LINK_DEGRADATION') as AnomalyKind;
          const durationSec = Number(command.params.durationSec) || undefined;
          const anomaly = this.anomalies.trigger(kind, durationSec);
          // Let the router react on the spot rather than up to 3 s later.
          this.tickRouting(true);
          result = `Injected ${anomaly.label}, clearing in ${Math.round((anomaly.endsAt - anomaly.startedAt) / 1000)} s of sim time`;
          break;
        }
        case 'CLEAR_ANOMALY': {
          this.anomalies.clear();
          this.tickRouting(true);
          result = 'Anomaly cleared, subsystems returning to nominal';
          break;
        }
        case 'SET_SIM_SPEED': {
          const speed = Number(command.params.speed);
          if (!Number.isFinite(speed)) throw new Error('speed must be a number');
          const applied = this.clock.setSpeed(speed);
          this.orbitEngine.invalidate();
          result = `Simulation rate set to ${applied}× real time`;
          break;
        }
        case 'SKIP_TO_AOS': {
          result = this.skipToNextAos();
          break;
        }
        case 'RESET_SIM': {
          this.resetAll();
          result = 'Simulation reset to mission epoch; history cleared';
          break;
        }
        default:
          throw new Error(`unsupported command "${command.type}"`);
      }
    } catch (err) {
      status = 'REJECTED';
      result = err instanceof Error ? err.message : String(err);
    }

    command.status = status;
    command.ackAt = Date.now();
    command.result = result;
    history.updateCommand(command);

    this.pushEvent({
      id: nextId('evt'),
      simTime: this.clock.now(),
      severity: status === 'ACKED' ? 'SUCCESS' : 'CRITICAL',
      source: 'COMMAND',
      message: `${status === 'ACKED' ? 'ACK' : 'NAK'} ${command.type} — ${result}`,
      data: { commandId: command.id, roundTripMs: command.ackAt - command.issuedAt },
    });

    this.io?.emit('command:ack', command);
  }

  /**
   * Fast-forward the simulation clock to just before the next acquisition of
   * signal.
   *
   * A sun-synchronous ground track only lines up with a single station a few
   * times a day, so real gaps between passes run to ten hours or more — correct,
   * but not something a jury can sit through even at 30x. The skip advances the
   * clock in ~5 simulated-minute chunks and re-runs the orbit and telemetry
   * engines on each one, so the battery genuinely discharges through the
   * intervening eclipses and temperatures genuinely cycle. It is a fast-forward,
   * not a teleport: no state is faked.
   */
  private skipToNextAos(): string {
    const { pass } = this.orbitFrame;
    const now = this.clock.now();

    if (pass.inPass) return 'Already in contact — skip not required';
    if (pass.aos === null) return 'No AOS predicted within the 30 h search horizon';

    // Arrive one simulated minute before the horizon crossing.
    const delta = pass.aos - 60_000 - now;
    if (delta <= 0) return 'Next AOS is less than a minute away — skip not required';

    // Cap the iteration count so a 20 h skip stays responsive.
    const MAX_CHUNKS = 300;
    const stepMs = Math.max(60_000, delta / MAX_CHUNKS);
    const chunks = Math.ceil(delta / stepMs);

    for (let i = 0; i < chunks; i += 1) {
      this.clock.advance(Math.min(stepMs, delta - i * stepMs));
      this.orbitFrame = this.orbitEngine.tick();
      this.telemetryFrame = this.telemetryEngine.tick(this.orbitFrame, this.anomalies.active);
    }

    this.orbitEngine.invalidate();
    this.orbitFrame = this.orbitEngine.tick();
    this.radioFrame = this.radioEngine.tick(
      this.orbitFrame,
      this.telemetryFrame,
      this.anomalies.active,
    );
    this.io?.emit('orbit', this.orbitFrame);
    this.io?.emit('telemetry', this.telemetryFrame);
    this.io?.emit('radio', this.radioFrame);
    this.tickRouting(true);

    const minutes = delta / 60_000;
    return `Advanced ${minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes.toFixed(0)} min`} of simulated time to AOS (max elevation ${this.orbitFrame.pass.maxElevation.toFixed(0)}°)`;
  }

  private resetAll(): void {
    this.clock.reset();
    this.clock.setSpeed(config.speed);
    this.telemetryEngine.reset();
    this.radioEngine.reset();
    this.routingEngine.reset();
    this.anomalies.reset();
    this.orbitEngine.invalidate();
    this.events = [];
    void history.clear();

    this.orbitFrame = this.orbitEngine.tick();
    this.telemetryFrame = this.telemetryEngine.tick(this.orbitFrame, null);
    this.radioFrame = this.radioEngine.tick(this.orbitFrame, this.telemetryFrame, null);
    this.routingFrame = this.routingEngine.tick(
      this.orbitFrame,
      this.telemetryFrame,
      this.radioFrame,
      null,
      true,
    );
  }

  /* ------------------------------------------------------------ snapshot */

  snapshot(): SnapshotFrame {
    return {
      orbit: this.orbitFrame,
      telemetry: this.telemetryFrame,
      radio: this.radioFrame,
      routing: this.routingFrame,
      events: [...this.events].slice(-120),
      commands: [...this.commands].slice(-30),
      mission: {
        name: config.mission.name,
        designator: config.mission.designator,
        operator: config.mission.operator,
        epoch: this.clock.epoch,
        persistence: isDatabaseAvailable() ? 'POSTGRES' : 'MEMORY',
      },
    };
  }

  get recentEvents(): EventDto[] {
    return this.events;
  }

  get recentCommands(): CommandDto[] {
    return this.commands;
  }
}

export const simulation = new Simulation();