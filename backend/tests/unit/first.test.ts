import { describe, it, expect } from 'vitest';
import { clamp } from '../../src/sim/noise';

describe('TestJUnit — first assert', () => {
  it('asserts a plain arithmetic truth', () => {
    expect(2 + 3).toBe(5);
  });

  it('asserts against real backend code', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
