'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { fetchAnomalyCatalog, sendCommand, type AnomalyCatalogEntry } from '@/lib/api';
import { utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { CommandDto, CommandType } from '@/lib/types';

/**
 * Mock uplink console.
 *
 * Commands are queued, not applied instantly: the backend holds each one for a
 * simulated 1–3 s uplink delay before executing and acking it. The status column
 * shows PENDING → ACK with the measured round-trip, which is the point of the
 * panel — it demonstrates the command path, not just the effect.
 */

const STATUS_STYLE: Record<CommandDto['status'], string> = {
  PENDING: 'text-[var(--warn)]',
  ACKED: 'text-[var(--nominal)]',
  REJECTED: 'text-[var(--critical)]',
};

function ActionButton({
  label,
  hint,
  onClick,
  tone = 'default',
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  tone?: 'default' | 'warn' | 'critical';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'rounded-[2px] border px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        tone === 'default' &&
          'border-line bg-surface text-ink-dim hover:border-accent/45 hover:text-accent',
        tone === 'warn' &&
          'border-[var(--warn)]/30 bg-[var(--warn)]/[0.06] text-[var(--warn)] hover:border-[var(--warn)]/60',
        tone === 'critical' &&
          'border-[var(--critical)]/30 bg-[var(--critical)]/[0.06] text-[var(--critical)] hover:border-[var(--critical)]/60',
      )}
    >
      {label}
    </button>
  );
}

export function CommandConsole() {
  const commands = useMissionStore((s) => s.commands);
  const routing = useMissionStore((s) => s.routing);
  const mission = useMissionStore((s) => s.mission);
  const [catalog, setCatalog] = useState<AnomalyCatalogEntry[]>([]);
  const [anomalyKind, setAnomalyKind] = useState('LINK_DEGRADATION');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchAnomalyCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const issue = (type: CommandType, params: Record<string, unknown> = {}) => {
    setBusy(true);
    void sendCommand(type, params).finally(() => setTimeout(() => setBusy(false), 400));
  };

  const recent = [...commands].reverse().slice(0, 7);
  const anomalyActive = Boolean(routing?.activeAnomaly);

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Command Console"
        tag="UPLINK"
        right={
          <span className="font-mono text-2xs uppercase tracking-[0.1em] text-ink-muted">
            {mission?.persistence === 'POSTGRES' ? 'logged → postgres' : 'logged → memory'}
          </span>
        }
      />
      <PanelBody className="flex min-h-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-1">
          <ActionButton
            label="Skip to next AOS"
            hint="Fast-forward simulated time to just before the next ground-station pass"
            onClick={() => issue('SKIP_TO_AOS')}
            disabled={busy}
          />
          <ActionButton
            label="Re-evaluate route"
            hint="Force the routing engine to score all candidate routes immediately"
            onClick={() => issue('FORCE_ROUTE_EVAL')}
            disabled={busy}
          />
        </div>

        {/* anomaly injection */}
        <div className="rounded-[2px] border border-line bg-surface px-2 py-1.5">
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Fault injection
          </div>
          <select
            value={anomalyKind}
            onChange={(e) => setAnomalyKind(e.target.value)}
            className="mb-1 w-full rounded-[2px] border border-line bg-[var(--void)] px-1.5 py-1 font-mono text-[10px] text-ink-dim outline-none focus:border-accent/50"
          >
            {catalog.map((a) => (
              <option key={a.kind} value={a.kind}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="mb-1.5 font-mono text-[9px] leading-relaxed text-ink-muted">
            {catalog.find((a) => a.kind === anomalyKind)?.description ??
              'Select a fault to inject into the simulation.'}
          </p>
          <div className="grid grid-cols-2 gap-1">
            <ActionButton
              label="Inject fault"
              hint="Inject the selected anomaly and watch the routing engine react"
              tone="warn"
              onClick={() => issue('TRIGGER_ANOMALY', { kind: anomalyKind })}
              disabled={busy}
            />
            <ActionButton
              label="Clear fault"
              hint="Clear the active anomaly"
              onClick={() => issue('CLEAR_ANOMALY')}
              disabled={busy || !anomalyActive}
            />
          </div>
        </div>

        <ActionButton
          label="Reset simulation to epoch"
          hint="Restart the simulation from the mission epoch and clear all stored history"
          tone="critical"
          onClick={() => issue('RESET_SIM')}
          disabled={busy}
        />

        {/* uplink history */}
        <div className="min-h-0 flex-1">
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Uplink history
          </div>
          <div className="scroll-thin max-h-[150px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="py-2 text-center font-mono text-[10px] text-ink-muted">
                no commands issued
              </div>
            ) : (
              <ul className="space-y-[3px]">
                {recent.map((c) => (
                  <li key={c.id} className="rounded-[2px] bg-surface/60 px-1.5 py-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[10px] text-ink-dim">{c.type}</span>
                      <span
                        className={cn(
                          'tnum shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]',
                          STATUS_STYLE[c.status],
                        )}
                      >
                        {c.status === 'PENDING'
                          ? `PENDING ${c.uplinkDelay} ms`
                          : c.status === 'ACKED'
                            ? `ACK ${c.ackAt ? c.ackAt - c.issuedAt : c.uplinkDelay} ms`
                            : 'NAK'}
                      </span>
                    </div>
                    <div className="font-mono text-[9px] leading-relaxed text-ink-muted">
                      {utcTime(c.simTime)} · {c.result ?? 'awaiting spacecraft acknowledgement…'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}