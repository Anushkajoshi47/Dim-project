/**
 * Wire types received from the simulation backend.
 * Mirrors backend/src/types.ts — keep the two in sync.
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

export interface ClockState {
  simTime: number;
  wallTime: number;
  speed: number;
  missionElapsed: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface LookAngles {
  elevation: number;
  azimuth: number;
  range: number;
  rangeRate: number;
  visible: boolean;
}

export interface SatelliteState {
  id: SatId;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  velocity: number;
  footprintRadius: number;
  sunlit: boolean;
  eci: { x: number; y: number; z: number };
  look: LookAngles;
  track: GeoPoint[];
  futureTrack: GeoPoint[];
  orbitNumber: number;
}

export interface PassPrediction {
  aos: number | null;
  los: number | null;
  maxElevation: number;
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
  interSatRange: number;
  interSatLos: boolean;
  pass: PassPrediction;
}

export interface PowerTelemetry {
  batteryVoltage: number;
  stateOfCharge: number;
  batteryCurrent: number;
  solarCurrents: { face: string; current: number }[];
  solarPowerIn: number;
  loadPower: number;
  charging: boolean;
  eclipse: boolean;
  batteryTemp: number;
}

export interface ThermalTelemetry {
  sensors: { id: string; label: string; value: number; min: number; max: number }[];
}

export interface AttitudeTelemetry {
  pitch: number;
  roll: number;
  yaw: number;
  spinRate: number;
  rates: { x: number; y: number; z: number };
  quaternion: { w: number; x: number; y: number; z: number };
  mode: 'DETUMBLE' | 'COARSE_POINT' | 'FINE_POINT';
  pointingError: number;
}

export interface ObcTelemetry {
  uptime: number;
  cpuLoad: number;
  memoryUse: number;
  rebootCount: number;
  watchdog: 'OK' | 'PETTED' | 'TRIPPED';
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

export interface RadioModeSpec {
  mode: RadioMode;
  label: string;
  downlink: number;
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
  rssi: number | null;
  snr: number | null;
  doppler: number | null;
  correctedFrequency: number | null;
  pathLoss: number | null;
  linkMargin: number | null;
  elevation: number;
  azimuth: number;
  range: number;
  history: { t: number; rssi: number | null; snr: number | null }[];
  spectrum: number[];
  beaconText: string;
  pass: PassPrediction;
  degraded: boolean;
}

export interface RouteScore {
  route: RouteId;
  label: string;
  score: number;
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
  from: 'SOMAIYASAT' | 'SOMAIYAPOD' | 'GROUND';
  to: 'SOMAIYASAT' | 'SOMAIYAPOD' | 'GROUND';
  durationMs: number;
  lost: boolean;
  simTime: number;
}

export interface LinkQuality {
  id: 'SAT_GS' | 'POD_GS' | 'SAT_POD';
  up: boolean;
  quality: number;
  marginDb: number;
  latencyMs: number;
  packetLoss: number;
}

export interface ActiveAnomaly {
  kind: AnomalyKind;
  label: string;
  startedAt: number;
  endsAt: number;
  severity: Severity;
  description: string;
}

export interface RoutingFrame {
  clock: ClockState;
  decision: RoutingDecisionDto;
  links: LinkQuality[];
  packets: PacketEvent[];
  queueDepth: number;
  historicalLoss: number;
  throughput: number;
  activeAnomaly: ActiveAnomaly | null;
  recentDecisions: RoutingDecisionDto[];
}

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
  uplinkDelay: number;
  result: string | null;
}

export interface EventDto {
  id: string;
  simTime: number;
  severity: Severity;
  source: 'TELEMETRY' | 'RADIO' | 'ROUTING' | 'COMMAND' | 'SYSTEM';
  message: string;
  data?: Record<string, unknown>;
}

export interface MissionInfo {
  name: string;
  designator: string;
  operator: string;
  epoch: number;
  persistence: 'POSTGRES' | 'MEMORY';
}

export interface SnapshotFrame {
  orbit: OrbitFrame;
  telemetry: TelemetryFrame;
  radio: RadioFrame;
  routing: RoutingFrame;
  events: EventDto[];
  commands: CommandDto[];
  mission: MissionInfo;
}

/** Row shape returned by GET /api/history/:channel. */
export interface HistorySample {
  simTime: number;
  data: Record<string, number | string | boolean>;
}