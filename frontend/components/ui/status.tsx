'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Severity, SystemStatus } from '@/lib/types';

/**
 * Status indicators.
 *
 * Status colour never carries meaning on its own: every pill and dot below is
 * rendered with its text label, and the glyph differs per level, so the state is
 * legible without colour vision.
 */

const STATUS_STYLE: Record<SystemStatus, { cls: string; glyph: string }> = {
  NOMINAL: { cls: 'border-[var(--nominal)]/45 bg-[var(--nominal)]/12 text-[var(--nominal)]', glyph: '●' },
  DEGRADED: { cls: 'border-[var(--warn)]/45 bg-[var(--warn)]/12 text-[var(--warn)]', glyph: '▲' },
  ANOMALY: { cls: 'border-[var(--critical)]/50 bg-[var(--critical)]/14 text-[var(--critical)]', glyph: '■' },
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: SystemStatus;
  label?: string;
  className?: string;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[3px] font-mono text-2xs font-semibold uppercase tracking-[0.12em]',
        style.cls,
        className,
      )}
    >
      <span aria-hidden className={status !== 'NOMINAL' ? 'animate-pulse-dot' : undefined}>
        {style.glyph}
      </span>
      {label ?? status}
    </span>
  );
}

const SEVERITY_STYLE: Record<Severity, { cls: string; glyph: string }> = {
  INFO: { cls: 'text-ink-muted', glyph: '·' },
  SUCCESS: { cls: 'text-[var(--nominal)]', glyph: '✓' },
  WARN: { cls: 'text-[var(--warn)]', glyph: '▲' },
  CRITICAL: { cls: 'text-[var(--critical)]', glyph: '■' },
};

export function SeverityGlyph({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn('w-3 shrink-0 text-center font-mono text-[10px]', s.cls)}
      title={severity}
      aria-label={severity}
    >
      {s.glyph}
    </span>
  );
}

/** Small labelled up/down indicator for a link or subsystem. */
export function LinkDot({ up, label }: { up: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-[0.1em]">
      <span
        aria-hidden
        className={cn('text-[9px]', up ? 'text-[var(--nominal)]' : 'text-ink-muted')}
      >
        {up ? '●' : '○'}
      </span>
      <span className={up ? 'text-ink-dim' : 'text-ink-muted'}>{label}</span>
    </span>
  );
}

/**
 * Horizontal bar meter. `warnAbove` / `warnBelow` shade the fill with a reserved
 * status colour when the channel leaves its nominal band.
 */
export function Meter({
  value,
  min = 0,
  max = 100,
  warnBelow,
  warnAbove,
  color,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  warnBelow?: number;
  warnAbove?: number;
  color?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const breached =
    (warnBelow !== undefined && value < warnBelow) || (warnAbove !== undefined && value > warnAbove);
  const fill = breached ? 'var(--warn)' : (color ?? 'var(--accent)');

  return (
    <div className={cn('h-[5px] w-full overflow-hidden rounded-[1px] bg-[var(--line)]', className)}>
      <div
        className="h-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct * 100}%`, backgroundColor: fill }}
      />
    </div>
  );
}