import { describe, it, expect } from 'vitest';
import { RADIO_MODES } from '../../src/sim/radio';
import type { RadioMode } from '../../src/types';

const MODES = Object.keys(RADIO_MODES) as RadioMode[];

describe('RADIO_MODES catalogue', () => {
  it('defines all four payload modes', () => {
    expect(MODES.sort()).toEqual(['APRS_DIGI', 'CW_BEACON', 'FM_VOICE', 'SSTV']);
  });

  it.each(MODES)('%s has a self-consistent spec', (mode) => {
    const spec = RADIO_MODES[mode];

    expect(spec.mode).toBe(mode);                       // key matches payload
    expect(spec.label.length).toBeGreaterThan(0);
    expect(spec.description.length).toBeGreaterThan(0);
    expect(spec.txPower).toBeGreaterThan(0);
    expect(spec.bandwidth).toBeGreaterThan(0);
    expect(['2m', '70cm']).toContain(spec.band);
  });

  it.each(MODES)('%s uses legal amateur satellite frequencies', (mode) => {
    const { uplink, downlink } = RADIO_MODES[mode];
    const inBand = (f: number) =>
      (f >= 144 && f <= 148) || (f >= 430 && f <= 440);

    expect(inBand(uplink)).toBe(true);
    expect(inBand(downlink)).toBe(true);
  });

  it('labels the band consistently with the downlink frequency', () => {
    for (const mode of MODES) {
      const { band, downlink } = RADIO_MODES[mode];
      expect(band).toBe(downlink < 200 ? '2m' : '70cm');
    }
  });

  it('gives SSTV the highest TX power and CW the lowest', () => {
    const powers = MODES.map((m) => RADIO_MODES[m].txPower);
    expect(RADIO_MODES.SSTV.txPower).toBe(Math.max(...powers));
    expect(RADIO_MODES.CW_BEACON.txPower).toBe(Math.min(...powers));
  });

  it('gives CW the narrowest bandwidth', () => {
    const bws = MODES.map((m) => RADIO_MODES[m].bandwidth);
    expect(RADIO_MODES.CW_BEACON.bandwidth).toBe(Math.min(...bws));
  });
});
