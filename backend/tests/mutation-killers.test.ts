/**
 * MUTATION KILLERS — STQA lab, Step 5.
 *
 *   "If the original program and mutant program generate same output, the mutant
 *    is kept alive. In such cases, more effective test cases need to be created
 *    that kill all mutants."
 *
 * Every test in this file exists to kill one specific mutant that SURVIVED the
 * first mutation run. They start out `it.skip(...)` on purpose, so the lab has a
 * before/after story:
 *
 *   1. `npm run mutation`            -> note the score and the survivor list
 *   2. un-skip ONE test below (change `it.skip` to `it`)
 *   3. `npm test`                    -> confirm it passes on unmutated source
 *   4. `npm run mutation -- --only <ID>`  -> that mutant is now KILLED
 *   5. repeat, then `npm run mutation` for the new, higher score
 *
 * Nothing in this file replaces or weakens an existing test — these are purely
 * additional cases that close gaps the existing suite could not see.
 *
 * NOTE: mutants M12, M17 and M21 are EQUIVALENT (see mutation/mutants.mjs).
 * No test appears here for them, because none can exist. Equivalent mutants are
 * detected by human reasoning, not by more tests, and are excluded from the
 * denominator of an honest mutation score.
 */

import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  EARTH_RADIUS_KM,
  greatCircle,
  propagate,
  type OrbitElements,
  type Vec3,
} from '../src/sim/orbit';
import { HistoryStore, history } from '../src/db/history';
import { api } from '../src/routes/api';
import { simulation } from '../src/sim/simulation';

/* ─────────────────────────────────────────────────────────────────── helpers */

/** SomaiyaSat, matching config.satellites[0]. */
const SAT: OrbitElements = {
  altitude: 525,
  inclination: 97.5,
  raan: 118.0,
  periodMinutes: 95.1,
  phase: 0,
};

const EPOCH = Date.UTC(2026, 0, 1);

/** Angle between two vectors, degrees. */
function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const mag = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  return app;
}

afterAll(() => {
  simulation.stop();
  history.stop();
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  M08 — src/sim/orbit.ts : EARTH_RADIUS_KM 6371.0088 -> 6371                 */
/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * Why the original suite missed it
 * --------------------------------
 * Every existing orbit assertion is written against EARTH_RADIUS_KM itself:
 *
 *     expect(r).toBeCloseTo(EARTH_RADIUS_KM + SAT.altitude, 6);
 *     expect(d).toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 3);
 *
 * The constant is simultaneously the code under test AND the oracle, so when the
 * mutant changes it, the expected value moves with it and the test still passes.
 * This is a TAUTOLOGICAL test — it can only ever prove the code agrees with
 * itself. Mutation testing is uniquely good at exposing these; line coverage
 * reports them as 100% covered.
 *
 * How these kill it
 * -----------------
 * By asserting against externally-sourced literals instead.
 */
describe('M08 killer — Earth radius must be pinned to an external value', () => {
  it.skip('matches the WGS-84 mean radius to four decimal places', () => {
    // 6371.0088 km is the IUGG mean radius R1. It is a published constant, not
    // something this codebase gets to define.
    expect(EARTH_RADIUS_KM).toBeCloseTo(6371.0088, 4);
  });

  it.skip('computes a quarter great circle against an independent literal', () => {
    // pi/2 * 6371.0088 = 10007.557221 km, computed outside this program.
    const quarter = greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 90 });
    expect(quarter).toBeCloseTo(10007.5572, 2);
  });

  it.skip('computes a full equatorial circumference against an independent literal', () => {
    // 2 * pi * 6371.0088 = 40030.228885 km.
    const half = greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(half * 2).toBeCloseTo(40030.2289, 2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  M14 — src/sim/orbit.ts : sun-synchronous nodal precession 0.9856 -> 0      */
/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * Why the original suite missed it
 * --------------------------------
 * Nodal regression is about 0.9856 degrees PER DAY. The longest span any existing
 * orbit test propagates over is a couple of orbits — roughly three hours — where
 * the drift is ~0.12 degrees, far inside every tolerance in the file. The
 * behaviour is real, documented and load-bearing (it is what makes the orbit
 * sun-synchronous), yet completely unverified.
 *
 * How these kill it
 * -----------------
 * By propagating over a horizon long enough for the drift to dominate.
 *
 * The trick: sample at an EXACT integer number of orbital periods. The argument
 * of latitude is then identical at both samples, so the only thing that can have
 * moved the spacecraft in inertial space is the RAAN drift. The angle between the
 * two ECI position vectors therefore reads out the accumulated precession
 * directly — and collapses to zero under the mutant.
 */
describe('M14 killer — the orbit plane must precess about 1 degree per day', () => {
  const periodMs = SAT.periodMinutes * 60 * 1000;

  it.skip('accumulates ~29.55 degrees of nodal drift over 454 orbits (~30 days)', () => {
    const orbits = 454; // 454 * 95.1 min = 29.98 days
    const a = propagate(SAT, EPOCH, EPOCH).eci;
    const b = propagate(SAT, EPOCH + orbits * periodMs, EPOCH).eci;

    // 0.9856 deg/day * 29.983 days = 29.551 deg
    expect(angleBetween(a, b)).toBeCloseTo(29.55, 1);
  });

  it.skip('scales the drift linearly with elapsed time', () => {
    const a = propagate(SAT, EPOCH, EPOCH).eci;
    const short = angleBetween(a, propagate(SAT, EPOCH + 200 * periodMs, EPOCH).eci);
    const long = angleBetween(a, propagate(SAT, EPOCH + 400 * periodMs, EPOCH).eci);

    expect(short).toBeGreaterThan(5);          // the drift is actually happening
    expect(long / short).toBeCloseTo(2, 1);    // and it is linear in time
  });

  it.skip('drifts the ascending node eastward, not westward', () => {
    // Sign matters: a westward drift would still produce a non-zero angle but
    // would break sun-synchronicity. Compare the RAAN-only rotation directly.
    const orbits = 454;
    const a = propagate(SAT, EPOCH, EPOCH).eci;
    const b = propagate(SAT, EPOCH + orbits * periodMs, EPOCH).eci;

    // At phase 0 the spacecraft sits on the node line, so the ECI longitude of
    // the position IS the RAAN. Cross product z-component > 0 means eastward.
    const crossZ = a.x * b.y - a.y * b.x;
    expect(crossZ).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  M24 — src/db/history.ts : window filter `simTime >= fromSim` -> `>`        */
/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * Why the original suite missed it
 * --------------------------------
 * A pure boundary-value gap. The existing test queries the window (1500, 2500)
 * against samples at 1000 / 2000 / 3000 — every sample is strictly inside or
 * strictly outside, so nothing ever lands ON a boundary and the difference
 * between `>=` and `>` is invisible.
 *
 * The bug is real: the dashboard backfills charts with `from = to - 30 min`, so
 * a sample written exactly on that instant would silently vanish from the chart.
 *
 * How these kill it
 * -----------------
 * Classic boundary value analysis — assert at from, from-1, to and to+1.
 */
describe('M24 killer — the history window must be inclusive at both ends', () => {
  it.skip('includes a sample landing exactly on `from`', async () => {
    const store = new HistoryStore();
    store.recordTelemetry('power', 1000, { soc: 80 });
    store.recordTelemetry('power', 2000, { soc: 79 });

    const rows = await store.queryTelemetry('power', 1000, 5000, 100);
    expect(rows).toHaveLength(2);
    expect(rows[0].data).toEqual({ soc: 80 });
    store.stop();
  });

  it.skip('includes a sample landing exactly on `to`', async () => {
    const store = new HistoryStore();
    store.recordTelemetry('power', 1000, { soc: 80 });
    store.recordTelemetry('power', 2000, { soc: 79 });

    const rows = await store.queryTelemetry('power', 0, 2000, 100);
    expect(rows).toHaveLength(2);
    store.stop();
  });

  it.skip('excludes samples one millisecond outside either bound', async () => {
    const store = new HistoryStore();
    store.recordTelemetry('power', 999, { tag: 'before' });
    store.recordTelemetry('power', 1000, { tag: 'on-from' });
    store.recordTelemetry('power', 2000, { tag: 'on-to' });
    store.recordTelemetry('power', 2001, { tag: 'after' });

    const rows = await store.queryTelemetry('power', 1000, 2000, 100);
    expect(rows.map((r) => r.data.tag)).toEqual(['on-from', 'on-to']);
    store.stop();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  M27 — src/routes/api.ts : Math.min(limit, 5000) -> Math.max(limit, 5000)   */
/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * Why the original suite missed it
 * --------------------------------
 * No existing API test ever sends a `?limit=` parameter, so the clamp expression
 * is only ever evaluated with its default (1500) — where min and max happen to
 * agree closely enough that nothing observable changes. A straight coverage gap:
 * the line is "covered", but its behaviour is never exercised.
 *
 * A note on what is NOT testable here
 * -----------------------------------
 * The 5000 UPPER cap is unreachable through the in-memory backend: the ring
 * buffer holds at most MEMORY_LIMIT (4000) rows, so `?limit=100000` and
 * `?limit=5000` return the same thing whether the code clamps or not. Proving
 * the upper cap needs Postgres attached (where it becomes Prisma's `take`), or a
 * refactor extracting the clamp into a pure `clampLimit()` helper that can be
 * unit-tested directly. That refactor is the response this finding really argues
 * for — see MUTATION-TESTING.md.
 *
 * How this kills it
 * -----------------
 * By exercising the DOWNWARD direction of the clamp, which the memory backend
 * can observe: ask for fewer rows than exist and check you get exactly that many.
 * Under `Math.max` the requested limit is discarded in favour of 5000, and every
 * stored row comes back.
 */
describe('M27 killer — an explicit ?limit= must be honoured', () => {
  const app = makeApp();

  it.skip('returns exactly the requested number of rows', async () => {
    await history.clear();
    for (let i = 1; i <= 100; i++) history.recordTelemetry('attitude', i * 10, { i });

    // from must be truthy — `Number('0') || fallback` would discard a literal 0.
    const res = await request(app).get('/api/history/attitude?from=1&to=999999999999&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(10);
    expect(res.body.samples).toHaveLength(10);

    await history.clear();
  });

  it.skip('returns the NEWEST rows when the limit truncates', async () => {
    await history.clear();
    for (let i = 1; i <= 100; i++) history.recordTelemetry('attitude', i * 10, { i });

    const res = await request(app).get('/api/history/attitude?from=1&to=999999999999&limit=5');

    expect(res.body.samples.map((s: any) => s.data.i)).toEqual([96, 97, 98, 99, 100]);

    await history.clear();
  });

  it.skip('returns everything when the limit exceeds the row count', async () => {
    await history.clear();
    for (let i = 1; i <= 20; i++) history.recordTelemetry('attitude', i * 10, { i });

    const res = await request(app).get('/api/history/attitude?from=1&to=999999999999&limit=500');

    expect(res.body.count).toBe(20);

    await history.clear();
  });
});
