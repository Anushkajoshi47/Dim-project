/**
 * Orbit engine — turns the raw propagator in `orbit.ts` into the per-tick
 * `OrbitFrame` the dashboard consumes, and is the authoritative source of the
 * eclipse flag and ground-station elevation that the telemetry, radio and
 * routing engines are all driven from.
 */

import { config } from '../config';
import type { OrbitFrame, PassPrediction, SatelliteState } from '../types';
import { SimClock } from './clock';
import {
  footprintRadius,
  groundTrack,
  interSatelliteLos,
  lookAngles,
  predictPass,
  propagate,
  solveOverheadPass,
  type OrbitElements,
  type PropagatedState,
} from './orbit';

interface SatRuntime {
  id: SatelliteState['id'];
  name: string;
  elements: OrbitElements;
  state: PropagatedState;
  look: ReturnType<typeof lookAngles>;
  pass: PassPrediction;
  track: { lat: number; lon: number }[];
  futureTrack: { lat: number; lon: number }[];
}

export class OrbitEngine {
  private sats: SatRuntime[];
  private lastTrackBuild = 0;
  private lastPassBuild = 0;

  constructor(private clock: SimClock) {
    const now = clock.now();

    // Orient the whole constellation so SomaiyaSat makes an overhead pass a few
    // simulated minutes after the epoch. The configured RAAN/phase values are
    // treated as *relative* geometry and preserved as offsets from the primary,
    // which keeps the inter-satellite range where it was designed.
    const primary = config.satellites[0];
    const solved = solveOverheadPass(
      primary.inclination,
      primary.periodMinutes,
      now + config.firstPassOffsetSec * 1000,
      clock.epoch,
    );

    this.sats = config.satellites.map((s) => {
      const elements: OrbitElements = {
        altitude: s.altitude,
        inclination: s.inclination,
        raan: solved.raan + (s.raan - primary.raan),
        periodMinutes: s.periodMinutes,
        phase: solved.phase + (s.phase - primary.phase),
      };
      return {
        id: s.id,
        name: s.name,
        elements,
        state: propagate(elements, now, clock.epoch),
        look: lookAngles(elements, now, clock.epoch),
        pass: predictPass(elements, now, clock.epoch),
        track: [],
        futureTrack: [],
      };
    });
    this.rebuildTracks(now);
    this.lastTrackBuild = Date.now();
    this.lastPassBuild = Date.now();
  }

  /** Primary spacecraft — the one the radio payload flies on. */
  get primary(): SatRuntime {
    return this.sats[0];
  }

  get relay(): SatRuntime {
    return this.sats[1];
  }

  elementsFor(id: string): OrbitElements | undefined {
    return this.sats.find((s) => s.id === id)?.elements;
  }

  private rebuildTracks(now: number): void {
    for (const sat of this.sats) {
      sat.track = groundTrack(
        sat.elements,
        now - config.track.trailSeconds * 1000,
        now,
        this.clock.epoch,
      );
      sat.futureTrack = groundTrack(
        sat.elements,
        now,
        now + config.track.futureSeconds * 1000,
        this.clock.epoch,
      );
    }
  }

  /** Advance the engine and produce the frame for this tick. */
  tick(): OrbitFrame {
    const now = this.clock.now();
    const wall = Date.now();

    for (const sat of this.sats) {
      sat.state = propagate(sat.elements, now, this.clock.epoch);
      sat.look = lookAngles(sat.elements, now, this.clock.epoch);
    }

    // Pass prediction sweeps a 6 h horizon, so refresh it on a slower cadence
    // than the 1 Hz frame — or immediately when a cached crossing has expired.
    const passStale =
      wall - this.lastPassBuild > 10_000 ||
      this.sats.some(
        (s) =>
          (s.pass.aos !== null && s.pass.aos < now) ||
          (s.pass.los !== null && s.pass.los < now) ||
          s.pass.inPass !== s.look.elevation >= config.groundStation.minElevation,
      );
    if (passStale) {
      for (const sat of this.sats) {
        sat.pass = predictPass(sat.elements, now, this.clock.epoch);
      }
      this.lastPassBuild = wall;
    }

    // Ground tracks only need to move at map-refresh resolution.
    if (wall - this.lastTrackBuild > 5000) {
      this.rebuildTracks(now);
      this.lastTrackBuild = wall;
    }

    const isl = interSatelliteLos(this.primary.state.eci, this.relay.state.eci);

    const satellites: SatelliteState[] = this.sats.map((sat) => ({
      id: sat.id,
      name: sat.name,
      lat: sat.state.lat,
      lon: sat.state.lon,
      altitude: sat.state.altitude,
      velocity: sat.state.velocity,
      footprintRadius: footprintRadius(sat.state.altitude, config.groundStation.minElevation),
      sunlit: sat.state.sunlit,
      eci: sat.state.eci,
      look: sat.look,
      track: sat.track,
      futureTrack: sat.futureTrack,
      orbitNumber: sat.state.orbitNumber,
    }));

    return {
      clock: this.clock.state(),
      satellites,
      groundStation: {
        name: config.groundStation.name,
        lat: config.groundStation.lat,
        lon: config.groundStation.lon,
        altitude: config.groundStation.altitude,
        minElevation: config.groundStation.minElevation,
      },
      interSatRange: isl.range,
      interSatLos: isl.los,
      pass: this.primary.pass,
    };
  }

  /** Force a track + pass rebuild (used after a sim reset or speed change). */
  invalidate(): void {
    this.rebuildTracks(this.clock.now());
    this.lastTrackBuild = Date.now();
    this.lastPassBuild = 0;
  }
}