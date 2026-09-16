import { describe, it, expect } from 'vitest';
import {
    EARTH_RADIUS_KM, julianDate, gmst, sunVector, propagate,
    stationEcef, elevationAt, lookAngles, footprintRadius,
    interSatelliteLos, greatCircle, freeSpacePathLoss, solveOverheadPass,
    type OrbitElements,
} from '../../src/sim/orbit';

const SAT: OrbitElements = {
    altitude: 525,
    inclination: 97.5,
    raan: 118.0,
    periodMinutes: 95.1,
    phase: 0,
};

const EPOCH = Date.UTC(2026, 0, 1);

describe('julianDate', () => {
    it('maps the Unix epoch to JD 2440587.5', () => {
        expect(julianDate(0)).toBe(2440587.5);
    });

    it('maps J2000.0 to JD 2451545.0', () => {
        expect(julianDate(Date.UTC(2000, 0, 1, 12, 0, 0))).toBeCloseTo(2451545.0, 6);
    });

    it('advances exactly one JD per day', () => {
        expect(julianDate(86_400_000) - julianDate(0)).toBe(1);
    });
});

describe('gmst', () => {
    it('always returns a normalised angle in [0, 360)', () => {
        for (let d = 0; d < 400; d++) {
            const g = gmst(EPOCH + d * 86_400_000);
            expect(g).toBeGreaterThanOrEqual(0);
            expect(g).toBeLessThan(360);
        }
    });

    it('advances ~360.986 degrees per solar day', () => {
        const a = gmst(EPOCH);
        const b = gmst(EPOCH + 86_400_000);
        const delta = ((b - a) % 360 + 360) % 360;
        expect(delta).toBeCloseTo(0.986, 1);
    });
});

describe('sunVector', () => {
    it('returns a unit vector', () => {
        for (let d = 0; d < 365; d += 30) {
            const s = sunVector(EPOCH + d * 86_400_000);
            const mag = Math.hypot(s.x, s.y, s.z);
            expect(mag).toBeCloseTo(1, 6);
        }
    });

    it('keeps declination inside +/- 23.5 degrees', () => {
        for (let d = 0; d < 365; d++) {
            const s = sunVector(EPOCH + d * 86_400_000);
            const decl = Math.asin(s.z) * 180 / Math.PI;
            expect(Math.abs(decl)).toBeLessThanOrEqual(23.5);
        }
    });
});

describe('propagate', () => {
    it('holds the orbit radius constant (circular orbit invariant)', () => {
        for (let t = 0; t < 6000; t += 137) {
            const s = propagate(SAT, EPOCH + t * 1000, EPOCH);
            const r = Math.hypot(s.eci.x, s.eci.y, s.eci.z);
            expect(r).toBeCloseTo(EARTH_RADIUS_KM + SAT.altitude, 6);
        }
    });

    it('keeps ECEF and ECI magnitudes equal (rotation preserves length)', () => {
        const s = propagate(SAT, EPOCH + 1_234_567, EPOCH);
        expect(Math.hypot(s.ecef.x, s.ecef.y, s.ecef.z))
            .toBeCloseTo(Math.hypot(s.eci.x, s.eci.y, s.eci.z), 6);
    });

    it('produces valid geographic coordinates', () => {
        for (let t = 0; t < 12_000; t += 97) {
            const s = propagate(SAT, EPOCH + t * 1000, EPOCH);
            expect(s.lat).toBeGreaterThanOrEqual(-90);
            expect(s.lat).toBeLessThanOrEqual(90);
            expect(s.lon).toBeGreaterThanOrEqual(-180);
            expect(s.lon).toBeLessThanOrEqual(180);
        }
    });

    it('never exceeds the latitude band its inclination allows', () => {
        // A 97.5 deg retrograde orbit reaches at most 180 - 97.5 = 82.5 deg.
        for (let t = 0; t < 6000; t += 31) {
            const { lat } = propagate(SAT, EPOCH + t * 1000, EPOCH);
            expect(Math.abs(lat)).toBeLessThanOrEqual(82.6);
        }
    });

    it('increments the orbit number once per period', () => {
        const period = SAT.periodMinutes * 60 * 1000;
        const a = propagate(SAT, EPOCH + period * 0.5, EPOCH).orbitNumber;
        const b = propagate(SAT, EPOCH + period * 1.5, EPOCH).orbitNumber;
        expect(b).toBe(a + 1);
    });

    it('sweeps argument of latitude through a full turn per period', () => {
        const period = SAT.periodMinutes * 60 * 1000;
        const a = propagate(SAT, EPOCH, EPOCH).argLat;
        const b = propagate(SAT, EPOCH + period, EPOCH).argLat;
        expect(((b - a) % 360 + 360) % 360).toBeCloseTo(0, 3);
    });

    it('reports a plausible LEO orbital velocity', () => {
        const s = propagate(SAT, EPOCH, EPOCH);
        expect(s.velocity).toBeGreaterThan(7.0);
        expect(s.velocity).toBeLessThan(8.0);
    });

    it('spends part of every orbit in eclipse', () => {
        const period = SAT.periodMinutes * 60 * 1000;
        const flags = new Set<boolean>();
        for (let i = 0; i < 200; i++) {
            flags.add(propagate(SAT, EPOCH + (period * i) / 200, EPOCH).sunlit);
        }
        // Not permanently lit and not permanently dark.
        expect(flags.has(true)).toBe(true);
        expect(flags.has(false)).toBe(true);
    });
});

describe('stationEcef', () => {
    it('places a point on the equator at longitude 0 on the +X axis', () => {
        const p = stationEcef(0, 0, 0);
        expect(p.x).toBeCloseTo(EARTH_RADIUS_KM, 6);
        expect(p.y).toBeCloseTo(0, 6);
        expect(p.z).toBeCloseTo(0, 6);
    });

    it('places the north pole on the +Z axis', () => {
        const p = stationEcef(90, 0, 0);
        expect(p.z).toBeCloseTo(EARTH_RADIUS_KM, 6);
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(0, 6);
    });

    it('adds site altitude to the radius', () => {
        const p = stationEcef(0, 0, 100);
        expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(EARTH_RADIUS_KM + 100, 6);
    });
});

describe('footprintRadius', () => {
    it('is zero for a satellite on the ground at 0 deg elevation', () => {
        expect(footprintRadius(0, 0)).toBeCloseTo(0, 6);
    });

    it('grows monotonically with altitude', () => {
        const a = footprintRadius(400, 0);
        const b = footprintRadius(800, 0);
        const c = footprintRadius(1200, 0);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });

    it('shrinks as the minimum elevation mask rises', () => {
        expect(footprintRadius(525, 20)).toBeLessThan(footprintRadius(525, 0));
    });

    it('never returns a negative radius', () => {
        expect(footprintRadius(525, 89)).toBeGreaterThanOrEqual(0);
    });
});

describe('greatCircle', () => {
    it('is zero for a point to itself', () => {
        expect(greatCircle({ lat: 19.07, lon: 72.90 }, { lat: 19.07, lon: 72.90 })).toBeCloseTo(0, 9);
    });

    it('gives a quarter circumference for a 90 degree equatorial separation', () => {
        const d = greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 90 });
        expect(d).toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 3);
    });

    it('gives half a circumference pole to pole', () => {
        const d = greatCircle({ lat: 90, lon: 0 }, { lat: -90, lon: 0 });
        expect(d).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 3);
    });

    it('is symmetric', () => {
        const a = { lat: 19.07, lon: 72.90 };
        const b = { lat: -33.87, lon: 151.21 };
        expect(greatCircle(a, b)).toBeCloseTo(greatCircle(b, a), 9);
    });
});

describe('freeSpacePathLoss', () => {
    it('matches the textbook value at 1 km / 1 MHz', () => {
        expect(freeSpacePathLoss(1, 1)).toBeCloseTo(32.44, 2);
    });

    it('adds 6 dB per doubling of range', () => {
        const a = freeSpacePathLoss(500, 437);
        const b = freeSpacePathLoss(1000, 437);
        expect(b - a).toBeCloseTo(6.02, 2);
    });

    it('adds 6 dB per doubling of frequency', () => {
        const a = freeSpacePathLoss(1000, 437);
        const b = freeSpacePathLoss(1000, 874);
        expect(b - a).toBeCloseTo(6.02, 2);
    });

    it('stays finite at zero range (guarded by the 0.001 km floor)', () => {
        expect(Number.isFinite(freeSpacePathLoss(0, 437))).toBe(true);
    });
});

describe('interSatelliteLos', () => {
    const R = EARTH_RADIUS_KM + 525;

    it('has line of sight between two nearby satellites', () => {
        const a = { x: R, y: 0, z: 0 };
        const b = { x: R * Math.cos(0.1), y: R * Math.sin(0.1), z: 0 };
        const result = interSatelliteLos(a, b);
        expect(result.los).toBe(true);
        expect(result.range).toBeGreaterThan(0);
    });

    it('is occulted by the Earth on opposite sides of the globe', () => {
        expect(interSatelliteLos({ x: R, y: 0, z: 0 }, { x: -R, y: 0, z: 0 }).los).toBe(false);
    });

    it('reports the straight-line separation as range', () => {
        const r = interSatelliteLos({ x: R, y: 0, z: 0 }, { x: R, y: 100, z: 0 });
        expect(r.range).toBeCloseTo(100, 6);
    });
});

describe('elevationAt / lookAngles', () => {
    it('returns an elevation in [-90, 90]', () => {
        for (let t = 0; t < 6000; t += 53) {
            const e = elevationAt(SAT, EPOCH + t * 1000, EPOCH);
            expect(e).toBeGreaterThanOrEqual(-90);
            expect(e).toBeLessThanOrEqual(90);
        }
    });

    it('returns an azimuth in [0, 360)', () => {
        for (let t = 0; t < 6000; t += 53) {
            const la = lookAngles(SAT, EPOCH + t * 1000, EPOCH);
            expect(la.azimuth).toBeGreaterThanOrEqual(0);
            expect(la.azimuth).toBeLessThan(360);
        }
    });

    it('agrees with elevationAt for the same instant', () => {
        const t = EPOCH + 900_000;
        expect(lookAngles(SAT, t, EPOCH).elevation).toBeCloseTo(elevationAt(SAT, t, EPOCH), 9);
    });

    it('never reports a range shorter than the altitude', () => {
        const la = lookAngles(SAT, EPOCH + 900_000, EPOCH);
        expect(la.range).toBeGreaterThan(SAT.altitude - 1);
    });

    it('marks the pass invisible when the satellite is below the mask', () => {
        // Sweep a whole orbit; whenever visible is true, elevation must clear 5 deg.
        for (let t = 0; t < SAT.periodMinutes * 60; t += 20) {
            const la = lookAngles(SAT, EPOCH + t * 1000, EPOCH);
            if (la.visible) expect(la.elevation).toBeGreaterThanOrEqual(5);
        }
    });
});

describe('solveOverheadPass', () => {
    it('returns wrapped angles in [0, 360)', () => {
        const { raan, phase } = solveOverheadPass(97.5, 95.1, EPOCH + 300_000, EPOCH);
        expect(raan).toBeGreaterThanOrEqual(0);
        expect(raan).toBeLessThan(360);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(360);
    });

    /**
     * The point of the function: seed the constellation so a pass happens at a
     * chosen instant. Solve for the elements, then propagate to that instant and
     * check the satellite really is high in the sky.
     */
    it('produces elements that put the satellite overhead at the target time', () => {
        const target = EPOCH + 300_000;
        const { raan, phase } = solveOverheadPass(97.5, 95.1, target, EPOCH);
        const el: OrbitElements = { altitude: 525, inclination: 97.5, periodMinutes: 95.1, raan, phase };
        expect(elevationAt(el, target, EPOCH)).toBeGreaterThan(60);
    });
});
