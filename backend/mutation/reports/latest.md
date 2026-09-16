# Manual mutation testing report

Generated: 2026-08-19T11:57:44.036Z

## Mutation score

```
Mutation Score = (Killed / Total) * 100 = (21 / 29) * 100 = 72.41%
Adjusted (equivalent mutants excluded) = (21 / 26) * 100 = 80.77%
```

- Total mutants: **29**
- Killed: **21**
- Survived: **8** (of which 3 are equivalent / unkillable)
- Errored (could not be applied): **0**

## Results

| ID | Status | File | Operator | Killed by |
|----|--------|------|----------|-----------|
| M01 | ✅ KILLED | `src/sim/noise.ts` | MCR — swap the clamp bounds | `clamp passes through a value inside the band`<br>`clamp clamps to the lower bound`<br>_+1 more_ |
| M02 | ✅ KILLED | `src/sim/noise.ts` | AOR — subtraction becomes addition in lerp | `lerp returns the endpoints at t=0 and t=1` |
| M03 | ✅ KILLED | `src/sim/noise.ts` | MCR — round becomes floor | `round honours an explicit precision` |
| M04 | ✅ KILLED | `src/sim/noise.ts` | AOR — sign flip in the Ornstein-Uhlenbeck decay term | `OrnsteinUhlenbeck stays numerically stable at very large time steps`<br>`OrnsteinUhlenbeck reverts toward the mean with zero volatility`<br>_+1 more_ |
| M05 | ✅ KILLED | `src/sim/noise.ts` | SDL — drop the "1 -" from the LagFilter blend factor | `LagFilter does not move on a zero-length step`<br>`LagFilter reaches ~63% of the step after exactly one time constant`<br>_+1 more_ |
| M06 | ✅ KILLED | `src/sim/noise.ts` | AOR — division becomes multiplication in the EWMA half-life | `Ewma moves exactly halfway in one half-life` |
| M07 | ✅ KILLED | `src/sim/noise.ts` | SVR — shrink the id counter modulus | `nextId never collides across many calls` |
| M08 | ❌ SURVIVED | `src/sim/orbit.ts` | SVR — truncate the Earth radius constant | — |
| M09 | ✅ KILLED | `src/sim/orbit.ts` | AOR — sign flip on the Julian Date offset | `julianDate maps the Unix epoch to JD 2440587.5`<br>`julianDate maps J2000.0 to JD 2451545.0`<br>_+2 more_ |
| M10 | ❌ SURVIVED | `src/sim/orbit.ts` | SDL — remove the GMST angle normalisation | — |
| M11 | ✅ KILLED | `src/sim/orbit.ts` | SVR — halve the range coefficient in the path-loss equation | `freeSpacePathLoss adds 6 dB per doubling of range` |
| M12 | ➖ SURVIVED (equivalent) | `src/sim/orbit.ts` | SDL — remove the negative-radius guard | — |
| M13 | ✅ KILLED | `src/sim/orbit.ts` | ROR — invert the inter-satellite occultation test | `interSatelliteLos has line of sight between two nearby satellites`<br>`interSatelliteLos is occulted by the Earth on opposite sides of the globe` |
| M14 | ❌ SURVIVED | `src/sim/orbit.ts` | SVR — delete the sun-synchronous nodal precession | — |
| M15 | ✅ KILLED | `src/sim/orbit.ts` | ROR — invert the azimuth wrap condition | `elevationAt / lookAngles returns an azimuth in [0, 360)` |
| M16 | ✅ KILLED | `src/sim/clock.ts` | SDL — drop the lower bound from the speed clamp | `SimClock clamps speed to the documented 0.25x–240x band` |
| M17 | ➖ SURVIVED (equivalent) | `src/sim/clock.ts` | ROR — weaken the non-positive advance guard | — |
| M18 | ✅ KILLED | `src/sim/clock.ts` | AOR — multiplication becomes division in the clock rate | `SimClock advances 30x sim time per wall second at 30x speed`<br>`SimClock preserves elapsed sim time across repeated speed changes`<br>_+1 more_ |
| M19 | ✅ KILLED | `src/sim/radio.ts` | SVR — lower the SSTV transmit power below CW | `RADIO_MODES catalogue gives SSTV the highest TX power and CW the lowest` |
| M20 | ✅ KILLED | `src/db/history.ts` | SVR — enlarge the in-memory ring buffer | `telemetry ring buffer caps the ring at 4000 rows and drops the oldest` |
| M21 | ➖ SURVIVED (equivalent) | `src/db/history.ts` | ROR — off-by-one in the ring eviction guard | — |
| M22 | ✅ KILLED | `src/db/history.ts` | MCR — take the oldest events instead of the newest | `event log returns the newest N when a limit is given` |
| M23 | ✅ KILLED | `src/db/history.ts` | ROR — off-by-one in the command-update index guard | `command log updateCommand replaces the record in place rather than appending` |
| M24 | ❌ SURVIVED | `src/db/history.ts` | ROR — exclude the lower bound of the history window | — |
| M25 | ✅ KILLED | `src/routes/api.ts` | SVR — wrong HTTP status for an unknown telemetry channel | `GET /api/history/:channel rejects an unknown channel with 400 and the valid list` |
| M26 | ✅ KILLED | `src/routes/api.ts` | COR — invert the channel whitelist check | `GET /api/history/:channel accepts the "power" channel`<br>`GET /api/history/:channel accepts the "thermal" channel`<br>_+9 more_ |
| M27 | ❌ SURVIVED | `src/routes/api.ts` | MCR — min becomes max on the history row cap | — |
| M28 | ✅ KILLED | `src/routes/api.ts` | SVR — wrong success status on the mock uplink | `POST /api/commands accepts a valid command with 202 and a PENDING record`<br>`POST /api/commands defaults params to an empty object when omitted`<br>_+7 more_ |
| M29 | ✅ KILLED | `src/routes/api.ts` | SVR — change the default history window | `GET /api/history/:channel defaults to a 30 minute window`<br>`GET /api/history/:channel falls back to 30 minutes for a non-numeric ?minutes=` |

## Surviving mutants that need better tests

### M08 — `src/sim/orbit.ts`

- **Operator:** SVR — truncate the Earth radius constant
- **Mutation:** `export const EARTH_RADIUS_KM = 6371.0088;` → `export const EARTH_RADIUS_KM = 6371;`
- **Why it survived:** DELIBERATE SURVIVOR. The orbit tests assert against EARTH_RADIUS_KM itself, so the constant is both the code and the oracle and moves with the mutant. This is a self-referential (tautological) test — the single most valuable defect mutation testing finds. See MUTATION-TESTING.md.

### M10 — `src/sim/orbit.ts`

- **Operator:** SDL — remove the GMST angle normalisation
- **Mutation:** `return (((seconds / 240) % 360) + 360) % 360;` → `return (seconds / 240) % 360;`
- **Why it survived:** GMST may now come back negative. The "always in [0, 360)" property test over 400 days is what catches it.

### M14 — `src/sim/orbit.ts`

- **Operator:** SVR — delete the sun-synchronous nodal precession
- **Mutation:** `const raanDeg = el.raan + (0.9856 * elapsedSec) / 86400;` → `const raanDeg = el.raan + (0.0 * elapsedSec) / 86400;`
- **Why it survived:** DELIBERATE SURVIVOR. Nodal regression is ~1 degree PER DAY, but no test propagates for more than a couple of orbits, so the effect never grows large enough to fail an assertion. A genuine test-coverage gap: the orbit is only verified over short horizons.

### M24 — `src/db/history.ts`

- **Operator:** ROR — exclude the lower bound of the history window
- **Mutation:** `return ring.filter((r) => r.simTime >= fromSim && r.simTime <= toSim).slice(-limit);` → `return ring.filter((r) => r.simTime > fromSim && r.simTime <= toSim).slice(-limit);`
- **Why it survived:** DELIBERATE SURVIVOR. A real off-by-one: a sample landing exactly on `from` is now dropped. It survives because no history test places a sample ON the boundary — the window (1500, 2500) is queried against rows at 1000/2000/3000. Textbook motivation for boundary value analysis. KILLABLE — see Step 5.

### M27 — `src/routes/api.ts`

- **Operator:** MCR — min becomes max on the history row cap
- **Mutation:** `const limit = Math.min(Number(req.query.limit) || 1500, 5000);` → `const limit = Math.max(Number(req.query.limit) || 1500, 5000);`
- **Why it survived:** DELIBERATE SURVIVOR. The cap that protects the API from an unbounded query is inverted — ?limit=100000 would now be honoured. It survives because no API test ever sends a ?limit= parameter. Pure coverage gap. KILLABLE — see Step 5.

