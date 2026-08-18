'use client';

import { motion } from 'framer-motion';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { latency, percent } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, SERIES } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * The routing decision, with its reasoning exposed.
 *
 * The scorer publishes each candidate's weighted factor contributions, so this
 * panel shows *why* a route won rather than only which one did — the difference
 * between a demo that asserts autonomy and one that evidences it.
 */
export function RoutingDecision() {
  const routing = useMissionStore((s) => s.routing);
  const decision = routing?.decision;
  const anomaly = routing?.activeAnomaly;

  if (!decision) {
    return (
      <Panel>
        <PanelHeader title="Autonomous Routing" tag="AI" />
        <PanelBody>
          <div className="font-mono text-[11px] text-ink-muted">awaiting first decision…</div>
        </PanelBody>
      </Panel>
    );
  }

  const confidencePct = decision.confidence * 100;
  const confTone =
    confidencePct >= 75 ? 'var(--nominal)' : confidencePct >= 50 ? 'var(--s4)' : 'var(--warn)';

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Autonomous Routing"
        tag="AI"
        right={
          anomaly ? (
            <span className="font-mono text-2xs uppercase tracking-[0.1em] text-[var(--warn)]">
              ▲ {anomaly.label}
            </span>
          ) : (
            <span className="font-mono text-2xs text-ink-muted">
              hist. loss {percent(routing?.historicalLoss ?? 0, 2)}
            </span>
          )
        }
      />
      <PanelBody className="flex min-h-0 flex-col gap-2 overflow-y-auto scroll-thin">
        {/* selected route */}
        <div className="rounded-[2px] border border-line bg-surface px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
              Selected route
            </span>
            <span className="font-mono text-2xs text-ink-muted">
              {latency(decision.estLatency)} · loss {percent(decision.estPacketLoss, 2)}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <motion.span
              key={decision.route}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="font-mono text-[17px] font-semibold tracking-[0.02em] text-accent"
            >
              {decision.label}
            </motion.span>
            <span className="tnum font-mono text-[17px]" style={{ color: confTone }}>
              {confidencePct.toFixed(0)}
              <span className="ml-0.5 text-[10px] text-ink-muted">% conf</span>
            </span>
          </div>
          <div className="mt-1.5 h-[4px] w-full overflow-hidden rounded-[1px] bg-[var(--line)]">
            <motion.div
              className="h-full"
              style={{ backgroundColor: confTone }}
              animate={{ width: `${confidencePct}%` }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* natural-language rationale */}
        <div>
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Reasoning
          </div>
          <p className="font-mono text-[10.5px] leading-[1.6] text-ink-dim">
            {decision.reasoning}
          </p>
        </div>

        {/* candidate scores */}
        <div>
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Candidate evaluation
          </div>
          <div className="space-y-1">
            {decision.candidates.map((c) => {
              const chosen = c.route === decision.route;
              return (
                <div
                  key={c.route}
                  className={cn(
                    'rounded-[2px] border px-2 py-1.5',
                    chosen ? 'border-accent/40 bg-accent/[0.06]' : 'border-line bg-surface/50',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'font-mono text-[11px]',
                        chosen ? 'text-accent' : c.feasible ? 'text-ink-dim' : 'text-ink-muted',
                      )}
                    >
                      {chosen && <span aria-hidden className="mr-1">▸</span>}
                      {c.label}
                    </span>
                    <span className="tnum font-mono text-[11px] text-ink-dim">
                      {c.feasible ? `${(c.probability * 100).toFixed(0)}%` : 'infeasible'}
                    </span>
                  </div>

                  {/*
                    Stacked factor contributions. The outer track is the full
                    score range, the filled span is this route's total score, and
                    the segments inside divide that span in proportion to each
                    factor's contribution — so bars stay inside the card and are
                    directly comparable between candidates.
                  */}
                  {c.feasible && (
                    <div className="mt-1 h-[4px] w-full overflow-hidden bg-[var(--line)]">
                      <div
                        className="flex h-full gap-[2px]"
                        style={{ width: `${Math.min(100, c.score * 100)}%` }}
                      >
                        {c.factors.map((f, i) => (
                          <div
                            key={f.name}
                            title={`${f.name}: ${(f.contribution * 100).toFixed(1)} of ${(c.score * 100).toFixed(0)} points (weight ${f.weight})`}
                            style={{
                              flexGrow: Math.max(0.0001, f.contribution),
                              flexBasis: 0,
                              backgroundColor: SERIES[i % SERIES.length],
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[9.5px] text-ink-muted">{c.note}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* factor legend — identity never by colour alone */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-1.5">
          {decision.candidates[0]?.factors.map((f, i) => (
            <span key={f.name} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-[2px] w-3 rounded-full"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-muted">
                {f.name} ×{f.weight}
              </span>
            </span>
          ))}
        </div>

        <div className="font-mono text-[9px] text-ink-muted" style={{ color: CHROME.muted }}>
          Heuristic scorer · softmax over weighted features · 5% hysteresis band prevents route flapping
        </div>
      </PanelBody>
    </Panel>
  );
}