/**
 * StrykerJS — automated mutation testing for the KJS-SRS-01 backend.
 *
 * The lab notes list PITest / Jester / Mutagenesis / Ninja Turtles as automation
 * tools. StrykerJS is the equivalent for JavaScript and TypeScript: it parses the
 * source, generates hundreds of mutants automatically, runs the test suite
 * against each one, and reports the mutation score.
 *
 * The manual harness in mutation/ shows you the *method* on ~29 hand-written
 * mutants. Stryker does the same thing exhaustively, at machine scale.
 *
 *   npm run mutation:auto          full automated run + HTML report
 *   npm run mutation:auto:quick    orbit + noise only, for a fast feedback loop
 *
 * ── Why `inPlace: true` ────────────────────────────────────────────────────────
 * By default Stryker copies the project into a sandbox and symlinks node_modules.
 * That breaks here: this is an npm *workspace*, so backend's dependencies are
 * hoisted to the repository-root node_modules and a sandbox rooted at backend/
 * cannot resolve them. `inPlace` mutates the real files and restores them when
 * the run finishes — the same approach the manual harness uses.
 *
 * Consequence: do not edit src/ while a run is in progress, and if a run is
 * killed hard, check `git status` and run `git checkout -- backend/src`.
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',

  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.mts',
  },

  // See the note above — required for an npm-workspace layout.
  inPlace: true,

  /**
   * Which production files to mutate.
   *
   * Scoped to the modules the current suite actually targets. That keeps a run to
   * a few minutes instead of an hour, and — more importantly — keeps the score
   * honest: mutating socket.ts, which has no tests at all, would bury the real
   * signal under a wall of trivially-surviving mutants.
   *
   * Use `npm run mutation:auto:full` when you want the unflattering whole-backend
   * number, including the engines that are not yet under test.
   */
  mutate: [
    'src/sim/noise.ts',
    'src/sim/orbit.ts',
    'src/sim/clock.ts',
    'src/sim/radio.ts',
    'src/db/history.ts',
    'src/routes/api.ts',
  ],

  /**
   * 'perTest' asks Stryker to record which test covers which line during a dry
   * run, then execute only the covering tests for each mutant. Typically a 5-20x
   * speedup over running the whole suite per mutant.
   */
  coverageAnalysis: 'perTest',

  /**
   * Stryker injects mutants into TypeScript, which legitimately produces type
   * errors (e.g. a number literal swapped into a string position). Suppressing
   * type checks in src/ lets those mutants still run.
   */
  disableTypeChecks: 'src/**/*.ts',

  /**
   * Never copy these into the working set — .next alone is hundreds of megabytes
   * and would dominate startup time.
   */
  ignorePatterns: [
    'dist',
    'coverage',
    'mutation/reports',
    'mutation/.backup',
    'mutation/.tmp',
    'prisma/migrations',
    '../frontend',
  ],

  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: { fileName: 'mutation/reports/stryker.html' },
  jsonReporter: { fileName: 'mutation/reports/stryker.json' },
  clearTextReporter: {
    allowColor: true,
    logTests: true,
    maxTestsToLog: 3,
  },

  /**
   * Mutation score gates. `break` fails the command (non-zero exit) so CI can
   * enforce it; `low`/`high` only colour the report.
   *
   * 80 is a realistic target for a codebase with this much floating-point maths.
   * Raise it as you kill survivors.
   */
  thresholds: {
    high: 90,
    low: 70,
    break: 60,
  },

  /**
   * The simulation uses setInterval/setTimeout, and the API tests schedule a
   * 1-3 s mock uplink delay. A mutant that turns a loop bound into an infinite
   * loop must be allowed to time out rather than hang the run — but the normal
   * timeout has to be generous enough not to flag slow-but-correct mutants.
   */
  timeoutMS: 15000,
  timeoutFactor: 2,
  dryRunTimeoutMinutes: 5,

  // Leave one core free so the machine stays usable during a run.
  concurrency: 4,

  logLevel: 'info',
  fileLogLevel: 'debug',
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
