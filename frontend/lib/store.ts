'use client';

import { create } from 'zustand';
import type {
  CommandDto,
  EventDto,
  HistorySample,
  MissionInfo,
  OrbitFrame,
  PacketEvent,
  RadioFrame,
  RoutingFrame,
  SnapshotFrame,
  TelemetryFrame,
} from './types';

/**
 * Client state.
 *
 * Live frames are replaced wholesale on every socket message. Chart series are
 * kept separately as rolling buffers: they are seeded from the REST history
 * endpoint on mount (so a page refresh does not start from an empty chart) and
 * then extended by the live frames.
 */

/** Points retained per chart series. At 1 Hz this is ~15 min of wall time. */
const CHART_POINTS = 900;

export interface PowerPoint {
  t: number;
  voltage: number;
  soc: number;
  solar: number;
  load: number;
  eclipse: number;
}

export interface ThermalPoint {
  t: number;
  TEMP_BAT: number;
  TEMP_OBC: number;
  TEMP_RF: number;
  TEMP_STR: number;
}

export interface AttitudePoint {
  t: number;
  pitch: number;
  roll: number;
  yaw: number;
  spinRate: number;
}

/** A packet in flight on the link graph, with the wall-clock time it started. */
export interface FlightPacket extends PacketEvent {
  startedAt: number;
}

interface MissionState {
  connected: boolean;
  ready: boolean;
  mission: MissionInfo | null;

  orbit: OrbitFrame | null;
  telemetry: TelemetryFrame | null;
  radio: RadioFrame | null;
  routing: RoutingFrame | null;

  events: EventDto[];
  commands: CommandDto[];

  powerHistory: PowerPoint[];
  thermalHistory: ThermalPoint[];
  attitudeHistory: AttitudePoint[];

  packets: FlightPacket[];

  setConnected: (v: boolean) => void;
  applySnapshot: (s: SnapshotFrame) => void;
  applyOrbit: (f: OrbitFrame) => void;
  applyTelemetry: (f: TelemetryFrame) => void;
  applyRadio: (f: RadioFrame) => void;
  applyRouting: (f: RoutingFrame) => void;
  pushEvent: (e: EventDto) => void;
  upsertCommand: (c: CommandDto) => void;
  seedHistory: (channel: 'power' | 'thermal' | 'attitude', rows: HistorySample[]) => void;
  reapPackets: () => void;
}

const cap = <T,>(arr: T[]) => (arr.length > CHART_POINTS ? arr.slice(arr.length - CHART_POINTS) : arr);

/** Guards against duplicate x-values when history seeding overlaps live frames. */
const appendPoint = <T extends { t: number }>(series: T[], point: T): T[] => {
  const last = series[series.length - 1];
  if (last && point.t <= last.t) return series;
  return cap([...series, point]);
};

const numeric = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const useMissionStore = create<MissionState>((set) => ({
  connected: false,
  ready: false,
  mission: null,

  orbit: null,
  telemetry: null,
  radio: null,
  routing: null,

  events: [],
  commands: [],

  powerHistory: [],
  thermalHistory: [],
  attitudeHistory: [],

  packets: [],

  setConnected: (v) => set({ connected: v }),

  applySnapshot: (s) =>
    set({
      ready: true,
      mission: s.mission,
      orbit: s.orbit,
      telemetry: s.telemetry,
      radio: s.radio,
      routing: s.routing,
      events: s.events,
      commands: s.commands,
    }),

  applyOrbit: (f) => set({ orbit: f }),

  applyTelemetry: (f) =>
    set((state) => ({
      telemetry: f,
      powerHistory: appendPoint(state.powerHistory, {
        t: f.clock.simTime,
        voltage: f.power.batteryVoltage,
        soc: f.power.stateOfCharge,
        solar: f.power.solarPowerIn,
        load: f.power.loadPower,
        eclipse: f.power.eclipse ? 1 : 0,
      }),
      thermalHistory: appendPoint(state.thermalHistory, {
        t: f.clock.simTime,
        TEMP_BAT: f.thermal.sensors.find((s) => s.id === 'TEMP_BAT')?.value ?? 0,
        TEMP_OBC: f.thermal.sensors.find((s) => s.id === 'TEMP_OBC')?.value ?? 0,
        TEMP_RF: f.thermal.sensors.find((s) => s.id === 'TEMP_RF')?.value ?? 0,
        TEMP_STR: f.thermal.sensors.find((s) => s.id === 'TEMP_STR')?.value ?? 0,
      }),
      attitudeHistory: appendPoint(state.attitudeHistory, {
        t: f.clock.simTime,
        pitch: f.attitude.pitch,
        roll: f.attitude.roll,
        yaw: f.attitude.yaw,
        spinRate: f.attitude.spinRate,
      }),
    })),

  applyRadio: (f) => set({ radio: f }),

  applyRouting: (f) =>
    set((state) => ({
      routing: f,
      // Stamp with wall time so the animation layer can age packets out
      // independently of the simulation clock.
      packets: [
        ...state.packets,
        ...f.packets.map((p) => ({ ...p, startedAt: Date.now() })),
      ].slice(-40),
    })),

  pushEvent: (e) =>
    set((state) => ({
      events: state.events.some((x) => x.id === e.id)
        ? state.events
        : [...state.events, e].slice(-400),
    })),

  upsertCommand: (c) =>
    set((state) => {
      const idx = state.commands.findIndex((x) => x.id === c.id);
      if (idx >= 0) {
        const next = [...state.commands];
        next[idx] = c;
        return { commands: next };
      }
      return { commands: [...state.commands, c].slice(-60) };
    }),

  seedHistory: (channel, rows) =>
    set(() => {
      if (channel === 'power') {
        return {
          powerHistory: cap(
            rows.map((r) => ({
              t: r.simTime,
              voltage: numeric(r.data.batteryVoltage),
              soc: numeric(r.data.stateOfCharge),
              solar: numeric(r.data.solarPowerIn),
              load: numeric(r.data.loadPower),
              eclipse: r.data.eclipse ? 1 : 0,
            })),
          ),
        };
      }
      if (channel === 'thermal') {
        return {
          thermalHistory: cap(
            rows.map((r) => ({
              t: r.simTime,
              TEMP_BAT: numeric(r.data.TEMP_BAT),
              TEMP_OBC: numeric(r.data.TEMP_OBC),
              TEMP_RF: numeric(r.data.TEMP_RF),
              TEMP_STR: numeric(r.data.TEMP_STR),
            })),
          ),
        };
      }
      return {
        attitudeHistory: cap(
          rows.map((r) => ({
            t: r.simTime,
            pitch: numeric(r.data.pitch),
            roll: numeric(r.data.roll),
            yaw: numeric(r.data.yaw),
            spinRate: numeric(r.data.spinRate),
          })),
        ),
      };
    }),

  reapPackets: () =>
    set((state) => {
      const now = Date.now();
      const live = state.packets.filter((p) => now - p.startedAt < p.durationMs + 200);
      return live.length === state.packets.length ? {} : { packets: live };
    }),
}));