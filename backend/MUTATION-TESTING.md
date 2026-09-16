# Mutation Testing — KJS-SRS-01 backend

Unit testing answers *"does the code do what I expect?"*
Coverage answers *"which lines did the tests execute?"*

Neither answers the question that actually matters:

> **Are my test cases good enough to detect a fault if one existed?**

Mutation testing answers exactly that. It deliberately breaks the source code —
one small fault at a time — and checks whether the test suite notices. A test
suite that stays green while the program is broken is not a test suite; it is
decoration.

---

## The five lab steps, mapped to this repo

| Lab step | What happens here |
|---|---|
| **1.** Introduce faults into the source by creating many versions called mutants, each containing a single fault | [`mutation/mutants.mjs`](mutation/mutants.mjs) — 29 hand-written mutants, each one exact-string swap in one file. The runner applies them strictly one at a time. |
| **2.** Apply the test cases to the original program and to the mutant program | [`mutation/run-mutation.mjs`](mutation/run-mutation.mjs) runs a **baseline** pass on unmutated source, then re-runs the same Vitest suite against each mutant. |
| **3.** Compare the results of original and mutant | The runner captures Vitest's JSON report for both: exit code, test count, and the names of the individual failing assertions. |
| **4.** Different output → **mutant killed** | Baseline green, mutant red ⇒ `KILLED`. The runner prints *which* assertion caught it. |
| **5.** Same output → **mutant kept alive**; write better test cases | `SURVIVED`. Every survivor is listed with an explanation, and [`tests/mutation-killers.test.ts`](tests/mutation-killers.test.ts) holds the tests that close each gap. |
| **Mutation Score** = (Killed / Total) × 100 | Printed at the end of every run and written to `mutation/reports/latest.md`. |

---

## Two tracks

You will run mutation testing twice, in two different ways. Do them in order —
the manual track teaches the method, the automated track applies it at scale.

### Track A — manual (`npm run mutation`)

29 mutants that **I chose deliberately**, each with a written rationale for what
it teaches. Fast (~2 min), completely legible, and every result is explainable in
a viva. This is the track your lab steps describe literally.

### Track B — automated (`npm run mutation:auto`)

**StrykerJS** — the JavaScript/TypeScript equivalent of PITest from your notes.
It parses the AST and generates *every* mutant it can (hundreds), then runs the
suite against each. Slower (10–25 min) and the results are less curated, but the
mutation score is far more statistically meaningful.

| Your notes | Language | This project |
|---|---|---|
| PITest, Jester | Java / JVM | — |
| Ninja Turtles | .NET | — |
| Mutagenesis | PHP | — |
| — | JavaScript / TypeScript | **StrykerJS** ✅ |

---

## Before you start

Mutation testing edits files under `src/` **in place** and restores them
afterwards. Both tracks do this (a sandbox copy does not work in an npm
workspace, because the dependencies are hoisted to the repository root).

That is safe, but only if you set it up safely:

```powershell
cd c:\Users\Chintan\OneDrive\Desktop\STQA_project

# 1. Everything installed?
npm install

# 2. The suite MUST be green before you start. Mutation testing compares mutant
#    behaviour against a green baseline; with a red baseline every result is
#    meaningless. The runner refuses to continue if the baseline fails.
npm test

# 3. Commit your work. The runner refuses to start with uncommitted changes
#    under backend/src, so an interrupted run can never destroy anything.
git add -A
git commit -m "Add Vitest unit tests and mutation testing harness"
```

**If a run is ever killed hard** (power cut, Ctrl+C twice, terminal closed):

```powershell
git status                              # check whether src/ is dirty
git checkout -- backend/src             # restore everything
```

A byte-for-byte copy of every file touched also sits in `backend/mutation/.backup/`.

---

# Track A — manual mutation testing

## A1. Look at the mutants before running anything

```powershell
cd c:\Users\Chintan\OneDrive\Desktop\STQA_project\backend
npm run mutation:list
```

Each entry shows the id, the file, the mutation operator, the exact `-`/`+` diff,
and whether I predict it will be killed or survive:

```
  M01  src/sim/noise.ts
       MCR — swap the clamp bounds
       - Math.min(hi, Math.max(lo, v))
       + Math.max(hi, Math.min(lo, v))
       expected: killed
```

Verify the catalogue still matches the source (read-only, mutates nothing):

```powershell
npm run mutation -- --validate
```

Every entry must report `ok`. A `FAIL` means someone edited `src/` and the
catalogue drifted — the runner would rather abort than mutate the wrong line.

## A2. The mutation operators used

These are the classical operators from the mutation-testing literature. The
catalogue tags every mutant with the one it uses.

| Code | Operator | Example in this repo |
|---|---|---|
| **AOR** | Arithmetic Operator Replacement | `* this.speed` → `/ this.speed` (M18) |
| **ROR** | Relational Operator Replacement | `simTime >= fromSim` → `>` (M24) |
| **COR** | Conditional Operator Replacement | `if (!x.includes(c))` → `if (x.includes(c))` (M26) |
| **SVR** | Scalar/literal Replacement | `MEMORY_LIMIT = 4000` → `5000` (M20) |
| **SDL** | Statement / term Deletion | drop `Math.max(0.25, …)` from the clamp (M16) |
| **MCR** | Method Call Replacement | `Math.round` → `Math.floor` (M03) |

## A3. Run one mutant first

Start small so you can watch the whole cycle:

```powershell
npm run mutation -- --only M01
```

What you will see, step by step:

```
KJS-SRS-01 — manual mutation testing
1 mutant(s) queued

baseline  running the original program ... green (25 tests)     ← Step 2, original

M01 (1/1) src/sim/noise.ts
    MCR — swap the clamp bounds
    KILLED  (3 test(s) failed)                                  ← Steps 3 & 4
      ↳ clamp > clamps to the lower bound
      ↳ clamp > clamps to the upper bound
      ↳ clamp > handles the boundaries themselves

══════════════════════════════════════════════════════════════════════════════
  MUTATION SCORE

    Killed mutants      1
    Survived mutants    0 + 0 equivalent
    Total mutants       1

    Mutation Score = (Killed / Total) × 100
                   = (1 / 1) × 100 = 100.00%
══════════════════════════════════════════════════════════════════════════════
```

Read that output as the five lab steps:

- **Step 1** — the fault was seeded into `src/sim/noise.ts`.
- **Step 2** — the same tests ran on the original (baseline) and on the mutant.
- **Step 3** — original: 25 passed / mutant: 3 failed. The results differ.
- **Step 4** — different ⇒ **KILLED**. The three named assertions are the ones
  that were adequate enough to catch the fault.
- **Step 5** — nothing survived, so no new tests are needed for this mutant.

Then confirm the file was put back:

```powershell
git status --porcelain -- src
```

Empty output means the source was restored cleanly.

## A4. Run one that you know will survive

```powershell
npm run mutation -- --only M08
```

```
M08 (1/1) src/sim/orbit.ts
    SVR — truncate the Earth radius constant
    SURVIVED  (the tests cannot see this fault)
```

The Earth radius was changed from 6371.0088 km to 6371 km and **every orbit test
still passed**. That is a real defect in the test suite, and section A7 explains
exactly why it happened.

## A5. Run a whole module

```powershell
npm run mutation -- --file noise      # the 7 noise.ts mutants
npm run mutation -- --file orbit      # the 8 orbit.ts mutants
npm run mutation -- --file history    # the 5 history.ts mutants
npm run mutation -- --file api        # the 5 api.ts mutants
```

## A6. The full run

```powershell
npm run mutation
```

Roughly 2 minutes for all 29 mutants. At the end you get the score, the list of
survivors, and a written report at `mutation/reports/latest.md` (Markdown table,
ready to paste into your lab record) plus `latest.json` for the raw data.

## A7. Reading the results — this is the part that matters

The score is not the point. **The survivors are the point.** Each one tells you
something specific about your tests.

### There are three kinds of survivor

#### (a) A genuine gap — the tests never exercise the behaviour

**M27** — `Math.min(limit, 5000)` → `Math.max(limit, 5000)` in
[`src/routes/api.ts`](src/routes/api.ts).

The cap that stops a client requesting a million rows was inverted, and every API
test still passed — because **no API test ever sends a `?limit=` parameter**. The
line shows as covered in the coverage report; its behaviour is never checked.
Coverage cannot see this. Mutation testing can.

**Fix:** add a test that sends `?limit=`. → `tests/mutation-killers.test.ts`

#### (b) A boundary gap

**M24** — `simTime >= fromSim` → `simTime > fromSim` in
[`src/db/history.ts`](src/db/history.ts).

The history window stopped being inclusive at its lower edge. The existing test
queries the window `(1500, 2500)` against samples at 1000 / 2000 / 3000 — every
sample is strictly inside or strictly outside, so **nothing ever lands on a
boundary** and `>=` versus `>` is invisible.

This is the textbook argument for **boundary value analysis**: test at `from`,
`from - 1`, `to`, and `to + 1`, not just comfortably in the middle.

**Fix:** boundary tests. → `tests/mutation-killers.test.ts`

#### (c) A tautological test — the most valuable finding

**M08** — `EARTH_RADIUS_KM = 6371.0088` → `6371` in
[`src/sim/orbit.ts`](src/sim/orbit.ts).

Look at why the orbit tests missed it:

```ts
// tests/unit/orbit.test.ts
expect(r).toBeCloseTo(EARTH_RADIUS_KM + SAT.altitude, 6);
expect(d).toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 3);
```

The constant is **both the code under test and the oracle**. Change it, and the
expected value changes with it, so the assertion can never fail. These tests
prove only that the program agrees with itself.

This is the single most valuable class of defect mutation testing finds, and
coverage reports it as 100% covered.

**Fix:** assert against externally-sourced literals — the published IUGG mean
radius, and a great-circle distance computed outside the program.

#### (d) …and one kind that is *not* a defect: the equivalent mutant

Three mutants in the catalogue **cannot be killed by any test**, because they do
not change the program's behaviour at all:

| Mutant | Change | Why no test can see it |
|---|---|---|
| **M12** | drop `Math.max(0, …)` from `footprintRadius` | For every legal elevation mask in [0°, 90°] the central angle is already ≥ 0. The guard is defensive coding only. |
| **M17** | `if (ms <= 0) return` → `if (ms < 0) return` in `SimClock.advance` | `advance(0)` falls through, but it sets `anchorSim = now() + 0` and re-anchors `anchorWall` to the same instant. Observable state is byte-identical. |
| **M21** | `ring.length > MEMORY_LIMIT` → `>=` | At exactly `MEMORY_LIMIT` rows, `splice(0, 0)` is a no-op. |

Detecting equivalent mutants is **undecidable in general** — it is the single
biggest practical cost of mutation testing, and it is why the technique is
expensive. They must be identified by human reasoning and **excluded from the
denominator**, otherwise a 100% score is unreachable by construction.

The runner reports both numbers:

```
    Mutation Score = (Killed / Total) × 100          ← the raw figure
    Adjusted for equivalent mutants: (Killed / (Total − Equivalent)) × 100
```

Quote the **adjusted** score, and state how many equivalent mutants you excluded
and why. That is what makes the number honest.

## A8. Step 5 — kill the survivors

[`tests/mutation-killers.test.ts`](tests/mutation-killers.test.ts) already
contains the tests that kill M08, M14, M24 and M27. They ship **`it.skip`'d on
purpose**, so you can demonstrate the before/after.

For each survivor:

1. Open `tests/mutation-killers.test.ts`, find the `describe('M08 killer — …')`
   block, and change `it.skip(` to `it(` for its tests.
2. Confirm the new tests pass on unmutated source:
   ```powershell
   npm test
   ```
3. Re-run that one mutant and watch the verdict flip:
   ```powershell
   npm run mutation -- --only M08
   ```
   ```
   M08 (1/1) src/sim/orbit.ts
       SVR — truncate the Earth radius constant
       KILLED  (2 test(s) failed)
         ↳ M08 killer — Earth radius must be pinned to an external value > matches the WGS-84 mean radius
         ↳ M08 killer — Earth radius must be pinned to an external value > computes a quarter great circle against an independent literal
       ! surprise: expected survived, got killed
   ```
   The `surprise` flag is the harness telling you the prediction in the catalogue
   is now out of date — which is exactly the outcome you wanted.
4. Repeat for M14, M24 and M27.
5. Full run for the final number:
   ```powershell
   npm run mutation
   ```

Record both scores. The improvement — not the absolute figure — is the result.

### One survivor argues for a code change, not a test

The M27 killer test exercises the *downward* direction of the clamp
(`?limit=10` must return 10 rows). The **upper** cap of 5000 is genuinely
unreachable through the in-memory backend, because the ring buffer only ever
holds 4000 rows — so `?limit=100000` and `?limit=5000` return identical results
whether the code clamps or not.

Proving the upper cap needs either PostgreSQL attached (where the limit becomes
Prisma's `take`), or extracting the expression into a pure helper:

```ts
export const clampLimit = (raw: unknown, fallback: number, max: number) =>
  Math.min(Number(raw) || fallback, max);
```

…which could then be unit-tested directly. This is a normal and healthy outcome:
**mutation testing frequently reveals that a line is untestable as written, and
the right response is to change the design, not to write a contorted test.** I
have not made that change — it is a judgement call about production code and it
is yours to make.

## A9. All the manual-track commands

```powershell
npm run mutation                      # every mutant, full report
npm run mutation:list                 # show the catalogue, run nothing
npm run mutation -- --validate        # check every find-string still resolves
npm run mutation -- --only M08        # one mutant
npm run mutation -- --only M08,M14    # several
npm run mutation -- --file orbit      # every mutant in a matching file
npm run mutation -- --no-baseline     # skip the baseline pass (faster reruns)
npm run mutation -- --force           # run despite uncommitted src/ changes
npm run mutation -- --help
```

Exit code is `0` only when every non-equivalent mutant was killed, so this can
gate a CI pipeline.

---

# Track B — automated mutation testing with StrykerJS

## B1. What Stryker does differently

You wrote 29 mutants by hand. Stryker parses the TypeScript AST and generates
every mutant it knows how to make — arithmetic operators, comparison operators,
boolean literals, string literals, conditional expressions, array declarations,
optional chaining, block statements, and more. Expect several hundred from the
six files it is configured to mutate.

It also does something the manual harness does not: **per-test coverage
analysis**. During a dry run it records which test covers which line, then for
each mutant it runs *only* the tests that actually reach the mutated line.
Typically a 5–20× speedup.

Configuration lives in [`stryker.config.mjs`](stryker.config.mjs), fully
commented.

## B2. Run it

Start with the quick pass — two files, a few minutes:

```powershell
cd c:\Users\Chintan\OneDrive\Desktop\STQA_project\backend
npm run mutation:auto:quick
```

Then the configured run — the six tested modules, 10–25 minutes:

```powershell
npm run mutation:auto
```

**Do not touch files under `src/` while it runs.** It is mutating them in place.

## B3. Read the report

```powershell
start .\mutation\reports\stryker.html
```

The HTML report is the deliverable. It gives you:

- the overall **mutation score**, and a score per file and per line;
- every mutant, colour-coded `Killed` / `Survived` / `NoCoverage` / `Timeout`;
- for each survivor, the exact source diff — hover a line to see what was changed
  and which tests ran against it.

Screenshot the summary table and a couple of survivors for your lab record.

### Stryker's verdict vocabulary

| Verdict | Meaning |
|---|---|
| **Killed** | At least one test failed. Good. |
| **Survived** | All tests passed. Your tests cannot detect this fault. |
| **NoCoverage** | No test even executed the mutated line. Worse than Survived — it means the code is untested, not just under-asserted. |
| **Timeout** | The mutant caused an infinite loop, so the run was aborted. **Counted as killed** — the tests did detect the fault, via a hang rather than an assertion. |
| **CompileError** | The mutant produced code that would not build. Excluded from the score. |
| **Ignored** | Filtered out by configuration. Excluded from the score. |

Stryker's formula, which is the one from your notes with timeouts folded in:

```
Mutation Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) × 100
```

`CompileError` and `Ignored` are deliberately outside the denominator, for the
same reason equivalent mutants should be.

## B4. Scope and thresholds

`stryker.config.mjs` mutates six files — the modules the test suite actually
targets:

```
src/sim/noise.ts   src/sim/orbit.ts   src/sim/clock.ts
src/sim/radio.ts   src/db/history.ts  src/routes/api.ts
```

That is a deliberate, and disclosable, choice: mutating `socket.ts` or
`simulation.ts`, which have no tests at all, would bury the real signal under
hundreds of trivially-surviving mutants and turn a 2-minute run into an hour.

For the honest whole-backend number — including the engines that are not yet
under test — run:

```powershell
npm run mutation:auto:full
```

Expect a much lower score. **Report both, and say which is which.** The gap
between them is itself a finding: it tells you precisely how much of the backend
has no safety net.

Thresholds are set in the config:

```js
thresholds: { high: 90, low: 70, break: 60 }
```

`break: 60` makes the command exit non-zero below 60%, so CI can enforce it.
`high` and `low` only colour the report.

## B5. If Stryker misbehaves

| Symptom | Cause and fix |
|---|---|
| `Cannot find module 'express'` / similar | The sandbox cannot see the hoisted workspace `node_modules`. `inPlace: true` is already set in the config to avoid this — make sure it has not been removed. |
| Run aborted, `src/` left dirty | `git checkout -- backend/src`. Backups are also in `mutation/.backup/`. |
| `npm warn EBADENGINE … @babel/types` | Cosmetic. Node 24.4.1 is slightly below what a transitive Babel package asks for; it works. Silence it by updating Node to ≥ 24.11 if you like. |
| Very slow | Lower `concurrency` in the config if the machine is thrashing, or narrow `mutate` to one file. |
| Lots of `Timeout` results | Raise `timeoutMS`. The simulation uses real timers and the API tests schedule a 1–3 s mock uplink delay, so 15000 ms is already generous. |

---

## Putting it in your report

A complete write-up needs all five of these:

1. **Method.** The five steps, and how the harness implements each one.
2. **Track A results.** Total mutants, killed, survived, equivalent; the raw and
   the adjusted mutation score. `mutation/reports/latest.md` has this as a table.
3. **Analysis of survivors.** For each one: what the mutation was, why the tests
   missed it, and what class of gap it represents (coverage gap / boundary gap /
   tautological test / equivalent mutant). This is where the marks are — a score
   with no analysis is a number with no argument.
4. **Step 5 evidence.** The before and after scores, and the tests you un-skipped
   to get there.
5. **Track B results.** Stryker's score and a screenshot of the HTML report, with
   a sentence on why the automated score differs from the manual one (different
   denominators, different mutant populations — the two numbers are not directly
   comparable, and saying so is the point).

### The honest caveat to include

Your notes end on this, and it is worth stating explicitly:

> The main drawback is the high cost of generating the mutants and executing each
> test case against each mutant program.

Concretely, in this project: 29 hand-written mutants take ~2 minutes; Stryker's
few hundred take 10–25 minutes over six files, and would take well over an hour
across the whole backend. Every mutant is a full test-suite execution. That cost
is why mutation testing is normally run nightly or pre-release rather than on
every commit — and why per-test coverage analysis exists at all.

---

## File map

| Path | What it is |
|---|---|
| [`mutation/mutants.mjs`](mutation/mutants.mjs) | The 29-mutant catalogue. Edit this to add your own. |
| [`mutation/run-mutation.mjs`](mutation/run-mutation.mjs) | The manual harness — Steps 1–5 and the score. |
| [`mutation/reports/latest.md`](mutation/reports/latest.md) | Human-readable report from the last manual run. |
| `mutation/reports/latest.json` | Same data, machine-readable. |
| `mutation/reports/stryker.html` | Stryker's interactive report. |
| `mutation/.backup/` | Byte copies of every file the harness has touched. |
| [`stryker.config.mjs`](stryker.config.mjs) | StrykerJS configuration, commented. |
| [`tests/mutation-killers.test.ts`](tests/mutation-killers.test.ts) | Step 5 — the tests that kill the survivors, shipped skipped. |
