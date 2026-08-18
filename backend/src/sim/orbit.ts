/**
 * Simplified circular-orbit propagator.
 *
 * SCOPE: this is deliberately *not* SGP4. It models a circular orbit defined by
 * altitude / inclination / RAAN / period / epoch phase, with sun-synchronous
 * nodal precession, an Earth-rotation-corrected ground track, a cylindrical
 * eclipse model and topocentric look angles for a fixed ground station. That is
 * accurate enough for a ground track, pass predictions and a link budget at the
 * fidelity this demo needs.
 *
 * Everything celestial lives in this file. To swap in a real propagator later,
 * replace `propagate()` (and `groundTrack()`, which just calls it) — every
 * other engine consumes only the `PropagatedState` it returns.
 */

import { config } from '../config';
import type { GeoPoint, LookAngles, PassPrediction } from '../types';

export const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface OrbitElements {
  altitude: number;
  inclination: number;
  raan: number;
  periodMinutes: number;
  phase: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PropagatedState {
  /** Earth-centred inertial position, km. */
  eci: Vec3;
  /** Earth-centred Earth-fixed position, km. */
  ecef: Vec3;
  lat: number;
  lon: number;
  altitude: number;
  velocity: number;
  sunlit: boolean;
  /** Angle between the sun vector and the orbital position, deg. */
  sunAngle: number;
  /** Completed orbits since epoch, 1-based. */
  orbitNumber: number;
  /** Argument of latitude, deg — drives the orbit-phase heating term. */
  argLat: number;
}

/* ------------------------------------------------------------- time bases */

/** Julian date from a Unix millisecond timestamp. */
export function julianDate(ms: number): number {
  return ms / 86400000 + 2440587.5;
}

/** Greenwich Mean Sidereal Time, degrees [0, 360). */
export function gmst(ms: number): number {
  const jd = julianDate(ms);
  const t = (jd - 2451545.0) / 36525;
  const seconds =
    67310.54841 +
    (876600 * 3600 + 8640184.812866) * t +
    0.093104 * t * t -
    6.2e-6 * t * t * t;
  // 240 seconds of sidereal time per degree.
  return (((seconds / 240) % 360) + 360) % 360;
}

/**
 * Unit sun vector in ECI. Low-precision almanac formula (~0.01° accuracy),
 * which is far tighter than the eclipse geometry needs.
 */
export function sunVector(ms: number): Vec3 {
  const n = julianDate(ms) - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) * DEG;
  const meanAnom = (357.528 + 0.9856003 * n) * DEG;
  const eclipticLon =
    meanLon + 1.915 * DEG * Math.sin(meanAnom) + 0.02 * DEG * Math.sin(2 * meanAnom);
  const obliquity = (23.439 - 4e-7 * n) * DEG;
  return {
    x: Math.cos(eclipticLon),
    y: Math.cos(obliquity) * Math.sin(eclipticLon),
    z: Math.sin(obliquity) * Math.sin(eclipticLon),
  };
}

/* ---------------------------------------------------------- vector helpers */

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3) => Math.sqrt(dot(a, a));
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

/* ---------------------------------------------------------------- core sim */

/**
 * Propagate one spacecraft to `simTime` (Unix ms on the simulation clock).
 */
export function propagate(el: OrbitElements, simTime: number, epoch: number): PropagatedState {
  const periodSec = el.periodMinutes * 60;
  const elapsedSec = (simTime - epoch) / 1000;
  const r = EARTH_RADIUS_KM + el.altitude;

  // Argument of latitude sweeps a full turn every orbital period.
  const argLatDeg = el.phase + (360 * elapsedSec) / periodSec;
  const u = argLatDeg * DEG;

  // Sun-synchronous nodal regression: the ascending node drifts ~1°/day east
  // so the orbit plane keeps a fixed angle to the sun.
  const raanDeg = el.raan + (0.9856 * elapsedSec) / 86400;
  const raan = raanDeg * DEG;
  const inc = el.inclination * DEG;

  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const eci: Vec3 = {
    x: r * (Math.cos(raan) * cosU - Math.sin(raan) * sinU * Math.cos(inc)),
    y: r * (Math.sin(raan) * cosU + Math.cos(raan) * sinU * Math.cos(inc)),
    z: r * (sinU * Math.sin(inc)),
  };

  // ECI -> ECEF is a rotation of -GMST about the polar axis.
  const theta = gmst(simTime) * DEG;
  const ecef: Vec3 = {
    x: eci.x * Math.cos(theta) + eci.y * Math.sin(theta),
    y: -eci.x * Math.sin(theta) + eci.y * Math.cos(theta),
    z: eci.z,
  };

  const lat = Math.asin(ecef.z / r) * RAD;
  let lon = Math.atan2(ecef.y, ecef.x) * RAD;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;

  const sun = sunVector(simTime);
  const projection = dot(eci, sun);
  // Cylindrical shadow: in eclipse when behind Earth *and* inside its shadow tube.
  const perpendicular = norm(sub(eci, scale(sun, projection)));
  const sunlit = projection > 0 || perpendicular > EARTH_RADIUS_KM;
  const sunAngle = Math.acos(Math.max(-1, Math.min(1, projection / r))) * RAD;

  return {
    eci,
    ecef,
    lat,
    lon,
    altitude: el.altitude,
    velocity: (2 * Math.PI * r) / periodSec,
    sunlit,
    sunAngle,
    orbitNumber: Math.floor(elapsedSec / periodSec) + 1,
    argLat: ((argLatDeg % 360) + 360) % 360,
  };
}

/**
 * Solve for the RAAN and epoch phase that put a spacecraft directly over the
 * ground station at `targetTime`.
 *
 * Without this the orbit plane's orientation relative to Mumbai depends on when
 * the process happened to start, so the first usable pass could be five
 * simulated hours away — fine physically, useless for a live demo. Solving the
 * geometry keeps the constellation's *relative* configuration untouched while
 * guaranteeing an overhead pass a few minutes in.
 *
 * From the position equations, the right ascension of a circular orbit is
 * `Ω + atan2(sin u · cos i, cos u)`, and geographic longitude is that minus
 * GMST — which inverts directly for Ω once the argument of latitude `u` needed
 * to reach the station's latitude is known.
 */
export function solveOverheadPass(
  inclinationDeg: number,
  periodMinutes: number,
  targetTime: number,
  epoch: number,
  gs = config.groundStation,
): { raan: number; phase: number } {
  const inc = inclinationDeg * DEG;
  // Highest latitude the ground track ever reaches.
  const reachable = Math.abs(Math.sin(gs.lat * DEG) / Math.sin(inc));
  if (reachable > 1) {
    // Station is outside the ground-track latitude band — best we can do is the
    // extreme of the track. (Not reachable for Mumbai at 97.5° inclination.)
    return { raan: gs.lon, phase: 90 };
  }

  // Ascending-node crossing that reaches the station latitude.
  const u = Math.asin(Math.sin(gs.lat * DEG) / Math.sin(inc));
  const deltaLon = Math.atan2(Math.sin(u) * Math.cos(inc), Math.cos(u)) * RAD;

  const elapsedSec = (targetTime - epoch) / 1000;
  // Undo the nodal precession that propagate() will have applied by targetTime.
  const drift = (0.9856 * elapsedSec) / 86400;
  const raan = gs.lon + gmst(targetTime) - deltaLon - drift;
  const phase = u * RAD - (360 * elapsedSec) / (periodMinutes * 60);

  const wrap = (v: number) => ((v % 360) + 360) % 360;
  return { raan: wrap(raan), phase: wrap(phase) };
}

/** Ground-station position in ECEF, km. */
export function stationEcef(lat: number, lon: number, altKm: number): Vec3 {
  const r = EARTH_RADIUS_KM + altKm;
  return {
    x: r * Math.cos(lat * DEG) * Math.cos(lon * DEG),
    y: r * Math.cos(lat * DEG) * Math.sin(lon * DEG),
    z: r * Math.sin(lat * DEG),
  };
}

/** Topocentric east/north/up of an ECEF point relative to the ground station. */
function topocentric(ecef: Vec3, gs: typeof config.groundStation) {
  const site = stationEcef(gs.lat, gs.lon, gs.altitude);
  const rho = sub(ecef, site);

  const slat = Math.sin(gs.lat * DEG);
  const clat = Math.cos(gs.lat * DEG);
  const slon = Math.sin(gs.lon * DEG);
  const clon = Math.cos(gs.lon * DEG);

  return {
    east: -slon * rho.x + clon * rho.y,
    north: -slat * clon * rho.x - slat * slon * rho.y + clat * rho.z,
    up: clat * clon * rho.x + clat * slon * rho.y + slat * rho.z,
    range: norm(rho),
  };
}

/**
 * Elevation only, in degrees — one propagation instead of the three that full
 * look angles need. Pass prediction calls this thousands of times per sweep.
 */
export function elevationAt(
  el: OrbitElements,
  simTime: number,
  epoch: number,
  gs = config.groundStation,
): number {
  const { east, north, up } = topocentric(propagate(el, simTime, epoch).ecef, gs);
  return Math.atan2(up, Math.hypot(east, north)) * RAD;
}

/**
 * Topocentric look angles from the ground station to a propagated satellite.
 * Range rate is a centred numerical derivative — good to ~1 mm/s here and
 * enough to drive a believable Doppler readout.
 */
export function lookAngles(
  el: OrbitElements,
  simTime: number,
  epoch: number,
  gs = config.groundStation,
): LookAngles {
  const state = propagate(el, simTime, epoch);
  const site = stationEcef(gs.lat, gs.lon, gs.altitude);
  const { east, north, up, range } = topocentric(state.ecef, gs);

  const elevation = Math.atan2(up, Math.hypot(east, north)) * RAD;
  let azimuth = Math.atan2(east, north) * RAD;
  if (azimuth < 0) azimuth += 360;

  // Centred difference over ±1 simulated second.
  const dt = 1000;
  const rPrev = norm(sub(propagate(el, simTime - dt, epoch).ecef, site));
  const rNext = norm(sub(propagate(el, simTime + dt, epoch).ecef, site));
  const rangeRate = (rNext - rPrev) / 2;

  return {
    elevation,
    azimuth,
    range,
    rangeRate,
    visible: elevation >= gs.minElevation,
  };
}

/** Radius of the visible ground footprint, metres (Leaflet wants metres). */
export function footprintRadius(altitudeKm: number, minElevationDeg = 0): number {
  const r = EARTH_RADIUS_KM;
  const rho = Math.asin(
    (r / (r + altitudeKm)) * Math.cos(minElevationDeg * DEG),
  );
  const central = Math.PI / 2 - minElevationDeg * DEG - rho;
  return Math.max(0, central * r * 1000);
}

/**
 * Sampled ground track between two sim times.
 * Points are emitted lat/lon; the frontend splits the polyline at the
 * antimeridian so the track doesn't smear across the map.
 */
export function groundTrack(
  el: OrbitElements,
  fromSim: number,
  toSim: number,
  epoch: number,
  stepSeconds = config.track.stepSeconds,
): GeoPoint[] {
  const points: GeoPoint[] = [];
  const stepMs = stepSeconds * 1000;
  for (let t = fromSim; t <= toSim; t += stepMs) {
    const s = propagate(el, t, epoch);
    points.push({ lat: s.lat, lon: s.lon });
  }
  return points;
}

/**
 * Next acquisition/loss of signal for the ground station.
 *
 * Coarse 30 s scan for a horizon crossing, then bisection to 1 s.
 *
 * The horizon is 30 simulated hours, not one orbit. A sun-synchronous ground
 * track shifts ~24° of longitude west every revolution, so a single station
 * does *not* get a pass every orbit — real passes come in clusters of two or
 * three followed by gaps of ten hours or more. A short search window would
 * report "no pass" for most of the mission, which is why this sweeps well past
 * a full day to guarantee it finds the next one.
 */
export function predictPass(
  el: OrbitElements,
  simTime: number,
  epoch: number,
  gs = config.groundStation,
): PassPrediction {
  /** Elevation above the station's usable minimum; zero-crossings are AOS/LOS. */
  const margin = (t: number) => elevationAt(el, t, epoch, gs) - gs.minElevation;
  const coarse = 30_000;
  const horizon = 30 * 3600_000;

  const bisect = (lo: number, hi: number) => {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 24 && b - a > 1000; i += 1) {
      const mid = (a + b) / 2;
      if (Math.sign(margin(a)) === Math.sign(margin(mid))) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };

  const inPass = margin(simTime) > 0;
  let aos: number | null = null;
  let los: number | null = null;

  let prevT = simTime;
  let prevE = margin(simTime);

  for (let t = simTime + coarse; t <= simTime + horizon; t += coarse) {
    const e = margin(t);
    if (prevE <= 0 && e > 0 && aos === null && !inPass) {
      aos = bisect(prevT, t);
    }
    if (prevE > 0 && e <= 0) {
      los = bisect(prevT, t);
      // Stop at the LOS that closes the current pass, or the one that closes
      // the upcoming pass we just found the AOS for.
      if (inPass || aos !== null) break;
    }
    prevT = t;
    prevE = e;
  }

  // Peak elevation across the located pass window.
  let maxElevation = inPass ? margin(simTime) + gs.minElevation : 0;
  const start = inPass ? simTime : aos;
  if (start !== null && los !== null && los > start) {
    for (let t = start; t <= los; t += 15_000) {
      const e = elevationAt(el, t, epoch, gs);
      if (e > maxElevation) maxElevation = e;
    }
  }

  return { aos: inPass ? null : aos, los, maxElevation, inPass };
}

/**
 * Line-of-sight between the two spacecraft.
 * Blocked when the chord between them passes within one Earth radius plus a
 * 100 km atmospheric margin of the geocentre.
 */
export function interSatelliteLos(a: Vec3, b: Vec3): { range: number; los: boolean } {
  const d = sub(b, a);
  const len = norm(d);
  // Parameter of closest approach of segment AB to the origin.
  const t = Math.max(0, Math.min(1, -dot(a, d) / (len * len)));
  const closest = norm({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });
  return { range: len, los: closest > EARTH_RADIUS_KM + 100 };
}

/** Great-circle distance between two ground points, km. */
export function greatCircle(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Free-space path loss, dB, for a slant range in km and frequency in MHz. */
export function freeSpacePathLoss(rangeKm: number, freqMhz: number): number {
  return 32.44 + 20 * Math.log10(Math.max(rangeKm, 0.001)) + 20 * Math.log10(freqMhz);
}
