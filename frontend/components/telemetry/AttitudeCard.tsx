'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Field, Readout } from '@/components/ui/readout';
import { num, signed, utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, SERIES } from '@/lib/theme';

const MODE_LABEL: Record<string, { text: string; tone: string }> = {
  DETUMBLE: { text: 'Detumbling', tone: 'var(--warn)' },
  COARSE_POINT: { text: 'Coarse point', tone: 'var(--s4)' },
  FINE_POINT: { text: 'Fine point', tone: 'var(--nominal)' },
};

/**
 * Attitude determination & control.
 *
 * The body-rate trace tells the mission's opening story: launch tumble bleeding
 * off through magnetorquer detumbling into stable nadir pointing. A single
 * series, so no legend — the panel title names it.
 */
export function AttitudeCard() {
  const telemetry = useMissionStore((s) => s.telemetry);
  const history = useMissionStore((s) => s.attitudeHistory);
  const att = telemetry?.attitude;
  const mode = MODE_LABEL[att?.mode ?? 'DETUMBLE'];

  return (
    <Panel>
      <PanelHeader
        title="Attitude"
        tag="ADCS"
        right={
          <span
            className="font-mono text-2xs uppercase tracking-[0.1em]"
            style={{ color: mode.tone }}
          >
            {mode.text}
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          <Readout label="Pitch" value={signed(att?.pitch, 1)} unit="°" />
          <Readout label="Roll" value={signed(att?.roll, 1)} unit="°" />
          <Readout label="Yaw" value={num(att?.yaw, 1)} unit="°" />
        </div>

        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Body rate" value={`${num(att?.spinRate, 3)} °/s`} />
          <Field
            label="Point err"
            value={`${num(att?.pointingError, 2)} °`}
            tone={(att?.pointingError ?? 0) > 5 ? 'warn' : 'nominal'}
          />
          <Field
            label="Rates x/y/z"
            value={`${signed(att?.rates.x, 2)} ${signed(att?.rates.y, 2)} ${signed(att?.rates.z, 2)}`}
            className="col-span-2"
          />
          <Field
            label="Quaternion"
            value={
              att
                ? `${att.quaternion.w.toFixed(3)} ${att.quaternion.x.toFixed(3)} ${att.quaternion.y.toFixed(3)} ${att.quaternion.z.toFixed(3)}`
                : '—'
            }
            className="col-span-2"
          />
        </div>

        <div>
          <div className="mb-0.5 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Body rate magnitude · °/s
          </div>
          <div className="h-[74px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <XAxis dataKey="t" hide />
                <YAxis
                  domain={[0, 'auto']}
                  width={32}
                  tick={{ fontSize: 9, fill: CHROME.muted }}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  axisLine={false}
                  tickLine={false}
                />
                <Line
                  type="monotone"
                  dataKey="spinRate"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="Body rate"
                />
                <Tooltip
                  cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
                  contentStyle={{
                    background: CHROME.surface,
                    border: `1px solid ${CHROME.axis}`,
                    borderRadius: 3,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                  }}
                  labelFormatter={(t) => `${utcTime(Number(t))} UTC`}
                  formatter={(v: number) => [`${Number(v).toFixed(3)} °/s`, 'Body rate']}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}