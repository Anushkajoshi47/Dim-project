'use client';

import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Field, Readout } from '@/components/ui/readout';
import { Meter } from '@/components/ui/status';
import { duration, num } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { SERIES } from '@/lib/theme';

const WATCHDOG_TONE: Record<string, 'nominal' | 'accent' | 'critical'> = {
  OK: 'nominal',
  PETTED: 'accent',
  TRIPPED: 'critical',
};

/** On-board computer health. Instantaneous values only — no chart needed. */
export function ObcCard() {
  const telemetry = useMissionStore((s) => s.telemetry);
  const obc = telemetry?.obc;

  return (
    <Panel>
      <PanelHeader
        title="On-Board Computer"
        tag="OBC"
        right={
          <span className="font-mono text-2xs uppercase tracking-[0.1em] text-ink-muted">
            {obc?.rebootCount ?? 0} resets
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          <Readout label="Uptime" value={duration(obc?.uptime)} size="sm" />
          <Readout
            label="Watchdog"
            value={obc?.watchdog ?? '—'}
            size="sm"
            tone={WATCHDOG_TONE[obc?.watchdog ?? 'OK']}
          />
          <Readout label="Store free" value={num(obc?.storageFree, 1)} unit="%" size="sm" />
        </div>

        <div className="space-y-1.5">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xs uppercase tracking-[0.1em] text-ink-muted">
                CPU load
              </span>
              <span className="tnum font-mono text-[11px] text-ink">
                {num(obc?.cpuLoad, 1)} %
              </span>
            </div>
            <Meter value={obc?.cpuLoad ?? 0} warnAbove={85} color={SERIES[0]} />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xs uppercase tracking-[0.1em] text-ink-muted">
                Memory use
              </span>
              <span className="tnum font-mono text-[11px] text-ink">
                {num(obc?.memoryUse, 1)} %
              </span>
            </div>
            <Meter value={obc?.memoryUse ?? 0} warnAbove={88} color={SERIES[1]} />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xs uppercase tracking-[0.1em] text-ink-muted">
                Payload store used
              </span>
              <span className="tnum font-mono text-[11px] text-ink">
                {num(100 - (obc?.storageFree ?? 0), 1)} %
              </span>
            </div>
            <Meter value={100 - (obc?.storageFree ?? 0)} warnAbove={90} color={SERIES[3]} />
          </div>
        </div>

        <Field label="Last reset" value={obc?.lastResetReason ?? '—'} />
      </PanelBody>
    </Panel>
  );
}