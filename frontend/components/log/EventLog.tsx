'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SeverityGlyph } from '@/components/ui/status';
import { utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { EventDto } from '@/lib/types';

const SOURCES = ['ALL', 'TELEMETRY', 'RADIO', 'ROUTING', 'COMMAND', 'SYSTEM'] as const;
type SourceFilter = (typeof SOURCES)[number];

const SEVERITY_TEXT: Record<EventDto['severity'], string> = {
  INFO: 'text-ink-dim',
  SUCCESS: 'text-[var(--nominal)]',
  WARN: 'text-[var(--warn)]',
  CRITICAL: 'text-[var(--critical)]',
};

const SOURCE_TAG: Record<EventDto['source'], string> = {
  TELEMETRY: 'TLM',
  RADIO: 'RF',
  ROUTING: 'AI',
  COMMAND: 'CMD',
  SYSTEM: 'SYS',
};

/**
 * Unified event timeline: telemetry alerts, routing decisions and command acks
 * on one clock. Auto-scrolls while pinned to the bottom, and stops as soon as
 * the operator scrolls up to read something.
 */
export function EventLog() {
  const events = useMissionStore((s) => s.events);
  const [filter, setFilter] = useState<SourceFilter>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const filtered = useMemo(
    () => (filter === 'ALL' ? events : events.filter((e) => e.source === filter)),
    [events, filter],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [filtered]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Event & Command Log"
        tag="LOG"
        right={
          <div className="flex overflow-hidden rounded-[2px] border border-line">
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={cn(
                  'px-1.5 py-[2px] font-mono text-[9px] uppercase tracking-[0.08em] transition-colors',
                  filter === s
                    ? 'bg-accent/18 text-accent'
                    : 'text-ink-muted hover:bg-raised hover:text-ink-dim',
                )}
              >
                {s === 'ALL' ? 'All' : SOURCE_TAG[s]}
              </button>
            ))}
          </div>
        }
      />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {filtered.length === 0 ? (
          <div className="py-4 text-center font-mono text-[11px] text-ink-muted">
            no events on this filter
          </div>
        ) : (
          <ul className="space-y-px">
            {filtered.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 rounded-[2px] px-1 py-[3px] hover:bg-surface/70"
              >
                <span className="tnum shrink-0 font-mono text-[10px] text-ink-muted">
                  {utcTime(e.simTime)}
                </span>
                <SeverityGlyph severity={e.severity} />
                <span className="w-7 shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-muted">
                  {SOURCE_TAG[e.source]}
                </span>
                <span className={cn('font-mono text-[10.5px] leading-[1.5]', SEVERITY_TEXT[e.severity])}>
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}