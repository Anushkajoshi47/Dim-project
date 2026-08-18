'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A labelled numeric readout — the console's fundamental unit of information.
 *
 * Values are monospace and tabular so digits do not jitter as they update, and
 * the unit is typographically subordinate to the number.
 */
export function Readout({
  label,
  value,
  unit,
  tone = 'default',
  size = 'md',
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: 'default' | 'accent' | 'nominal' | 'warn' | 'critical' | 'muted';
  size?: 'sm' | 'md' | 'lg';
  hint?: string;
  className?: string;
}) {
  const toneClass = {
    default: 'text-ink',
    accent: 'text-accent',
    nominal: 'text-[var(--nominal)]',
    warn: 'text-[var(--warn)]',
    critical: 'text-[var(--critical)]',
    muted: 'text-ink-muted',
  }[tone];

  const sizeClass = {
    sm: 'text-[13px]',
    md: 'text-[17px]',
    lg: 'text-[26px] leading-none',
  }[size];

  return (
    <div className={cn('min-w-0', className)} title={hint}>
      <div className="truncate font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('tnum font-mono font-medium', sizeClass, toneClass)}>{value}</span>
        {unit && <span className="font-mono text-[10px] text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}

/** Compact key/value row for dense specification lists. */
export function Field({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'accent' | 'nominal' | 'warn' | 'critical' | 'muted';
  className?: string;
}) {
  const toneClass = {
    default: 'text-ink',
    accent: 'text-accent',
    nominal: 'text-[var(--nominal)]',
    warn: 'text-[var(--warn)]',
    critical: 'text-[var(--critical)]',
    muted: 'text-ink-muted',
  }[tone];

  return (
    <div className={cn('flex items-baseline justify-between gap-2 py-[3px]', className)}>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <span className={cn('tnum truncate font-mono text-[11px]', toneClass)}>{value}</span>
    </div>
  );
}