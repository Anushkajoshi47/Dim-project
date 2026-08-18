/**
 * Amateur radio payload simulator.
 *
 * Four mutually exclusive modes on the 2 m / 70 cm amateur bands. The received
 * signal is produced by an actual link budget rather than a random number:
 *
 *   RSSI = EIRP − FSPL(range, f) − atmospheric − polarisation + G_rx − L_line
 *
 * so it rises toward zenith and collapses at the horizon purely because the
 * orbit engine says the slant range and elevation changed. Below the ground
 * station's minimum elevation there is no signal at all — the readouts go null
 * rather than showing a plausible-looking number for a satellite that is under
 * the horizon.
 */

import { config } from '../config';
import type {
  ActiveAnomaly,
  EventDto,
  OrbitFrame,
  RadioFrame,
  RadioMode,
  RadioModeSpec,
  TelemetryFrame,
} from '../types';
import { SimClock } from './clock';
import { freeSpacePathLoss } from './orbit';
import { OrnsteinUhlenbeck, clamp, gaussian, nextId, round } from './noise';

const C_KM_S = 299792.458;
const DEG = Math.PI / 180;

/** Spacecraft-side RF constants. */
const SAT_ANTENNA_GAIN_DBI = 2.1; // quarter-wave monopole / turnstile
const SAT_LINE_LOSS_DB = 0.7;
const RX_NOISE_FIGURE_DB = 2.5;

export const RADIO_MODES: Record<RadioMode, RadioModeSpec> = {
  FM_VOICE: {
    mode: 'FM_VOICE',
    label: 'FM Voice Repeater',
    uplink: 145.95,
    downlink: 435.55,
    band: '70cm',
    txPower: 0.8,
    bandwidth: 16000,
    modulation: 'FM · V/U crossband',
    description: 'Crossband analogue repeater, 2 m up / 70 cm down, 67 Hz CTCSS.',
  },
  APRS_DIGI: {
    mode: 'APRS_DIGI',
    label: 'APRS Digipeater',
    uplink: 145.825,
    downlink: 145.825,
    band: '2m',
    txPower: 0.5,
    bandwidth: 15000,
    modulation: 'AFSK 1200 Bd · AX.25',
    description: 'Simplex store-and-digipeat of AX.25 position beacons.',
  },
  SSTV: {
    mode: 'SSTV',
    label: 'SSTV Downlink',
    uplink: 145.99,
    downlink: 437.4,
    band: '70cm',
    txPower: 1.2,
    bandwidth: 20000,
    modulation: 'FM SSTV · Robot 36',
    description: 'Slow-scan image downlink from the payload camera buffer.',
  },
  CW_BEACON: {
    mode: 'CW_BEACON',
    label: 'CW Telemetry Beacon',
    uplink: 437.025,
    downlink: 437.025,
    band: '70cm',
    txPower: 0.35,
    bandwidth: 500,
    modulation: 'CW / OOK · 18 WPM',
    description: 'Morse housekeeping beacon, transmitted every 60 s regardless of pass.',
  },
};

export class RadioEngine {
  private mode: RadioMode = 'CW_BEACON';
  private history: RadioFrame['history'] = [];
  /** Slow multipath/polarisation fading, ~1.2 dB one-sigma. */
  private fading = new OrnsteinUhlenbeck(0, 0.25, 0.85);
  private lastBeacon = 0;
  private lastSim: number;

  constructor(
    private clock: SimClock,
    private emit: (e: EventDto) => void,
  ) {
    this.lastSim = clock.now();
  }

  getMode(): RadioMode {
    return this.mode;
  }

  setMode(mode: RadioMode): RadioModeSpec {
    const previous = this.mode;
    this.mode = mode;
    const spec = RADIO_MODES[mode];
    if (previous !== mode) {
      this.emit({
        id: nextId('evt'),
        simTime: this.clock.now(),
        severity: 'SUCCESS',
        source: 'RADIO',
        message: `Payload mode ${RADIO_MODES[previous].label} → ${spec.label} (${spec.downlink.toFixed(
          3,
        )} MHz, ${spec.txPower.toFixed(2)} W)`,
        data: { from: previous, to: mode },
      });
    }
    return spec;
  }

  /** Receiver noise power in the current mode's bandwidth, dBm. */
  private noiseFloor(bandwidthHz: number): number {
    return -174 + 10 * Math.log10(bandwidthHz) + RX_NOISE_FIGURE_DB;
  }

  tick(orbit: OrbitFrame, telemetry: TelemetryFrame, anomaly: ActiveAnomaly | null): RadioFrame {
    const now = this.clock.now();
    const dt = clamp((now - this.lastSim) / 1000, 0.05, 900);
    this.lastSim = now;

    const spec = RADIO_MODES[this.mode];
    const sat = orbit.satellites[0];
    const { elevation, azimuth, range, rangeRate } = sat.look;
    const gs = config.groundStation;
    const aboveHorizon = elevation >= gs.minElevation;

    const degraded = anomaly?.kind === 'LINK_DEGRADATION';

    let rssi: number | null = null;
    let snr: number | null = null;
    let doppler: number | null = null;
    let correctedFrequency: number | null = null;
    let pathLoss: number | null = null;
    let linkMargin: number | null = null;

    if (aboveHorizon) {
      const eirp = 10 * Math.log10(spec.txPower * 1000) + SAT_ANTENNA_GAIN_DBI - SAT_LINE_LOSS_DB;
      pathLoss = freeSpacePathLoss(range, spec.downlink);

      // Atmosphere is a secant-law slab: negligible at zenith, severe at the horizon.
      const atmospheric = 0.55 / Math.max(Math.sin(elevation * DEG), 0.09);

      // A tumbling spacecraft dumps energy into the wrong polarisation, so ADCS
      // pointing error feeds straight into the link budget.
      const polarisation = 0.8 + Math.min(6, telemetry.attitude.pointingError * 0.12);

      const fade = this.fading.step(dt);

      rssi =
        eirp - pathLoss - atmospheric - polarisation + gs.gainDbi - gs.lineLossDb + fade - (degraded ? 13 : 0);

      const noise = this.noiseFloor(spec.bandwidth);
      snr = rssi - noise;
      linkMargin = snr - config.radio.requiredSnrDb;

      // Positive range rate = receding = downshifted.
      doppler = (-rangeRate / C_KM_S) * spec.downlink * 1e6;
      correctedFrequency = spec.downlink + doppler / 1e6;
    }

    // The CW beacon keys up every 60 simulated seconds whether or not anyone is
    // listening; the other modes only key up when the ground station has them.
    const transmitting =
      this.mode === 'CW_BEACON' ? now - this.lastBeacon < 12_000 || aboveHorizon : aboveHorizon;
    if (this.mode === 'CW_BEACON' && now - this.lastBeacon > 60_000) this.lastBeacon = now;

    this.history.push({
      t: now,
      rssi: rssi === null ? null : round(rssi, 1),
      snr: snr === null ? null : round(snr, 1),
    });
    if (this.history.length > config.radio.historyLength) {
      this.history.splice(0, this.history.length - config.radio.historyLength);
    }

    return {
      clock: this.clock.state(),
      mode: this.mode,
      spec,
      transmitting,
      rssi: rssi === null ? null : round(rssi, 1),
      snr: snr === null ? null : round(snr, 1),
      doppler: doppler === null ? null : round(doppler, 0),
      correctedFrequency: correctedFrequency === null ? null : round(correctedFrequency, 6),
      pathLoss: pathLoss === null ? null : round(pathLoss, 1),
      linkMargin: linkMargin === null ? null : round(linkMargin, 1),
      elevation: round(elevation, 2),
      azimuth: round(azimuth, 2),
      range: round(range, 1),
      history: [...this.history],
      spectrum: this.spectrum(rssi, spec),
      beaconText: this.beacon(telemetry, orbit),
      pass: orbit.pass,
      degraded: Boolean(degraded),
    };
  }

  /**
   * 64-bin waterfall slice. Noise everywhere, plus a Gaussian-shaped carrier in
   * the middle whose width tracks the mode's occupied bandwidth.
   */
  private spectrum(rssi: number | null, spec: RadioModeSpec): number[] {
    const bins = config.radio.spectrumBins;
    const floor = config.radio.noiseFloorDbm;
    const centre = bins / 2;
    // 500 Hz CW is a single bin; 20 kHz FM spreads across a third of the span.
    const width = clamp(Math.log10(spec.bandwidth) * 1.35 - 2.2, 0.6, 8);

    return Array.from({ length: bins }, (_, i) => {
      let v = floor + gaussian() * 2.2;
      if (rssi !== null) {
        const shape = Math.exp(-((i - centre) ** 2) / (2 * width * width));
        v = Math.max(v, floor + (rssi - floor) * shape + gaussian() * 1.1);
      }
      return round(v, 1);
    });
  }

  /** Human-readable CW housekeeping beacon, in the usual amateur format. */
  private beacon(telemetry: TelemetryFrame, orbit: OrbitFrame): string {
    const t = telemetry.thermal.sensors[0].value;
    const sign = t >= 0 ? '+' : '-';
    return [
      config.radio.beaconCall,
      'KJS-SRS-01',
      `V${telemetry.power.batteryVoltage.toFixed(2)}`,
      `S${Math.round(telemetry.power.stateOfCharge)}`,
      `T${sign}${Math.abs(Math.round(t))}C`,
      `O${orbit.satellites[0].orbitNumber}`,
      telemetry.power.eclipse ? 'ECL' : 'SUN',
      telemetry.status === 'NOMINAL' ? 'OK' : telemetry.status,
      'K',
    ].join(' ');
  }

  reset(): void {
    this.mode = 'CW_BEACON';
    this.history = [];
    this.lastBeacon = 0;
    this.lastSim = this.clock.now();
  }
}