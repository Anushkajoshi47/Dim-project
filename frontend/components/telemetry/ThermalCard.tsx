'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, THERMAL_COLORS } from '@/lib/theme';

/**
 * Thermal control subsystem — four sensors on one axis.
 *
 * Four series, so a legend is mandatory; it doubles as the live readout, which
 * keeps identity off colour alone. All four channels are degrees Celsius, so
 * they legitimately share a single y-axis (never a second scale).
 */

const SENSOR_ORDER = ['TEMP_BAT', 'TEMP_OBC', 'TEMP_RF', 'TEMP_STR'] as const;

export function ThermalCard() {
  const telemetry = useMissionStore((s) => s.telemetry);
  const history = useMissionStore((s) => s.thermalHistory);
  const sensors = telemetry?.thermal.sensors ?? [];

  return (
    <Panel>
      <PanelHeader
        title="Thermal"
        tag="TCS"
        right={
          <span className="font-mono text-2xs text-ink-muted">
            limits −20 / +50 °C
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-2">
        {/* Legend + live values in one row — identity is never colour-only. */}
        <div className="grid grid-cols-4 gap-1.5">
          {SENSOR_ORDER.map((id) => {
            const s = sensors.find((x) => x.id === id);
            const hot = s ? s.value > s.max - 6 : false;
            return (
              <div key={id} className="rounded-[2px] bg-surface px-1.5 py-1">
                <div className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="h-[2px] w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: THERMAL_COLORS[id] }}
                  />
                  <span className="truncate font-mono text-2xs uppercase text-ink-muted">
                    {s?.label ?? id.replace('TEMP_', '')}
                  </span>
                </div>
                <div
                  className="tnum font-mono text-[15px]"
                  style={{ color: hot ? 'var(--warn)' : CHROME.primary }}
                >
                  {s ? `${s.value >= 0 ? '+' : ''}${s.value.toFixed(1)}` : '—'}
                  <span className="ml-0.5 text-[9px] text-ink-muted">°C</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-[132px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={CHROME.grid} strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis
                domain={[-25, 55]}
                ticks={[-20, 0, 25, 50]}
                width={32}
                tick={{ fontSize: 9, fill: CHROME.muted }}
                axisLine={false}
                tickLine={false}
              />
              {/* Qualification limits, recessive so the data stays dominant. */}
              <ReferenceLine y={50} stroke="var(--warn)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <ReferenceLine y={-20} stroke="var(--warn)" strokeDasharray="3 3" strokeOpacity={0.5} />
              {SENSOR_ORDER.map((id) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={THERMAL_COLORS[id]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={sensors.find((s) => s.id === id)?.label ?? id}
                />
              ))}
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
                formatter={(v: number, name: string) => [`${Number(v).toFixed(2)} °C`, name]}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </PanelBody>
    </Panel>
  );
}