/**
 * Telemetry engine — power, thermal, attitude and OBC health.
 *
 * Physically coupled to the orbit engine: the eclipse flag drives solar input
 * and therefore the charge/discharge sign and the whole thermal profile, and
 * the ground-station pass flag drives transmitter load. Nothing here is a
 * random walk in isolation.
 *
 * Realism rules enforced in this file:
 *  - every channel carries mean-reverting (Ornstein–Uhlenbeck) sensor noise, so
 *    no value is ever frozen and no chart is ever a straight line;
 *  - temperatures move through a first-order lag, so they can never step;
 *  - battery voltage is derived from state of charge through an open-circuit
 *    voltage curve minus IR drop, so it can never exceed the 8.4 V pack limit.
 */

import { config } from '../config';
import type {
  ActiveAnomaly,
  AttitudeTelemetry,
  EventDto,
  ObcTelemetry,
  OrbitFrame,
  PowerTelemetry,
  Severity,
  SystemStatus,
  TelemetryFrame,
  ThermalTelemetry,
} from '../types';
import { SimClock } from './clock';
import { Ewma, LagFilter, OrnsteinUhlenbeck, clamp, gaussian, nextId, round } from './noise';

const DEG = Math.PI / 180;

/** Open-circuit voltage of a single Li-ion cell against state of charge. */
const OCV_CURVE: [number, number][] = [
  [0.0, 3.0],
  [0.05, 3.35],
  [0.15, 3.58],
  [0.3, 3.66],
  [0.5, 3.75],
  [0.7, 3.9],
  [0.85, 4.03],
  [1.0, 4.2],
];

function cellOcv(soc: number): number {
  const s = clamp(soc, 0, 1);
  for (let i = 1; i < OCV_CURVE.length; i += 1) {
    const [s0, v0] = OCV_CURVE[i - 1];
    const [s1, v1] = OCV_CURVE[i];
    if (s <= s1) return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
  }
  return OCV_CURVE[OCV_CURVE.length - 1][1];
}

interface ThermalNode {
  id: string;
  label: string;
  /** Equilibrium temperature with no sun and no internal dissipation, °C. */
  base: number;
  /** Swing between full sun and full eclipse, °C. */
  solarSwing: number;
  /** Thermal time constant, simulated seconds. */
  tau: number;
  min: number;
  max: number;
  filter: LagFilter;
  noise: OrnsteinUhlenbeck;
  /** Alert threshold, °C. */
  warnAbove: number;
  warnBelow: number;
}

export class TelemetryEngine {
  private soc = 0.78;
  private lastSim: number;
  private bootSim: number;

  private rebootCount = 0;
  private lastResetReason = 'POWER-ON RESET';
  private watchdogPetAt = 0;

  // Sigmas are chosen for the OU stationary deviation sigma/sqrt(2·theta):
  // ~4% CPU, ~2.2% memory, ~3 mA per solar face, ~23 mW of bus load.
  private cpu = new OrnsteinUhlenbeck(22, 0.12, 2.0, 24);
  private mem = new OrnsteinUhlenbeck(41, 0.05, 0.7, 42);
  private storageFree = 87.4;

  private faceNoise: OrnsteinUhlenbeck[];
  private loadNoise = new OrnsteinUhlenbeck(0, 0.3, 0.018);
  private socDisplay = new Ewma(0.78, 4);

  private thermal: ThermalNode[];

  // Attitude state: body rates integrate into an Euler attitude.
  private euler = { pitch: 12.4, roll: -8.1, yaw: 143.7 };
  private rateNoise = [
    new OrnsteinUhlenbeck(0, 0.08, 0.02, 0.9),
    new OrnsteinUhlenbeck(0, 0.08, 0.02, -1.4),
    new OrnsteinUhlenbeck(0, 0.08, 0.02, 0.6),
  ];
  private pointing = new LagFilter(38, 120);

  /** Latched alert state so we log a transition once, not every tick. */
  private latched = new Map<string, boolean>();

  constructor(
    private clock: SimClock,
    private emit: (e: EventDto) => void,
  ) {
    this.lastSim = clock.now();
    this.bootSim = clock.now();
    this.faceNoise = config.power.faces.map(() => new OrnsteinUhlenbeck(0, 0.4, 0.0027));
    this.thermal = this.buildThermal();
  }

  private buildThermal(): ThermalNode[] {
    const spec: Omit<ThermalNode, 'filter' | 'noise'>[] = [
      {
        id: 'TEMP_BAT',
        label: 'Battery',
        base: 4,
        solarSwing: 13,
        tau: 280,
        min: -20,
        max: 50,
        warnAbove: 42,
        warnBelow: -8,
      },
      {
        id: 'TEMP_OBC',
        label: 'OBC',
        base: 14,
        solarSwing: 10,
        tau: 160,
        min: -20,
        max: 50,
        warnAbove: 46,
        warnBelow: -12,
      },
      {
        id: 'TEMP_RF',
        label: 'Radio PA',
        base: 12,
        solarSwing: 11,
        tau: 95,
        min: -20,
        max: 50,
        warnAbove: 48,
        warnBelow: -15,
      },
      {
        id: 'TEMP_STR',
        label: 'Structure',
        base: -2,
        solarSwing: 24,
        tau: 360,
        min: -25,
        max: 55,
        warnAbove: 50,
        warnBelow: -18,
      },
    ];
    return spec.map((s) => ({
      ...s,
      filter: new LagFilter(s.base + s.solarSwing * 0.4, s.tau),
      noise: new OrnsteinUhlenbeck(0, 0.5, 0.09),
    }));
  }

  /**
   * Fire an event only on the rising edge of a condition, and a matching
   * recovery event on the falling edge. `subject` names what recovered, so the
   * clear message reads as a sentence on its own in the event log.
   */
  private latch(
    key: string,
    active: boolean,
    severity: Severity,
    subject: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const was = this.latched.get(key) ?? false;
    if (active && !was) {
      this.emit({
        id: nextId('evt'),
        simTime: this.clock.now(),
        severity,
        source: 'TELEMETRY',
        message,
        data,
      });
    } else if (!active && was) {
      this.emit({
        id: nextId('evt'),
        simTime: this.clock.now(),
        severity: 'SUCCESS',
        source: 'TELEMETRY',
        message: `${subject} recovered — back within nominal limits`,
        data,
      });
    }
    this.latched.set(key, active);
  }

  /** Called by the command handler when an OBC_RESET anomaly starts. */
  forceReboot(reason: string): void {
    this.bootSim = this.clock.now();
    this.rebootCount += 1;
    this.lastResetReason = reason;
    this.cpu.reset(72);
    this.emit({
      id: nextId('evt'),
      simTime: this.clock.now(),
      severity: 'CRITICAL',
      source: 'TELEMETRY',
      message: `OBC reset #${this.rebootCount} — ${reason}; uptime counter cleared`,
    });
  }

  tick(orbit: OrbitFrame, anomaly: ActiveAnomaly | null): TelemetryFrame {
    const now = this.clock.now();
    // Simulated seconds elapsed. The upper bound accommodates a SKIP_TO_AOS
    // fast-forward chunk; the noise and lag filters are exact-discretisation and
    // stay stable at any step size, so this only bounds how much charge a single
    // integration step may move.
    const dt = clamp((now - this.lastSim) / 1000, 0.05, 900);
    this.lastSim = now;

    const sat = orbit.satellites[0];
    const eclipse = !sat.sunlit;
    const inPass = orbit.pass.inPass;
    const argLat = ((now - this.clock.epoch) / 1000 / (config.satellites[0].periodMinutes * 60)) * 360;

    const power = this.stepPower(dt, eclipse, inPass, argLat, anomaly);
    const thermal = this.stepThermal(dt, eclipse, argLat, power, inPass, anomaly);
    const attitude = this.stepAttitude(dt, now);
    const obc = this.stepObc(dt, now, inPass, anomaly);

    power.batteryTemp = thermal.sensors[0].value;

    const status = this.deriveStatus(power, thermal, anomaly);
    this.raiseAlerts(power, thermal, attitude);

    return { clock: this.clock.state(), power, thermal, attitude, obc, status };
  }

  /* ------------------------------------------------------------- power */

  private stepPower(
    dt: number,
    eclipse: boolean,
    inPass: boolean,
    argLat: number,
    anomaly: ActiveAnomaly | null,
  ): PowerTelemetry {
    const { faces, facePeakCurrent, capacityAh, internalResistance, baseLoad, radioIdleLoad } =
      config.power;

    // Per-face illumination. The four side faces are body-fixed normals 90°
    // apart, so opposite faces are 180° out of phase and only ever two of them
    // are lit at once; +Z is the zenith face and stays weakly lit in sunlight.
    const SIDE_NORMALS: Record<string, number> = { '+X': 0, '+Y': 90, '-X': 180, '-Y': 270 };
    const solarCurrents = faces.map((face, i) => {
      let current: number;
      if (!eclipse) {
        const incidence =
          face === '+Z'
            ? 0.34 + 0.1 * Math.sin((argLat + 40) * DEG)
            : Math.max(0, Math.cos((argLat - SIDE_NORMALS[face]) * DEG));
        current = facePeakCurrent * incidence;
      } else {
        current = 0.0008; // dark-current leakage, never exactly zero
      }
      current += this.faceNoise[i].step(dt);
      return { face, current: round(clamp(current, 0, facePeakCurrent * 1.05), 4) };
    });

    const socNow = clamp(this.soc, 0.02, 1);
    const ocv = cellOcv(socNow) * config.power.cells;
    const solarCurrentTotal = solarCurrents.reduce((a, b) => a + b.current, 0);

    // Load: housekeeping + radio idle, plus the PA whenever we have a pass, plus
    // any anomaly-driven excess draw.
    let load = baseLoad + radioIdleLoad + this.loadNoise.step(dt);
    if (inPass) load += 1.45;
    if (anomaly?.kind === 'BATTERY_DIP') load += 1.9;
    if (anomaly?.kind === 'THERMAL_EXCURSION') load += 0.4;
    load = Math.max(0.3, load);

    const solarPowerIn = solarCurrentTotal * ocv;
    const netPower = solarPowerIn - load;
    const netCurrent = netPower / ocv;

    // Coulomb counting.
    this.soc = clamp(this.soc + (netCurrent * dt) / 3600 / capacityAh, 0.05, 1);
    const smoothedSoc = this.socDisplay.push(this.soc, dt);

    // Terminal voltage = OCV + I·R, with I signed (charging raises the terminal
    // voltage, discharging sags it). ADC noise is added *before* the clamp so
    // the published reading can never exceed the 8.4 V pack limit or fall below
    // the 6.0 V cutoff — the bound is on what the dashboard shows, not just on
    // the noiseless value.
    const terminal = clamp(
      cellOcv(this.soc) * config.power.cells +
        netCurrent * internalResistance +
        gaussian() * 0.004,
      config.power.vMin,
      config.power.vMax,
    );

    return {
      batteryVoltage: round(terminal, 3),
      stateOfCharge: round(smoothedSoc * 100, 1),
      batteryCurrent: round(netCurrent, 3),
      solarCurrents,
      solarPowerIn: round(solarPowerIn, 3),
      loadPower: round(load, 3),
      charging: netCurrent > 0,
      eclipse,
      batteryTemp: 0, // filled in by tick() once thermal has stepped
    };
  }

  /* ----------------------------------------------------------- thermal */

  private stepThermal(
    dt: number,
    eclipse: boolean,
    argLat: number,
    power: PowerTelemetry,
    inPass: boolean,
    anomaly: ActiveAnomaly | null,
  ): ThermalTelemetry {
    // Slow sinusoid across the orbit so even within sunlight the temperature
    // keeps drifting with beta angle rather than sitting flat.
    const orbitPhase = Math.sin(argLat * DEG);

    const sensors = this.thermal.map((node) => {
      let target = node.base + (eclipse ? -node.solarSwing * 0.75 : node.solarSwing) + orbitPhase * 2.2;

      if (node.id === 'TEMP_OBC') target += (this.cpu.get() / 100) * 9;
      if (node.id === 'TEMP_RF') {
        target += inPass ? 15 : 1.5;
        if (anomaly?.kind === 'THERMAL_EXCURSION') target += 26;
      }
      if (node.id === 'TEMP_BAT') {
        target += Math.abs(power.batteryCurrent) * 3.4;
        if (anomaly?.kind === 'BATTERY_DIP') target += 6;
      }

      const value = node.filter.step(target, dt) + node.noise.step(dt);
      return {
        id: node.id,
        label: node.label,
        value: round(clamp(value, node.min - 5, node.max + 12), 2),
        min: node.min,
        max: node.max,
      };
    });

    return { sensors };
  }

  /* ---------------------------------------------------------- attitude */

  private stepAttitude(dt: number, now: number): AttitudeTelemetry {
    const elapsed = (now - this.bootSim) / 1000;
    // Narrative: launch tumble bleeds off through magnetorquer detumbling, then
    // the ADCS converges on stable nadir pointing.
    const envelope = 0.18 + 11.5 * Math.exp(-elapsed / 900);

    const jitter = this.rateNoise.map((n) => n.step(dt));
    const rates = {
      x: round(envelope * 0.55 + jitter[0] * 0.8, 3),
      y: round(envelope * -0.42 + jitter[1] * 0.8, 3),
      z: round(envelope * 0.31 + jitter[2] * 0.8, 3),
    };

    const spinRate = Math.hypot(rates.x, rates.y, rates.z);

    const wrap = (v: number, lo: number, hi: number) => {
      const span = hi - lo;
      return ((((v - lo) % span) + span) % span) + lo;
    };
    this.euler.pitch = wrap(this.euler.pitch + rates.x * dt, -180, 180);
    this.euler.roll = wrap(this.euler.roll + rates.y * dt, -180, 180);
    this.euler.yaw = wrap(this.euler.yaw + rates.z * dt, 0, 360);

    const mode: AttitudeTelemetry['mode'] =
      spinRate > 2.5 ? 'DETUMBLE' : spinRate > 0.7 ? 'COARSE_POINT' : 'FINE_POINT';

    const pointingTarget = mode === 'DETUMBLE' ? 34 : mode === 'COARSE_POINT' ? 6.5 : 0.75;
    const pointingError = this.pointing.step(pointingTarget, dt) + Math.abs(gaussian() * 0.12);

    // Euler (ZYX) -> quaternion.
    const cy = Math.cos((this.euler.yaw * DEG) / 2);
    const sy = Math.sin((this.euler.yaw * DEG) / 2);
    const cp = Math.cos((this.euler.pitch * DEG) / 2);
    const sp = Math.sin((this.euler.pitch * DEG) / 2);
    const cr = Math.cos((this.euler.roll * DEG) / 2);
    const sr = Math.sin((this.euler.roll * DEG) / 2);

    return {
      pitch: round(this.euler.pitch, 2),
      roll: round(this.euler.roll, 2),
      yaw: round(this.euler.yaw, 2),
      spinRate: round(spinRate, 3),
      rates,
      quaternion: {
        w: round(cr * cp * cy + sr * sp * sy, 4),
        x: round(sr * cp * cy - cr * sp * sy, 4),
        y: round(cr * sp * cy + sr * cp * sy, 4),
        z: round(cr * cp * sy - sr * sp * cy, 4),
      },
      mode,
      pointingError: round(pointingError, 2),
    };
  }

  /* --------------------------------------------------------------- OBC */

  private stepObc(dt: number, now: number, inPass: boolean, anomaly: ActiveAnomaly | null): ObcTelemetry {
    this.cpu.setMean(inPass ? 46 : 22);
    const cpuLoad = clamp(this.cpu.step(dt) + (anomaly ? 7 : 0), 3, 99);
    const memoryUse = clamp(this.mem.step(dt), 12, 94);

    // Payload store fills between passes and drains while downlinking. Rates are
    // sized against the real contact schedule: a sun-synchronous orbit gives
    // this station only a handful of passes a day, so the fill rate has to be
    // slow enough that a full day of buffering does not peg the store at its
    // floor, while a ten-minute contact still visibly empties it.
    this.storageFree = clamp(
      this.storageFree + (inPass ? 0.045 : -0.0009) * dt + gaussian() * 0.002,
      2,
      99,
    );

    if (now - this.watchdogPetAt > 30_000) this.watchdogPetAt = now;
    const sincePet = now - this.watchdogPetAt;
    const watchdog: ObcTelemetry['watchdog'] =
      anomaly?.kind === 'OBC_RESET' ? 'TRIPPED' : sincePet < 1500 ? 'PETTED' : 'OK';

    return {
      uptime: round(Math.max(0, (now - this.bootSim) / 1000), 0),
      cpuLoad: round(cpuLoad, 1),
      memoryUse: round(memoryUse, 1),
      rebootCount: this.rebootCount,
      watchdog,
      storageFree: round(this.storageFree, 1),
      lastResetReason: this.lastResetReason,
    };
  }

  /* ------------------------------------------------------ status/alerts */

  private deriveStatus(
    power: PowerTelemetry,
    thermal: ThermalTelemetry,
    anomaly: ActiveAnomaly | null,
  ): SystemStatus {
    if (anomaly && anomaly.severity === 'CRITICAL') return 'ANOMALY';
    const hotOrCold = thermal.sensors.some((s) => s.value > s.max || s.value < s.min);
    if (hotOrCold || power.stateOfCharge < 22) return 'ANOMALY';
    if (anomaly || power.stateOfCharge < 38 || thermal.sensors.some((s) => s.value > s.max - 6)) {
      return 'DEGRADED';
    }
    return 'NOMINAL';
  }

  private raiseAlerts(power: PowerTelemetry, thermal: ThermalTelemetry, attitude: AttitudeTelemetry): void {
    this.latch(
      'soc_low',
      power.stateOfCharge < 35,
      power.stateOfCharge < 22 ? 'CRITICAL' : 'WARN',
      'EPS battery state of charge',
      `EPS — battery state of charge ${power.stateOfCharge.toFixed(1)}% below threshold`,
      { soc: power.stateOfCharge, voltage: power.batteryVoltage },
    );

    for (const node of this.thermal) {
      const s = thermal.sensors.find((x) => x.id === node.id)!;
      this.latch(
        `${node.id}_hot`,
        s.value > node.warnAbove,
        s.value > node.max ? 'CRITICAL' : 'WARN',
        `TCS ${node.label} over-temperature`,
        `TCS — ${node.label} at ${s.value.toFixed(1)}°C, above ${node.warnAbove}°C limit`,
        { sensor: node.id, value: s.value },
      );
      this.latch(
        `${node.id}_cold`,
        s.value < node.warnBelow,
        'WARN',
        `TCS ${node.label} under-temperature`,
        `TCS — ${node.label} at ${s.value.toFixed(1)}°C, below ${node.warnBelow}°C limit`,
        { sensor: node.id, value: s.value },
      );
    }

    this.latch(
      'adcs_fine',
      attitude.mode === 'FINE_POINT',
      'SUCCESS',
      'ADCS fine pointing',
      `ADCS — fine pointing acquired, body rate ${attitude.spinRate.toFixed(2)}°/s`,
      { spinRate: attitude.spinRate },
    );
  }

  reset(): void {
    this.soc = 0.78;
    this.bootSim = this.clock.now();
    this.lastSim = this.clock.now();
    this.rebootCount = 0;
    this.lastResetReason = 'GROUND COMMANDED RESET';
    this.storageFree = 87.4;
    this.euler = { pitch: 12.4, roll: -8.1, yaw: 143.7 };
    this.pointing.reset(38);
    this.thermal = this.buildThermal();
    this.latched.clear();
  }
}