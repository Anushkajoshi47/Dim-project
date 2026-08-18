'use client';

import { useEffect, useRef } from 'react';

/**
 * Spectrum waterfall.
 *
 * Each incoming spectrum frame is drawn as one row at the top of a canvas and
 * the previous contents are scrolled down, which is exactly how a real SDR
 * waterfall is built. Signal strength is mapped through a single-hue sequential
 * ramp (dark → bright cyan) — magnitude data gets a magnitude encoding, never a
 * rainbow.
 */

const ROW_HEIGHT = 2;
const FLOOR_DBM = -130;
const CEIL_DBM = -95;

/** Sequential ramp: one hue, dark to light, monotonic in lightness. */
function rampColor(norm: number): string {
  const t = Math.max(0, Math.min(1, norm));
  // Deep navy → teal → bright cyan.
  const r = Math.round(8 + t * t * 60);
  const g = Math.round(14 + t * 190);
  const b = Math.round(24 + t * 165);
  return `rgb(${r},${g},${b})`;
}

export function Waterfall({ spectrum }: { spectrum: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || spectrum.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;

    // Scroll everything down by one row, then paint the newest frame on top.
    ctx.drawImage(canvas, 0, ROW_HEIGHT);

    const binWidth = width / spectrum.length;
    for (let i = 0; i < spectrum.length; i += 1) {
      const norm = (spectrum[i] - FLOOR_DBM) / (CEIL_DBM - FLOOR_DBM);
      ctx.fillStyle = rampColor(norm);
      ctx.fillRect(i * binWidth, 0, Math.ceil(binWidth), ROW_HEIGHT);
    }
  }, [spectrum]);

  return (
    <div className="relative overflow-hidden rounded-[2px] border border-line bg-[var(--void)]">
      <canvas
        ref={canvasRef}
        width={256}
        height={64}
        className="block h-[64px] w-full"
        style={{ imageRendering: 'pixelated' }}
        role="img"
        aria-label="Spectrum waterfall: signal strength over frequency, newest at top"
      />
      {/* Centre-frequency marker */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/15" />
      <div className="flex justify-between border-t border-line px-1 py-[2px] font-mono text-[8px] text-ink-muted">
        <span>−BW/2</span>
        <span>centre</span>
        <span>+BW/2</span>
      </div>
    </div>
  );
}