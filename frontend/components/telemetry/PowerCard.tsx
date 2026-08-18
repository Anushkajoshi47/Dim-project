'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Field, Readout } from '@/components/ui/readout';
import { Meter } from '@/components/ui/status';
import { num, signed, utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, SERIES } from '@/lib/theme';

/**
 * Electrical power subsystem.
 *
 * The state-of-charge trace is a single series, so it carries no legend — the
 * panel title names it. Eclipse periods are shaded behind the trace, which is
 * what makes the sawtooth charge/discharge cycle read as *caused by* the orbit
 * rather than as arbitrary wobble.
 */
export function PowerCard() {
  const telemetry = useMissionStore((s) => s.telemetry);
  const history = useMissionStore((s) => s.powerHistory);
  const power = telemetry?.power;

  const socTone =
    !power ? 'muted' : power.stateOfCharge < 22 ? 'critical' : power.stateOfCharge < 38 ? 'warn' : 'default';

  return (
    <Panel>
      <PanelHeader
        title="Electrical Power"
        tag="EPS"
        right={
          <span
            className="font-mono text-2xs uppercase tracking-[0.1em]"
            style={{ color: power?.eclipse ? CHROME.muted : SERIES[3] }}
          >
            {power?.eclipse ? '◐ Eclipse' : '☀ Sunlit'}
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          <Readout
            label="Bus voltage"
            value={num(power?.batteryVoltage, 3)}
            unit="V"
            size="lg"
            hint="2S Li-ion pack terminal voltage (6.00–8.40 V)"
          />
          <Readout
            label="State of charge"
            value={num(power?.stateOfCharge, 1)}
            unit="%"
            size="lg"
            tone={socTone as 'default'}
          />
          <Readout
            label="Batt current"
            value={signed(power?.batteryCurrent, 3)}
            unit="A"
            size="lg"
            tone={power?.charging ? 'nominal' : 'default'}
            hint="Positive is charging, negative is discharging"
          />
        </div>

        <Meter
          value={power?.stateOfCharge ?? 0}
          warnBelow={38}
          color={SERIES[2]}
          className="mt-0.5"
        />

        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Solar in" value={`${num(power?.solarPowerIn, 2)} W`} />
          <Field label="Load" value={`${num(power?.loadPower, 2)} W`} />
          <Field
            label="Net"
            value={`${signed((power?.solarPowerIn ?? 0) - (power?.loadPower ?? 0), 2)} W`}
            tone={power?.charging ? 'nominal' : 'warn'}
          />
          <Field label="Batt temp" value={`${num(power?.batteryTemp, 1)} °C`} />
        </div>

        {/* Per-face array currents */}
        <div>
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Solar array — current per face
          </div>
          <div className="grid grid-cols-5 gap-1">
            {power?.solarCurrents.map((f) => (
              <div key={f.face} className="rounded-[2px] bg-surface px-1 py-1 text-center">
                <div className="font-mono text-2xs text-ink-muted">{f.face}</div>
                <div className="tnum font-mono text-[11px] text-ink">{f.current.toFixed(3)}</div>
                <Meter
                  value={f.current}
                  max={0.24}
                  color={SERIES[3]}
                  className="mt-1 h-[3px]"
                />
              </div>
            ))}
          </div>
        </div>

        {/* SOC trend with eclipse shading */}
        <div className="h-[86px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <defs>
                <linearGradient id="socFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[2]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={SERIES[2]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                width={34}
                tick={{ fontSize: 9, fill: CHROME.muted }}
                axisLine={false}
                tickLine={false}
              />
              {/* Eclipse periods, drawn first so the SOC trace sits on top. */}
              <Area
                type="stepAfter"
                dataKey={(d: { eclipse: number }) => d.eclipse * 100}
                stroke="none"
                fill={CHROME.grid}
                fillOpacity={0.85}
                isAnimationActive={false}
                name="Eclipse"
              />
              <Area
                type="monotone"
                dataKey="soc"
                stroke={SERIES[2]}
                strokeWidth={2}
                fill="url(#socFill)"
                isAnimationActive={false}
                dot={false}
                name="State of charge"
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
                formatter={(v: number, name: string) =>
                  name === 'Eclipse'
                    ? [v > 0 ? 'in eclipse' : 'sunlit', 'Illumination']
                    : [`${Number(v).toFixed(1)} %`, name]
                }
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </PanelBody>
    </Panel>
  );
}