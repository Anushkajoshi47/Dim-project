'use client';

import { useEffect, useState } from 'react';
import { sendCommand } from '@/lib/api';
import { countdown, duration, utcDate, utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/ui/status';

const SPEEDS = [1, 5, 15, 30, 60, 120];

/**
 * Mission header: identity, the UTC simulation clock, sim-rate control, overall
 * vehicle status and the AOS/LOS countdown.
 */
export function TopBar() {
  const { orbit, telemetry, routing, mission, connected, ready } = useMissionStore();
  // Local ticker so the countdown advances smoothly between 1 Hz orbit frames.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const clock = orbit?.clock;
  const speed = clock?.speed ?? 1;
  // Interpolate sim time between frames using the elapsed wall time and rate.
  const simNow = clock ? clock.simTime + (Date.now() - clock.wallTime) * clock.speed : 0;

  const pass = orbit?.pass;
  const status = telemetry?.status ?? 'NOMINAL';
  const anomaly = routing?.activeAnomaly ?? null;

  const passLabel = pass?.inPass ? 'LOS IN' : 'NEXT AOS';
  const passTarget = pass?.inPass ? (pass?.los ?? null) : (pass?.aos ?? null);

  return (
    <header className="flex shrink-0 items-stretch justify-between gap-3 border-b border-line bg-panel px-3 py-1.5">
      {/* identity */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-bold tracking-[0.16em] text-accent">
            KJS-SRS-01
          </span>
          <span className="hidden truncate font-mono text-[11px] tracking-[0.08em] text-ink-dim sm:inline">
            SOMAIYASAT · SOMAIYAPOD
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[3px] font-mono text-2xs uppercase tracking-[0.1em]',
            connected && ready
              ? 'border-[var(--nominal)]/40 bg-[var(--nominal)]/10 text-[var(--nominal)]'
              : 'border-[var(--critical)]/45 bg-[var(--critical)]/12 text-[var(--critical)]',
          )}
          title={connected ? 'Telemetry stream connected' : 'Telemetry stream down'}
        >
          <span aria-hidden className={connected ? '' : 'animate-pulse-dot'}>
            {connected ? '●' : '○'}
          </span>
          {connected && ready ? 'LINK UP' : 'NO STREAM'}
        </span>
      </div>

      {/* clock */}
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
            Sim time · UTC
          </div>
          <div className="tnum font-mono text-[15px] leading-tight text-ink">
            {utcTime(simNow)}
            <span className="ml-1.5 text-[10px] text-ink-muted">{utcDate(simNow)}</span>
          </div>
        </div>

        <div className="hidden text-right lg:block">
          <div className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">MET</div>
          <div className="tnum font-mono text-[15px] leading-tight text-ink-dim">
            {duration(clock?.missionElapsed)}
          </div>
        </div>

        {/* sim rate */}
        <div>
          <div className="mb-[3px] font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
            Sim rate
          </div>
          <div className="flex overflow-hidden rounded-[2px] border border-line">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void sendCommand('SET_SIM_SPEED', { speed: s })}
                className={cn(
                  'px-1.5 py-[2px] font-mono text-[10px] tabular-nums transition-colors',
                  Math.abs(speed - s) < 0.01
                    ? 'bg-accent/18 text-accent'
                    : 'text-ink-muted hover:bg-raised hover:text-ink-dim',
                )}
                title={`Run the simulation at ${s}× real time`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {/* pass countdown */}
        <div className="min-w-[92px] text-right">
          <div className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
            {passLabel}
          </div>
          <div
            className={cn(
              'tnum font-mono text-[15px] leading-tight',
              pass?.inPass ? 'text-[var(--nominal)]' : 'text-ink-dim',
            )}
          >
            {countdown(passTarget, simNow)}
            {pass && pass.maxElevation > 0 && (
              <span className="ml-1 text-[10px] text-ink-muted">
                {pass.maxElevation.toFixed(0)}°
              </span>
            )}
          </div>
        </div>

        <StatusPill
          status={status}
          label={anomaly ? anomaly.label : status}
          className="min-w-[120px] justify-center"
        />
      </div>
    </header>
  );
}