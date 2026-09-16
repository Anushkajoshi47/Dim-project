#!/usr/bin/env node
/**
 * MANUAL MUTATION TESTING HARNESS — STQA lab, Steps 2 to 5.
 *
 * For every mutant in mutants.mjs this script performs the classical loop:
 *
 *   Step 1  seed exactly one fault into the source file            (apply)
 *   Step 2  run the SAME test cases against the mutant             (vitest)
 *   Step 3  compare the mutant's result with the original's        (baseline)
 *   Step 4  results differ  -> MUTANT KILLED   (the tests are adequate)
 *   Step 5  results identical -> MUTANT SURVIVED (write a better test)
 *
 * and finally reports
 *
 *   Mutation Score = (Killed Mutants / Total Mutants) * 100
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *   npm run mutation                     full run, every mutant
 *   npm run mutation -- --list           show the catalogue, run nothing
 *   npm run mutation -- --only M08       one mutant (or --only M08,M14,M24)
 *   npm run mutation -- --file orbit     only mutants whose file path matches
 *   npm run mutation -- --no-baseline    skip the clean-tree baseline run
 *   npm run mutation -- --force          run even with uncommitted src/ changes
 *
 * ── Safety ─────────────────────────────────────────────────────────────────────
 * Source files are mutated IN PLACE and restored immediately afterwards. To make
 * that safe:
 *   - the original bytes are held in memory AND written to mutation/.backup/,
 *   - restore runs in a `finally`, and again on SIGINT / SIGTERM / uncaught error,
 *   - the script refuses to start if `git status` shows uncommitted changes under
 *     src/ (so a hard kill can never destroy work you had not committed).
 * If something does go wrong, `git checkout -- backend/src` restores everything,
 * and mutation/.backup/ holds a byte copy of every file that was touched.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MUTANTS, EQUIVALENT_IDS } from './mutants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const BACKUP_DIR = path.join(HERE, '.backup');
const REPORT_DIR = path.join(HERE, 'reports');
const TMP_DIR = path.join(HERE, '.tmp');

/**
 * Absolute path to vitest's CLI entry point.
 *
 * Resolved through Node's own resolver rather than shelling out to `npx`: this
 * is a workspace, so vitest lives in the repository-root node_modules, and
 * spawning it directly avoids both the npx lookup and the DEP0190 warning that
 * `shell: true` with an argument array now emits.
 *
 * `vitest.mjs` is not listed in the package's `exports` map, so it cannot be
 * resolved directly — resolve `package.json` (which is exported) and join from
 * its directory instead.
 */
const VITEST_CLI = (() => {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve('vitest/package.json'));
  const cli = path.join(pkgDir, 'vitest.mjs');
  if (!fs.existsSync(cli)) {
    throw new Error(
      `Could not find vitest's CLI at ${cli}. Run \`npm install\` from the repository root.`,
    );
  }
  return cli;
})();

/* ────────────────────────────────────────────────────────────── tiny helpers */

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', grey: '\x1b[90m',
};
const paint = (c, s) => `${C[c]}${s}${C.reset}`;
const rule = (ch = '─', n = 78) => paint('grey', ch.repeat(n));

function parseArgs(argv) {
  const out = { list: false, validate: false, only: null, file: null, baseline: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--validate') out.validate = true;
    else if (a === '--no-baseline') out.baseline = false;
    else if (a === '--force') out.force = true;
    else if (a === '--only') out.only = new Set(String(argv[++i]).split(',').map((s) => s.trim().toUpperCase()));
    else if (a.startsWith('--only=')) out.only = new Set(a.slice(7).split(',').map((s) => s.trim().toUpperCase()));
    else if (a === '--file') out.file = String(argv[++i]);
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(paint('red', `unknown flag: ${a}`)); printHelp(); process.exit(2); }
  }
  return out;
}

function printHelp() {
  console.log(`
${C.bold}Manual mutation testing harness${C.reset}

  npm run mutation                   run every mutant
  npm run mutation -- --list         list the catalogue, run nothing
  npm run mutation -- --validate     check every find-string still resolves uniquely
  npm run mutation -- --only M08     run one mutant (comma-separate for several)
  npm run mutation -- --file orbit   run mutants whose source path matches
  npm run mutation -- --no-baseline  skip the clean-tree baseline run
  npm run mutation -- --force        proceed despite uncommitted src/ changes
`);
}

/* ───────────────────────────────────────────────── file mutate / restore ── */

/** In-memory record of every file currently mutated: absPath -> original text. */
const dirty = new Map();

function backupOnce(absPath, original) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const flat = path.relative(BACKEND, absPath).replace(/[\\/]/g, '__');
  fs.writeFileSync(path.join(BACKUP_DIR, flat), original, 'utf8');
}

/** CRLF-tolerant variant of `needle`, or null if the plain form already matches. */
function crlfVariant(needle) {
  return needle.includes('\n') ? needle.replace(/\n/g, '\r\n') : null;
}

/**
 * How many times `needle` occurs in `haystack`, tolerating a repo checked out
 * with CRLF line endings.
 */
function countOccurrences(haystack, needle) {
  const direct = haystack.split(needle).length - 1;
  if (direct > 0) return direct;
  const crlf = crlfVariant(needle);
  return crlf ? haystack.split(crlf).length - 1 : 0;
}

/**
 * Apply one mutant. Returns { ok, reason }.
 * Refuses to mutate unless `find` occurs EXACTLY once — a zero or multiple match
 * means the catalogue has drifted from the source and the result would be a lie.
 */
function applyMutant(mutant) {
  const abs = path.join(BACKEND, mutant.file);
  if (!fs.existsSync(abs)) return { ok: false, reason: `file not found: ${mutant.file}` };

  const original = fs.readFileSync(abs, 'utf8');

  // Tolerate a repo that has been checked out with CRLF line endings.
  let find = mutant.find;
  let occurrences = original.split(find).length - 1;
  if (occurrences === 0) {
    const crlf = crlfVariant(find);
    if (crlf) {
      find = crlf;
      occurrences = original.split(find).length - 1;
    }
  }

  if (occurrences === 0) return { ok: false, reason: 'find-string not present (source drifted?)' };
  if (occurrences > 1) return { ok: false, reason: `find-string is ambiguous (${occurrences} matches)` };

  const replace = find === mutant.find ? mutant.replace : mutant.replace.replace(/\n/g, '\r\n');

  backupOnce(abs, original);
  dirty.set(abs, original);
  fs.writeFileSync(abs, original.split(find).join(replace), 'utf8');
  return { ok: true };
}

function restoreAll() {
  for (const [abs, original] of dirty) {
    try { fs.writeFileSync(abs, original, 'utf8'); } catch { /* best effort */ }
  }
  dirty.clear();
}

// Belt and braces: restore no matter how we leave.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { restoreAll(); process.exit(130); });
}
process.on('uncaughtException', (err) => { restoreAll(); console.error(err); process.exit(1); });
process.on('exit', restoreAll);

/* ──────────────────────────────────────────────────────────── test running */

/**
 * Run vitest over `testFiles` and return a structured verdict.
 * `--reporter=json` gives us the individual failing test names, which is what
 * turns "the suite went red" into "THIS assertion caught the fault".
 */
function runTests(testFiles, label) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const outFile = path.join(TMP_DIR, 'vitest-result.json');
  try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }

  const args = [VITEST_CLI, 'run', ...testFiles, '--reporter=json', `--outputFile=${outFile}`];
  const res = spawnSync(process.execPath, args, {
    cwd: BACKEND,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    maxBuffer: 32 * 1024 * 1024,
  });

  const verdict = {
    label,
    exitCode: res.status ?? -1,
    passed: res.status === 0,
    total: 0,
    failed: 0,
    failingTests: [],
    parseError: null,
  };

  try {
    const json = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    verdict.total = json.numTotalTests ?? 0;
    verdict.failed = json.numFailedTests ?? 0;
    for (const suite of json.testResults ?? []) {
      for (const a of suite.assertionResults ?? []) {
        if (a.status === 'failed') verdict.failingTests.push(a.fullName || a.title);
      }
    }
  } catch (err) {
    // A mutant that makes a module throw at import time can stop vitest before it
    // writes the report. That is still a kill — the exit code carries the signal.
    verdict.parseError = String(err.message ?? err);
  }

  return verdict;
}

/* ─────────────────────────────────────────────────────────── preconditions */

function assertCleanWorkingTree(force) {
  // No `shell: true` — git is a real executable on PATH, and shelling out with an
  // argument array trips Node's DEP0190 warning.
  const res = spawnSync('git', ['status', '--porcelain', '--', 'src'], {
    cwd: BACKEND, encoding: 'utf8',
  });
  if (res.status !== 0) return; // not a git repo, or git unavailable — carry on
  const changed = (res.stdout || '').trim();
  if (!changed) return;

  console.log(`\n${paint('yellow', '!')} backend/src has uncommitted changes:\n`);
  console.log(paint('grey', changed.split('\n').map((l) => `    ${l}`).join('\n')));
  if (force) {
    console.log(`\n${paint('yellow', '!')} --force given, continuing anyway.\n`);
    return;
  }
  console.log(`
${paint('red', 'Refusing to run.')} This harness edits files under src/ in place. Commit or
stash your work first so an interrupted run cannot lose it, then re-run.
Override with ${paint('bold', '--force')} if you know what you are doing.
`);
  process.exit(1);
}

/* ─────────────────────────────────────────────────────────────── reporting */

function scoreBlock(results) {
  const considered = results.filter((r) => r.status !== 'ERROR');
  const killed = considered.filter((r) => r.status === 'KILLED');
  const survived = considered.filter((r) => r.status === 'SURVIVED');
  const equivalent = survived.filter((r) => EQUIVALENT_IDS.has(r.id));
  const realSurvivors = survived.filter((r) => !EQUIVALENT_IDS.has(r.id));

  const total = considered.length;
  const naive = total ? (killed.length / total) * 100 : 0;
  const adjustedDenom = total - equivalent.length;
  const adjusted = adjustedDenom ? (killed.length / adjustedDenom) * 100 : 0;

  return {
    total,
    killed: killed.length,
    survived: survived.length,
    equivalent: equivalent.length,
    realSurvivors,
    errored: results.length - considered.length,
    naive,
    adjusted,
  };
}

function writeReports(results, s, baseline) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  fs.writeFileSync(
    path.join(REPORT_DIR, 'latest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), baseline, score: s, results }, null, 2),
    'utf8',
  );

  const md = [
    '# Manual mutation testing report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Mutation score',
    '',
    '```',
    `Mutation Score = (Killed / Total) * 100 = (${s.killed} / ${s.total}) * 100 = ${s.naive.toFixed(2)}%`,
    `Adjusted (equivalent mutants excluded) = (${s.killed} / ${s.total - s.equivalent}) * 100 = ${s.adjusted.toFixed(2)}%`,
    '```',
    '',
    `- Total mutants: **${s.total}**`,
    `- Killed: **${s.killed}**`,
    `- Survived: **${s.survived}** (of which ${s.equivalent} are equivalent / unkillable)`,
    `- Errored (could not be applied): **${s.errored}**`,
    '',
    '## Results',
    '',
    '| ID | Status | File | Operator | Killed by |',
    '|----|--------|------|----------|-----------|',
    ...results.map((r) => {
      const killer = r.failingTests?.length
        ? r.failingTests.slice(0, 2).map((t) => `\`${t}\``).join('<br>') +
          (r.failingTests.length > 2 ? `<br>_+${r.failingTests.length - 2} more_` : '')
        : '—';
      const tag = r.status === 'KILLED' ? '✅ KILLED'
        : r.status === 'ERROR' ? '⚠️ ERROR'
        : EQUIVALENT_IDS.has(r.id) ? '➖ SURVIVED (equivalent)'
        : '❌ SURVIVED';
      return `| ${r.id} | ${tag} | \`${r.file}\` | ${r.operator} | ${killer} |`;
    }),
    '',
    '## Surviving mutants that need better tests',
    '',
    s.realSurvivors.length
      ? s.realSurvivors.map((r) => `### ${r.id} — \`${r.file}\`\n\n- **Operator:** ${r.operator}\n- **Mutation:** \`${r.find.trim()}\` → \`${r.replace.trim()}\`\n- **Why it survived:** ${r.note}\n`).join('\n')
      : '_None. Every non-equivalent mutant was killed._',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(REPORT_DIR, 'latest.md'), md, 'utf8');
  fs.writeFileSync(path.join(REPORT_DIR, `report-${stamp}.md`), md, 'utf8');
}

/* ───────────────────────────────────────────────────────────────────── main */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let selected = MUTANTS;
  if (opts.only) selected = selected.filter((m) => opts.only.has(m.id.toUpperCase()));
  if (opts.file) selected = selected.filter((m) => m.file.includes(opts.file));

  if (!selected.length) {
    console.error(paint('red', 'No mutants matched that selection.'));
    process.exit(2);
  }

  if (opts.list) {
    console.log(`\n${C.bold}Mutant catalogue${C.reset} (${selected.length} of ${MUTANTS.length})\n`);
    for (const m of selected) {
      const eq = EQUIVALENT_IDS.has(m.id) ? paint('grey', '  [equivalent]') : '';
      console.log(`  ${paint('cyan', m.id)}  ${m.file}${eq}`);
      console.log(`       ${paint('grey', m.operator)}`);
      console.log(`       ${paint('red', '-')} ${m.find.split('\n')[0].trim()}`);
      console.log(`       ${paint('green', '+')} ${m.replace.split('\n')[0].trim()}`);
      console.log(`       expected: ${m.expect}\n`);
    }
    return;
  }

  if (opts.validate) {
    console.log(`\n${C.bold}Validating the catalogue against current source${C.reset}\n`);
    let bad = 0;
    for (const m of selected) {
      const abs = path.join(BACKEND, m.file);
      const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      const n = src === null ? -1 : countOccurrences(src, m.find);
      if (n === 1) {
        console.log(`  ${paint('green', 'ok  ')} ${m.id}  ${m.file}`);
      } else {
        bad++;
        const why = src === null ? 'file missing' : n === 0 ? 'no match' : `${n} matches (ambiguous)`;
        console.log(`  ${paint('red', 'FAIL')} ${m.id}  ${m.file}  ${paint('grey', why)}`);
      }
    }
    console.log(
      bad
        ? `\n${paint('red', `${bad} mutant(s) will not apply.`)} Fix mutants.mjs before running.\n`
        : `\n${paint('green', 'All find-strings resolve uniquely.')}\n`,
    );
    process.exitCode = bad ? 1 : 0;
    return;
  }


  assertCleanWorkingTree(opts.force);

  console.log(`\n${C.bold}KJS-SRS-01 — manual mutation testing${C.reset}`);
  console.log(paint('grey', `${selected.length} mutant(s) queued\n`));

  /* Step 2/3 reference point: what does the UNMUTATED program do? */
  let baseline = null;
  if (opts.baseline) {
    const suites = [...new Set(selected.flatMap((m) => m.tests))];
    process.stdout.write(paint('grey', 'baseline  running the original program ... '));
    baseline = runTests(suites, 'baseline');
    if (!baseline.passed) {
      console.log(paint('red', 'FAILED\n'));
      console.log(`${paint('red', 'The test suite is already red on unmutated source.')}
Mutation testing compares mutant behaviour against a GREEN baseline; with a red
baseline every result is meaningless. Fix the suite first (npm test), then re-run.

Failing tests:`);
      for (const t of baseline.failingTests) console.log(paint('grey', `  - ${t}`));
      process.exit(1);
    }
    console.log(paint('green', `green (${baseline.total} tests)\n`));
  }

  /* Steps 1 -> 5, one mutant at a time. */
  const results = [];
  let n = 0;

  for (const mutant of selected) {
    n++;
    const head = `${paint('cyan', mutant.id)} ${paint('grey', `(${n}/${selected.length})`)} ${mutant.file}`;
    process.stdout.write(`${head}\n    ${paint('grey', mutant.operator)}\n    `);

    const applied = applyMutant(mutant);
    if (!applied.ok) {
      console.log(paint('yellow', `ERROR — ${applied.reason}\n`));
      results.push({ ...mutant, status: 'ERROR', reason: applied.reason, failingTests: [] });
      continue;
    }

    let verdict;
    try {
      verdict = runTests(mutant.tests, mutant.id);
    } finally {
      restoreAll(); // Step 1's invariant: only ever ONE fault in the tree at a time.
    }

    // Step 4 / Step 5: original green, mutant red => outputs differ => KILLED.
    const status = verdict.passed ? 'SURVIVED' : 'KILLED';
    const surprise = status.toLowerCase() !== mutant.expect;

    if (status === 'KILLED') {
      console.log(paint('green', `KILLED`) + paint('grey', `  (${verdict.failed} test(s) failed)`));
      for (const t of verdict.failingTests.slice(0, 3)) console.log(paint('grey', `      ↳ ${t}`));
      if (verdict.failingTests.length > 3) {
        console.log(paint('grey', `      ↳ +${verdict.failingTests.length - 3} more`));
      }
    } else if (EQUIVALENT_IDS.has(mutant.id)) {
      console.log(paint('blue', 'SURVIVED') + paint('grey', '  (equivalent mutant — unkillable by design)'));
    } else {
      console.log(paint('red', 'SURVIVED') + paint('grey', '  (the tests cannot see this fault)'));
    }

    if (surprise) {
      console.log(paint('magenta', `      ! surprise: expected ${mutant.expect}, got ${status.toLowerCase()}`));
    }
    console.log('');

    results.push({ ...mutant, status, surprise, ...verdict });
  }

  /* ─────────────────────────────────────────────────────── the final score */
  const s = scoreBlock(results);

  console.log(rule('═'));
  console.log(`${C.bold}  MUTATION SCORE${C.reset}\n`);
  console.log(`    Killed mutants      ${paint('green', String(s.killed))}`);
  console.log(`    Survived mutants    ${paint('red', String(s.survived - s.equivalent))} + ${paint('blue', `${s.equivalent} equivalent`)}`);
  if (s.errored) console.log(`    Errored             ${paint('yellow', String(s.errored))}`);
  console.log(`    Total mutants       ${s.total}\n`);
  console.log(`    ${C.bold}Mutation Score = (Killed / Total) × 100${C.reset}`);
  console.log(`                   = (${s.killed} / ${s.total}) × 100 = ${C.bold}${s.naive.toFixed(2)}%${C.reset}\n`);
  console.log(paint('grey', `    Adjusted for equivalent mutants: (${s.killed} / ${s.total - s.equivalent}) × 100 = ${s.adjusted.toFixed(2)}%`));
  console.log(rule('═'));

  if (s.realSurvivors.length) {
    console.log(`\n${C.bold}Step 5 — these mutants need better test cases:${C.reset}\n`);
    for (const r of s.realSurvivors) {
      console.log(`  ${paint('red', r.id)}  ${r.file}`);
      console.log(paint('grey', `      ${r.note}\n`));
    }
    console.log(paint('grey', '  See MUTATION-TESTING.md > Step 5, and un-skip the matching test in'));
    console.log(paint('grey', '  tests/mutation-killers.test.ts, then run this again.\n'));
  } else {
    console.log(`\n  ${paint('green', 'Every non-equivalent mutant was killed — the test cases are mutation adequate.')}\n`);
  }

  writeReports(results, s, baseline);
  console.log(paint('grey', `  Report written to mutation/reports/latest.md\n`));

  // Non-zero exit if any real (non-equivalent) mutant survived, so CI can gate on it.
  process.exitCode = s.realSurvivors.length || s.errored ? 1 : 0;
}

main();
