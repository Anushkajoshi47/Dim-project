/**
 * MUTANT CATALOGUE — manual mutation testing (STQA lab, Step 1).
 *
 * "Faults are introduced into the source code of the program by creating many
 *  versions called mutants. Each mutant should contain a single fault."
 *
 * Every entry below is ONE mutant: one exact string in one source file, swapped
 * for one faulty replacement. The runner applies them strictly one at a time and
 * restores the file afterwards, so the program under test never contains more
 * than a single seeded fault at any moment.
 *
 * ── Field reference ────────────────────────────────────────────────────────────
 *   id        Stable identifier. Used by `npm run mutation -- --only M07`.
 *   file      Path relative to backend/.
 *   operator  Which classical mutation operator this is (see table below).
 *   find      EXACT source text to replace. Must occur exactly once in `file`;
 *             the runner aborts if it occurs zero times or more than once, so a
 *             refactor can never silently mutate the wrong line.
 *   replace   The faulty text.
 *   tests     Test file(s) run against this mutant. Narrower = faster and makes
 *             it obvious WHICH suite is responsible for catching the fault.
 *   expect    Our PREDICTION: 'killed' or 'survived'. The run decides the truth;
 *             a mismatch is itself an interesting result and is flagged in the
 *             report as a SURPRISE.
 *   note      Why this mutant exists / what it teaches.
 *
 * ── Mutation operators used ────────────────────────────────────────────────────
 *   AOR  Arithmetic Operator Replacement      + → -, * → /
 *   ROR  Relational Operator Replacement      > → <, >= → >
 *   COR  Conditional Operator Replacement     &&/||, negation
 *   SVR  Scalar Variable / literal Replacement 4000 → 5000
 *   SDL  Statement Deletion                    drop a guard or a term
 *   MCR  Method Call Replacement               Math.round → Math.floor
 *
 * ── Adding your own ────────────────────────────────────────────────────────────
 * Copy an entry, change `find`/`replace`, give it the next free id. Run
 * `npm run mutation -- --list` to check it resolves before doing a full run.
 */

/** @typedef {{id:string,file:string,operator:string,find:string,replace:string,tests:string[],expect:'killed'|'survived',note:string}} Mutant */

const NOISE = 'src/sim/noise.ts';
const ORBIT = 'src/sim/orbit.ts';
const CLOCK = 'src/sim/clock.ts';
const RADIO = 'src/sim/radio.ts';
const HISTORY = 'src/db/history.ts';
const API = 'src/routes/api.ts';

const T_NOISE = ['tests/unit/noise.test.ts'];
const T_ORBIT = ['tests/unit/orbit.test.ts'];
const T_CLOCK = ['tests/unit/clock.test.ts'];
const T_RADIO = ['tests/unit/radio.test.ts'];
const T_HISTORY = ['tests/unit/history.test.ts'];
const T_API = ['tests/integration/api.test.ts'];

/**
 * Step-5 killer tests. Appended to the test set of every mutant that is expected
 * to survive, so that un-skipping a killer immediately changes that mutant's
 * verdict from SURVIVED to KILLED on the next run.
 */
const T_KILL = 'tests/mutation-killers.test.ts';

/** @type {Mutant[]} */
export const MUTANTS = [
  /* ───────────────────────────────── src/sim/noise.ts ──────────────────────── */
  {
    id: 'M01',
    file: NOISE,
    operator: 'MCR — swap the clamp bounds',
    find: 'Math.min(hi, Math.max(lo, v))',
    replace: 'Math.max(hi, Math.min(lo, v))',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'clamp() is used by every engine to keep a physical quantity inside its ' +
      'legal band. Swapping min/max inverts the clamp entirely.',
  },
  {
    id: 'M02',
    file: NOISE,
    operator: 'AOR — subtraction becomes addition in lerp',
    find: 'a + (b - a) * t',
    replace: 'a + (b + a) * t',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'Note the midpoint test lerp(0, 10, 0.5) CANNOT catch this (a is 0, so ' +
      'b-a === b+a). Only the endpoint test lerp(2, 8, 1) kills it — a good ' +
      'argument for testing endpoints as well as midpoints.',
  },
  {
    id: 'M03',
    file: NOISE,
    operator: 'MCR — round becomes floor',
    find: 'return Math.round(v * f) / f;',
    replace: 'return Math.floor(v * f) / f;',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'round(1.23456) is 1.23 under BOTH versions. Only the explicit-precision ' +
      'cases round(1.23456, 4) and round(1.5, 0) expose the difference.',
  },
  {
    id: 'M04',
    file: NOISE,
    operator: 'AOR — sign flip in the Ornstein-Uhlenbeck decay term',
    find: 'const decay = Math.exp(-this.theta * Math.max(dt, 0));',
    replace: 'const decay = Math.exp(this.theta * Math.max(dt, 0));',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'This is exactly the numerical-instability failure the class comment warns ' +
      'about. The large-dt stability test is the one that catches it.',
  },
  {
    id: 'M05',
    file: NOISE,
    operator: 'SDL — drop the "1 -" from the LagFilter blend factor',
    find: 'const alpha = 1 - Math.exp(-dt / Math.max(this.tau, 1e-3));',
    replace: 'const alpha = Math.exp(-dt / Math.max(this.tau, 1e-3));',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'Inverts the filter: it now jumps straight to the target on a zero-length ' +
      'step instead of not moving at all.',
  },
  {
    id: 'M06',
    file: NOISE,
    operator: 'AOR — division becomes multiplication in the EWMA half-life',
    find: 'Math.pow(0.5, dt / Math.max(this.halfLife, 1e-3))',
    replace: 'Math.pow(0.5, dt * Math.max(this.halfLife, 1e-3))',
    tests: T_NOISE,
    expect: 'killed',
    note: 'Destroys the half-life semantics; the exact 50% test catches it.',
  },
  {
    id: 'M07',
    file: NOISE,
    operator: 'SVR — shrink the id counter modulus',
    find: 'idCounter = (idCounter + 1) % 1_000_000;',
    replace: 'idCounter = (idCounter + 1) % 10;',
    tests: T_NOISE,
    expect: 'killed',
    note:
      'Ids become non-unique inside a single millisecond. Only a high-volume ' +
      'collision test finds this — a single-call test would not.',
  },

  /* ───────────────────────────────── src/sim/orbit.ts ──────────────────────── */
  {
    id: 'M08',
    file: ORBIT,
    operator: 'SVR — truncate the Earth radius constant',
    find: 'export const EARTH_RADIUS_KM = 6371.0088;',
    replace: 'export const EARTH_RADIUS_KM = 6371;',
    tests: [...T_ORBIT, T_KILL],
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR. The orbit tests assert against EARTH_RADIUS_KM ' +
      'itself, so the constant is both the code and the oracle and moves with ' +
      'the mutant. This is a self-referential (tautological) test — the single ' +
      'most valuable defect mutation testing finds. See MUTATION-TESTING.md.',
  },
  {
    id: 'M09',
    file: ORBIT,
    operator: 'AOR — sign flip on the Julian Date offset',
    find: 'return ms / 86400000 + 2440587.5;',
    replace: 'return ms / 86400000 - 2440587.5;',
    tests: T_ORBIT,
    expect: 'killed',
    note:
      'Killed because julianDate is asserted against hard literals (2440587.5, ' +
      '2451545.0) rather than against a constant from the source.',
  },
  {
    id: 'M10',
    file: ORBIT,
    operator: 'SDL — remove the GMST angle normalisation',
    find: 'return (((seconds / 240) % 360) + 360) % 360;',
    replace: 'return (seconds / 240) % 360;',
    tests: T_ORBIT,
    expect: 'killed',
    note:
      'GMST may now come back negative. The "always in [0, 360)" property test ' +
      'over 400 days is what catches it.',
  },
  {
    id: 'M11',
    file: ORBIT,
    operator: 'SVR — halve the range coefficient in the path-loss equation',
    find: '32.44 + 20 * Math.log10(Math.max(rangeKm, 0.001))',
    replace: '32.44 + 10 * Math.log10(Math.max(rangeKm, 0.001))',
    tests: T_ORBIT,
    expect: 'killed',
    note:
      'Free-space path loss must rise 6.02 dB per doubling of range. With 10x ' +
      'log10 it only rises 3.01 dB. The relative-change test catches it; a test ' +
      'checking only "loss is positive" would not.',
  },
  {
    id: 'M12',
    file: ORBIT,
    operator: 'SDL — remove the negative-radius guard',
    find: 'return Math.max(0, central * r * 1000);',
    replace: 'return central * r * 1000;',
    tests: T_ORBIT,
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR — EQUIVALENT over the legal input domain. For every ' +
      'elevation mask in [0, 90] the central angle is already non-negative, so ' +
      'Math.max(0, ..) is pure defensive coding and no in-domain test can tell the ' +
      'two versions apart. (An out-of-domain mask such as 91 degrees WOULD expose ' +
      'it — but a footprint for an impossible elevation is not behaviour worth ' +
      'specifying.) Domain-equivalent mutants belong outside the denominator of an ' +
      'honest mutation score.',
  },
  {
    id: 'M13',
    file: ORBIT,
    operator: 'ROR — invert the inter-satellite occultation test',
    find: 'los: closest > EARTH_RADIUS_KM + 100',
    replace: 'los: closest < EARTH_RADIUS_KM + 100',
    tests: T_ORBIT,
    expect: 'killed',
    note: 'Reports the crosslink blocked when it is clear and vice versa.',
  },
  {
    id: 'M14',
    file: ORBIT,
    operator: 'SVR — delete the sun-synchronous nodal precession',
    find: 'const raanDeg = el.raan + (0.9856 * elapsedSec) / 86400;',
    replace: 'const raanDeg = el.raan + (0.0 * elapsedSec) / 86400;',
    tests: [...T_ORBIT, T_KILL],
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR. Nodal regression is ~1 degree PER DAY, but no test ' +
      'propagates for more than a couple of orbits, so the effect never grows ' +
      'large enough to fail an assertion. A genuine test-coverage gap: the orbit ' +
      'is only verified over short horizons.',
  },
  {
    id: 'M15',
    file: ORBIT,
    operator: 'ROR — invert the azimuth wrap condition',
    find: 'if (azimuth < 0) azimuth += 360;',
    replace: 'if (azimuth > 0) azimuth += 360;',
    tests: T_ORBIT,
    expect: 'killed',
    note: 'Azimuth escapes [0, 360). Caught by the range property test.',
  },

  /* ───────────────────────────────── src/sim/clock.ts ──────────────────────── */
  {
    id: 'M16',
    file: CLOCK,
    operator: 'SDL — drop the lower bound from the speed clamp',
    find: 'const clamped = Math.min(240, Math.max(0.25, speed));',
    replace: 'const clamped = Math.min(240, speed);',
    tests: T_CLOCK,
    expect: 'killed',
    note:
      'The upper bound still works, so a test that only checks setSpeed(1000) ' +
      'would miss this. Boundary testing on BOTH ends is what kills it.',
  },
  {
    id: 'M17',
    file: CLOCK,
    operator: 'ROR — weaken the non-positive advance guard',
    find: 'if (ms <= 0) return;',
    replace: 'if (ms < 0) return;',
    tests: T_CLOCK,
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR — EQUIVALENT MUTANT. advance(0) now falls through, but ' +
      'it sets anchorSim = now() + 0 and re-anchors anchorWall to the same instant, ' +
      'so the observable clock state is byte-identical. Unkillable by construction.',
  },
  {
    id: 'M18',
    file: CLOCK,
    operator: 'AOR — multiplication becomes division in the clock rate',
    find: 'return this.anchorSim + (Date.now() - this.anchorWall) * this.speed;',
    replace: 'return this.anchorSim + (Date.now() - this.anchorWall) / this.speed;',
    tests: T_CLOCK,
    expect: 'killed',
    note:
      'At 1x the two are identical, so the 1x test alone is useless here. The 30x ' +
      'test is what proves the multiplier is applied in the right direction.',
  },

  /* ───────────────────────────────── src/sim/radio.ts ──────────────────────── */
  {
    id: 'M19',
    file: RADIO,
    operator: 'SVR — lower the SSTV transmit power below CW',
    find: '    txPower: 1.2,',
    replace: '    txPower: 0.3,',
    tests: T_RADIO,
    expect: 'killed',
    note:
      'Breaks the documented ordering (SSTV is the highest-power mode, CW the ' +
      'lowest). Only the cross-mode comparison test catches it; the per-mode ' +
      '"txPower > 0" test passes happily.',
  },

  /* ───────────────────────────────── src/db/history.ts ─────────────────────── */
  {
    id: 'M20',
    file: HISTORY,
    operator: 'SVR — enlarge the in-memory ring buffer',
    find: 'const MEMORY_LIMIT = 4000;',
    replace: 'const MEMORY_LIMIT = 5000;',
    tests: T_HISTORY,
    expect: 'killed',
    note:
      'Only the test that deliberately overflows the ring (4500 rows) can see ' +
      'this. Every other history test writes a handful of rows and passes.',
  },
  {
    id: 'M21',
    file: HISTORY,
    operator: 'ROR — off-by-one in the ring eviction guard',
    find: 'if (ring.length > MEMORY_LIMIT) ring.splice(0, ring.length - MEMORY_LIMIT);',
    replace: 'if (ring.length >= MEMORY_LIMIT) ring.splice(0, ring.length - MEMORY_LIMIT);',
    tests: T_HISTORY,
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR — EQUIVALENT MUTANT. At exactly MEMORY_LIMIT rows the ' +
      'splice length computes to 0, so the extra iteration is a no-op. Classic ' +
      'example of an off-by-one that genuinely does not change behaviour.',
  },
  {
    id: 'M22',
    file: HISTORY,
    operator: 'MCR — take the oldest events instead of the newest',
    find: 'return this.memEvents.slice(-limit);',
    replace: 'return this.memEvents.slice(0, limit);',
    tests: T_HISTORY,
    expect: 'killed',
    note:
      'The dashboard would backfill the event log with ancient entries. Killed ' +
      'only because the test asserts WHICH events come back, not just how many.',
  },
  {
    id: 'M23',
    file: HISTORY,
    operator: 'ROR — off-by-one in the command-update index guard',
    find: 'if (idx >= 0) this.memCommands[idx] = command;',
    replace: 'if (idx > 0) this.memCommands[idx] = command;',
    tests: T_HISTORY,
    expect: 'killed',
    note:
      'The very first command in the log (index 0) would never receive its ACK. ' +
      'Killed because the test updates exactly that first command.',
  },
  {
    id: 'M24',
    file: HISTORY,
    operator: 'ROR — exclude the lower bound of the history window',
    find: 'return ring.filter((r) => r.simTime >= fromSim && r.simTime <= toSim).slice(-limit);',
    replace: 'return ring.filter((r) => r.simTime > fromSim && r.simTime <= toSim).slice(-limit);',
    tests: [...T_HISTORY, T_KILL],
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR. A real off-by-one: a sample landing exactly on `from` ' +
      'is now dropped. It survives because no history test places a sample ON the ' +
      'boundary — the window (1500, 2500) is queried against rows at 1000/2000/3000. ' +
      'Textbook motivation for boundary value analysis. KILLABLE — see Step 5.',
  },

  /* ──────────────────────────────── src/routes/api.ts ──────────────────────── */
  {
    id: 'M25',
    file: API,
    operator: 'SVR — wrong HTTP status for an unknown telemetry channel',
    find:
      '    return res.status(400).json({\n' +
      '      error: `unknown channel "${channel}"`,',
    replace:
      '    return res.status(404).json({\n' +
      '      error: `unknown channel "${channel}"`,',
    tests: T_API,
    expect: 'killed',
    note:
      'A malformed request is 400, not 404. Killed because the test asserts the ' +
      'exact status code rather than merely "not 200".',
  },
  {
    id: 'M26',
    file: API,
    operator: 'COR — invert the channel whitelist check',
    find: 'if (!TELEMETRY_CHANNELS.includes(channel)) {',
    replace: 'if (TELEMETRY_CHANNELS.includes(channel)) {',
    tests: T_API,
    expect: 'killed',
    note: 'Every valid channel is rejected and every invalid one is served.',
  },
  {
    id: 'M27',
    file: API,
    operator: 'MCR — min becomes max on the history row cap',
    find: 'const limit = Math.min(Number(req.query.limit) || 1500, 5000);',
    replace: 'const limit = Math.max(Number(req.query.limit) || 1500, 5000);',
    tests: [...T_API, T_KILL],
    expect: 'survived',
    note:
      'DELIBERATE SURVIVOR. The cap that protects the API from an unbounded query ' +
      'is inverted — ?limit=100000 would now be honoured. It survives because no ' +
      'API test ever sends a ?limit= parameter. Pure coverage gap. KILLABLE — see Step 5.',
  },
  {
    id: 'M28',
    file: API,
    operator: 'SVR — wrong success status on the mock uplink',
    find: 'res.status(202).json(command);',
    replace: 'res.status(200).json(command);',
    tests: T_API,
    expect: 'killed',
    note:
      '202 Accepted is semantically correct: the command is queued, not executed. ' +
      '200 would claim it is already done.',
  },
  {
    id: 'M29',
    file: API,
    operator: 'SVR — change the default history window',
    find: '? minutes : 30) * 60_000;',
    replace: '? minutes : 60) * 60_000;',
    tests: T_API,
    expect: 'killed',
    note:
      'The documented default is 30 minutes. Killed by the test that asserts the ' +
      'exact width of the default window.',
  },
];

/** Mutants we assert are equivalent — no test can ever kill them. */
export const EQUIVALENT_IDS = new Set(['M12', 'M17', 'M21']);
