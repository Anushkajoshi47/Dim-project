/**
 * Wire types shared between the simulation backend and the dashboard.
 * Mirrored (by hand) in frontend/lib/types.ts — keep the two in sync.
 *
 * All times are milliseconds since epoch. `simTime` is the *simulation* clock
 * (accelerated by the speed multiplier); `wallTime` is the real host clock.
 */

export type SatId = 'SOMAIYASAT' | 'SOMAIYAPOD';

export type SystemStatus = 'NOMINAL' | 'DEGRADED' | 'ANOMALY';

export type Severity = 'INFO' | 'WARN' | 'CRITICAL' | 'SUCCESS';

export type RadioMode = 'FM_VOICE' | 'APRS_DIGI' | 'SSTV' | 'CW_BEACON';

export type RouteId = 'DIRECT' | 'RELAY_POD' | 'STORE_FORWARD';

export type AnomalyKind =
  | 'LINK_DEGRADATION'
  | 'PACKET_LOSS_SPIKE'
  | 'BATTERY_DIP'
  | 'THERMAL_EXCURSION'
  | 'OBC_RESET';

/* ------------------------------------------------------------------ clock */

export interface ClockState {
  simTime: number;
  wallTime: number;
  speed: number;
  /** Seconds of simulated time elapsed since the mission epoch. */
  missionElapsed: number;
}

/* ------------------------------------------------------------------ orbit */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface LookAngles {
  /** Degrees above the local horizon; negative means below the horizon. */
  elevation: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Slant range, km. */
  range: number;
  /** Range rate, km/s. Positive = receding. */
  rangeRate: number;
  visible: boolean;
}

export interface SatelliteState {
  id: SatId;
  name: string;
  lat: number;
  lon: number;
  /** Altitude above the reference ellipsoid, km. */
  altitude: number;
  /** Orbital speed, km/s. */
  velocity: number;
  /** Radius of the visible ground footprint, metres (for Leaflet circles). */
  footprintRadius: number;
  sunlit: boolean;
  /** ECI position, km — used for inter-satellite geometry. */
  eci: { x: number; y: number; z: number };
  look: LookAngles;
  /** Ground track: past positions (trail) and future positions (prediction). */
  track: GeoPoint[];
  futureTrack: GeoPoint[];
  orbitNumber: number;
}

export interface PassPrediction {
  /** Acquisition of signal, sim-time ms. Null when none found in the horizon. */
  aos: number | null;
  /** Loss of signal, sim-time ms. */
  los: number | null;
  /** Peak elevation of the upcoming/current pass, degrees. */
  maxElevation: number;
  /** True while the satellite is above the ground station horizon right now. */
  inPass: boolean;
}

export interface OrbitFrame {
  clock: ClockState;
  satellites: SatelliteState[];
  groundStation: {
    name: string;
    lat: number;
    lon: number;
    altitude: number;
    minElevation: number;
  };
  /** Great-circle separation between the two spacecraft, km. */
  interSatRange: number;
  /** False when Earth blocks the SomaiyaSat ⇄ SomaiyaPod line of sight. */
  interSatLos: boolean;
  pass: PassPrediction;
}

/* -------------------------------------------------------------- telemetry */

export interface PowerTelemetry {
  /** Pack voltage of the 2S Li-ion battery, V. */
  batteryVoltage: number;
  /** State of charge, %. */
  stateOfCharge: number;
  /** Net battery current, A. Positive = charging. */
  batteryCurrent: number;
  /** Per-face solar array current, A. */
  solarCurrents: { face: string; current: number }[];
  solarPowerIn: number;
  loadPower: number;
  charging: boolean;
  eclipse: boolean;
  /** Battery temperature echoed here for the power panel, °C. */
  batteryTemp: number;
}

export interface ThermalTelemetry {
  sensors: { id: string; label: string; value: number; min: number; max: number }[];
}

export interface AttitudeTelemetry {
  pitch: number;
  roll: number;
  yaw: number;
  /** Total body rate, deg/s. */
  spinRate: number;
  rates: { x: number; y: number; z: number };
  quaternion: { w: number; x: number; y: number; z: number };
  mode: 'DETUMBLE' | 'COARSE_POINT' | 'FINE_POINT';
  /** Pointing error against the nadir/ground-station target, degrees. */
  pointingError: number;
}

export interface ObcTelemetry {
  /** Seconds since last (simulated) boot. */
  uptime: number;
  cpuLoad: number;
  memoryUse: number;
  rebootCount: number;
  watchdog: 'OK' | 'PETTED' | 'TRIPPED';
  /** Free space on the payload data store, %. */
  storageFree: number;
  lastResetReason: string;
}

export interface TelemetryFrame {
  clock: ClockState;
  power: PowerTelemetry;
  thermal: ThermalTelemetry;
  attitude: AttitudeTelemetry;
  obc: ObcTelemetry;
  status: SystemStatus;
}

/* ------------------------------------------------------------------ radio */

export interface RadioModeSpec {
  mode: RadioMode;
  label: string;
  /** Downlink centre frequency, MHz. */
  downlink: number;
  /** Uplink centre frequency, MHz (equal to downlink for simplex beacons). */
  uplink: number;
  band: '2m' | '70cm';
  txPower: number;
  bandwidth: number;
  modulation: string;
  description: string;
}

export interface RadioFrame {
  clock: ClockState;
  mode: RadioMode;
  spec: RadioModeSpec;
  transmitting: boolean;
  /** Received signal strength at the ground station, dBm. Null below horizon. */
  rssi: number | null;
  snr: number | null;
  /** Doppler shift on the downlink, Hz. Null below horizon. */
  doppler: number | null;
  /** Doppler-corrected receive frequency, MHz. */
  correctedFrequency: number | null;
  /** Free-space path loss on the current slant range, dB. */
  pathLoss: number | null;
  linkMargin: number | null;
  elevation: number;
  azimuth: number;
  range: number;
  /** Rolling RSSI strip-chart samples, oldest first. */
  history: { t: number; rssi: number | null; snr: number | null }[];
  /** Simulated 64-bin spectrum for the waterfall, dBm. */
  spectrum: number[];
  beaconText: string;
  pass: PassPrediction;
  degraded: boolean;
}

/* ---------------------------------------------------------------- routing */

export interface RouteScore {
  route: RouteId;
  label: string;
  score: number;
  /** Softmax-normalised probability across candidate routes, 0–1. */
  probability: number;
  feasible: boolean;
  factors: { name: string; value: number; weight: number; contribution: number }[];
  estLatency: number;
  estPacketLoss: number;
  note: string;
}

export interface RoutingDecisionDto {
  id: string;
  simTime: number;
  route: RouteId;
  label: string;
  confidence: number;
  estLatency: number;
  estPacketLoss: number;
  reasoning: string;
  candidates: RouteScore[];
  queueDepth: number;
  changed: boolean;
}

export interface PacketEvent {
  id: string;
  /** Graph edge the packet animates along. */
  from: 'SOMAIYASAT' | 'SOMAIYAPOD' | 'GROUND';
  to: 'SOMAIYASAT' | 'SOMAIYAPOD' | 'GROUND';
  /** Milliseconds the frontend should take to animate this hop. */
  durationMs: number;
  lost: boolean;
  simTime: number;
}

export interface LinkQuality {
  id: 'SAT_GS' | 'POD_GS' | 'SAT_POD';
  up: boolean;
  /** 0–1 normalised quality used for edge opacity/colour. */
  quality: number;
  marginDb: number;
  latencyMs: number;
  packetLoss: number;
}

export interface RoutingFrame {
  clock: ClockState;
  decision: RoutingDecisionDto;
  links: LinkQuality[];
  packets: PacketEvent[];
  queueDepth: number;
  /** Exponentially-weighted historical packet loss, 0–1. */
  historicalLoss: number;
  throughput: number;
  activeAnomaly: ActiveAnomaly | null;
  recentDecisions: RoutingDecisionDto[];
}

export interface ActiveAnomaly {
  kind: AnomalyKind;
  label: string;
  startedAt: number;
  endsAt: number;
  severity: Severity;
  description: string;
}

/* --------------------------------------------------------------- commands */

export type CommandType =
  | 'SET_RADIO_MODE'
  | 'FORCE_ROUTE_EVAL'
  | 'TRIGGER_ANOMALY'
  | 'CLEAR_ANOMALY'
  | 'RESET_SIM'
  | 'SET_SIM_SPEED'
  | 'SKIP_TO_AOS';

export type CommandStatus = 'PENDING' | 'ACKED' | 'REJECTED';

export interface CommandDto {
  id: string;
  type: CommandType;
  params: Record<string, unknown>;
  status: CommandStatus;
  issuedAt: number;
  simTime: number;
  ackAt: number | null;
  /** Simulated uplink round-trip delay, ms. */
  uplinkDelay: number;
  result: string | null;
}

/* ----------------------------------------------------------------- events */

export interface EventDto {
  id: string;
  simTime: number;
  severity: Severity;
  source: 'TELEMETRY' | 'RADIO' | 'ROUTING' | 'COMMAND' | 'SYSTEM';
  message: string;
  data?: Record<string, unknown>;
}

/* --------------------------------------------------------------- snapshot */

export interface SnapshotFrame {
  orbit: OrbitFrame;
  telemetry: TelemetryFrame;
  radio: RadioFrame;
  routing: RoutingFrame;
  events: EventDto[];
  commands: CommandDto[];
  mission: {
    name: string;
    designator: string;
    operator: string;
    epoch: number;
    persistence: 'POSTGRES' | 'MEMORY';
  };
}
