'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { latency, num, percent } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, SERIES, STATUS } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { LinkQuality, RouteId } from '@/lib/types';

/**
 * Inter-satellite link graph.
 *
 * Three nodes, three edges. Edge opacity and stroke follow the link's actual
 * margin from the routing engine, and packets animate along whichever edges the
 * current AI routing decision selected — so the picture is a rendering of the
 * decision, not decoration next to it.
 */

const NODE = {
  SOMAIYASAT: { x: 62, y: 44, label: 'SomaiyaSat', sub: 'Primary bus', color: SERIES[0] },
  SOMAIYAPOD: { x: 238, y: 44, label: 'SomaiyaPod', sub: 'Relay node', color: SERIES[1] },
  GROUND: { x: 150, y: 128, label: 'KJSIT GS', sub: 'Mumbai', color: CHROME.accent },
} as const;

type NodeId = keyof typeof NODE;

const EDGES: { id: LinkQuality['id']; from: NodeId; to: NodeId }[] = [
  { id: 'SAT_POD', from: 'SOMAIYASAT', to: 'SOMAIYAPOD' },
  { id: 'SAT_GS', from: 'SOMAIYASAT', to: 'GROUND' },
  { id: 'POD_GS', from: 'SOMAIYAPOD', to: 'GROUND' },
];

/** Edges that carry traffic under each route, for highlighting. */
const ROUTE_EDGES: Record<RouteId, LinkQuality['id'][]> = {
  DIRECT: ['SAT_GS'],
  RELAY_POD: ['SAT_POD', 'POD_GS'],
  STORE_FORWARD: [],
};

function Node({ id, active }: { id: NodeId; active: boolean }) {
  const n = NODE[id];
  const isGround = id === 'GROUND';
  return (
    <g>
      {active && (
        <circle
          cx={n.x}
          cy={n.y}
          r={17}
          fill={n.color}
          opacity={0.1}
          className="animate-pulse-dot"
        />
      )}
      {isGround ? (
        <>
          <circle cx={n.x} cy={n.y} r={9} fill="none" stroke={n.color} strokeWidth={1.5} />
          <line x1={n.x - 9} y1={n.y} x2={n.x + 9} y2={n.y} stroke={n.color} strokeWidth={1} />
          <line x1={n.x} y1={n.y - 9} x2={n.x} y2={n.y + 9} stroke={n.color} strokeWidth={1} />
        </>
      ) : (
        <rect
          x={n.x - 6.5}
          y={n.y - 6.5}
          width={13}
          height={13}
          fill={n.color}
          stroke="#0b1219"
          strokeWidth={1.5}
          transform={`rotate(45 ${n.x} ${n.y})`}
        />
      )}
      {/* Labels clear the marker: the rotated 13px square spans ±9.2px. */}
      <text
        x={n.x}
        y={isGround ? n.y + 24 : n.y - 24}
        textAnchor="middle"
        fill={n.color}
        fontSize={9.5}
        fontWeight={600}
        fontFamily="ui-monospace, monospace"
        letterSpacing="0.06em"
      >
        {n.label}
      </text>
      <text
        x={n.x}
        y={isGround ? n.y + 34 : n.y - 14}
        textAnchor="middle"
        fill={CHROME.muted}
        fontSize={8}
        fontFamily="ui-monospace, monospace"
      >
        {n.sub}
      </text>
    </g>
  );
}

export function LinkGraph() {
  const routing = useMissionStore((s) => s.routing);
  const packets = useMissionStore((s) => s.packets);

  const links = routing?.links ?? [];
  const route = routing?.decision.route ?? 'STORE_FORWARD';
  const activeEdges = ROUTE_EDGES[route];

  const linkById = useMemo(
    () => Object.fromEntries(links.map((l) => [l.id, l])) as Record<LinkQuality['id'], LinkQuality>,
    [links],
  );

  const activeNodes = new Set<NodeId>(
    route === 'DIRECT'
      ? ['SOMAIYASAT', 'GROUND']
      : route === 'RELAY_POD'
        ? ['SOMAIYASAT', 'SOMAIYAPOD', 'GROUND']
        : ['SOMAIYASAT'],
  );

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Inter-Satellite Link"
        tag="ISL"
        right={
          <span className="font-mono text-2xs text-ink-muted">
            queue {routing?.queueDepth ?? 0} · {num(routing?.throughput, 0)} kbps
          </span>
        }
      />
      <PanelBody className="flex min-h-0 flex-col gap-2 p-0">
        <div className="relative shrink-0 bg-[var(--void)]/40">
          <svg viewBox="0 0 300 178" className="h-[178px] w-full">
            {/* edges */}
            {EDGES.map((e) => {
              const link = linkById[e.id];
              const a = NODE[e.from];
              const b = NODE[e.to];
              const up = link?.up ?? false;
              const carrying = activeEdges.includes(e.id);
              const quality = link?.quality ?? 0;

              return (
                <g key={e.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={carrying ? CHROME.accent : up ? CHROME.axis : CHROME.grid}
                    strokeWidth={carrying ? 2 : 1}
                    strokeDasharray={up ? undefined : '3 4'}
                    opacity={carrying ? 0.95 : up ? 0.35 + quality * 0.4 : 0.4}
                  />
                  <text
                    x={(a.x + b.x) / 2 + (e.id === 'SAT_POD' ? 0 : e.id === 'SAT_GS' ? -30 : 30)}
                    y={(a.y + b.y) / 2 + (e.id === 'SAT_POD' ? -6 : 0)}
                    textAnchor="middle"
                    fill={up ? CHROME.secondary : CHROME.muted}
                    fontSize={8}
                    fontFamily="ui-monospace, monospace"
                  >
                    {up ? `${link.marginDb.toFixed(1)} dB` : 'no link'}
                  </text>
                </g>
              );
            })}

            {/* animated packets */}
            <AnimatePresence>
              {packets.map((p) => {
                const a = NODE[p.from as NodeId];
                const b = NODE[p.to as NodeId];
                if (!a || !b) return null;
                return (
                  <motion.circle
                    key={p.id}
                    r={2.6}
                    fill={p.lost ? STATUS.critical : CHROME.accent}
                    initial={{ cx: a.x, cy: a.y, opacity: 0 }}
                    animate={
                      p.lost
                        ? { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, opacity: [0, 1, 0] }
                        : { cx: b.x, cy: b.y, opacity: [0, 1, 1, 0] }
                    }
                    exit={{ opacity: 0 }}
                    transition={{ duration: p.durationMs / 1000, ease: 'linear' }}
                  />
                );
              })}
            </AnimatePresence>

            {(Object.keys(NODE) as NodeId[]).map((id) => (
              <Node key={id} id={id} active={activeNodes.has(id)} />
            ))}

            {route === 'STORE_FORWARD' && (
              <text
                x={150}
                y={168}
                textAnchor="middle"
                fill={CHROME.muted}
                fontSize={9}
                fontFamily="ui-monospace, monospace"
              >
                no contact — buffering to payload store
              </text>
            )}
          </svg>
        </div>

        {/* per-link table — the numbers behind the picture */}
        <div className="shrink-0 border-t border-line px-2.5 py-1.5">
          <table className="w-full font-mono text-[10px]">
            <thead>
              <tr className="text-ink-muted">
                <th className="text-left font-normal uppercase tracking-[0.1em]">Link</th>
                <th className="text-right font-normal uppercase tracking-[0.1em]">State</th>
                <th className="text-right font-normal uppercase tracking-[0.1em]">Margin</th>
                <th className="text-right font-normal uppercase tracking-[0.1em]">Latency</th>
                <th className="text-right font-normal uppercase tracking-[0.1em]">Loss</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {EDGES.map((e) => {
                const l = linkById[e.id];
                const carrying = activeEdges.includes(e.id);
                return (
                  <tr key={e.id} className={cn(carrying ? 'text-accent' : 'text-ink-dim')}>
                    <td className="py-[1px] text-left">
                      {e.id.replace('_', '→').replace('SAT', 'SAT').replace('GS', 'GND')}
                    </td>
                    <td className="text-right">
                      <span className={l?.up ? 'text-[var(--nominal)]' : 'text-ink-muted'}>
                        {l?.up ? 'UP' : 'DOWN'}
                      </span>
                    </td>
                    <td className="text-right">{l?.up ? `${l.marginDb.toFixed(1)} dB` : '—'}</td>
                    <td className="text-right">{l?.up ? latency(l.latencyMs) : '—'}</td>
                    <td className="text-right">{l?.up ? percent(l.packetLoss, 2) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelBody>
    </Panel>
  );
}