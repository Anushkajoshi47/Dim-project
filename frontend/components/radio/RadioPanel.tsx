'use client';

import { useEffect, useRef, useState } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Field, Readout } from '@/components/ui/readout';
import { sendCommand } from '@/lib/api';
import { compass, doppler, mhz, num, utcTime } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { CHROME, SERIES } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { RadioMode } from '@/lib/types';
import { Waterfall } from './Waterfall';

const MODES: { mode: RadioMode; short: string }[] = [
  { mode: 'FM_VOICE', short: 'FM' },
  { mode: 'APRS_DIGI', short: 'APRS' },
  { mode: 'SSTV', short: 'SSTV' },
  { mode: 'CW_BEACON', short: 'CW' },
];

/**
 * Amateur radio payload.
 *
 * The mode buttons issue a real uplink command; the panel does not optimistically
 * switch. It shows PENDING until the backend acks and the next radio frame comes
 * back with the new mode, which is the honest representation of a command round
 * trip to a spacecraft.
 */
export function RadioPanel() {
  const radio = useMissionStore((s) => s.radio);
  const [pending, setPending] = useState<RadioMode | null>(null);
  const pendingRef = useRef<RadioMode | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // Clear the pending flag once the backend reports the new mode.
  useEffect(() => {
    if (radio && pendingRef.current && radio.mode === pendingRef.current) setPending(null);
  }, [radio]);

  const spec = radio?.spec;
  const aboveHorizon = radio ? radio.rssi !== null : false;

  const snrTone = !radio?.snr ? 'muted' : radio.snr < 8 ? 'warn' : 'nominal';

  const strip = (radio?.history ?? []).map((h) => ({
    t: h.t,
    rssi: h.rssi,
    snr: h.snr,
  }));

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Radio Payload"
        tag="COMMS"
        right={
          <span
            className={cn(
              'font-mono text-2xs uppercase tracking-[0.12em]',
              radio?.transmitting ? 'text-[var(--critical)]' : 'text-ink-muted',
            )}
          >
            {radio?.transmitting ? '◉ TX' : '○ standby'}
          </span>
        }
      />
      <PanelBody className="flex min-h-0 flex-col gap-2 overflow-y-auto scroll-thin">
        {/* mode selector — issues a mock uplink command */}
        <div>
          <div className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Payload mode · click to uplink
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MODES.map((m) => {
              const active = radio?.mode === m.mode;
              const isPending = pending === m.mode;
              return (
                <button
                  key={m.mode}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setPending(m.mode);
                    void sendCommand('SET_RADIO_MODE', { mode: m.mode }).catch(() =>
                      setPending(null),
                    );
                  }}
                  className={cn(
                    'rounded-[2px] border px-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
                    active
                      ? 'border-accent/50 bg-accent/15 text-accent'
                      : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink-dim',
                    isPending && 'animate-pulse-dot border-[var(--warn)]/50 text-[var(--warn)]',
                    pending !== null && !isPending && 'cursor-not-allowed opacity-50',
                  )}
                  title={m.mode}
                >
                  {isPending ? 'UPLINK…' : m.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* mode specification */}
        <div className="rounded-[2px] border border-line bg-surface px-2 py-1.5">
          <div className="font-mono text-[11px] text-ink">{spec?.label ?? '—'}</div>
          <div className="mt-0.5 font-mono text-[9.5px] leading-relaxed text-ink-muted">
            {spec?.description}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3">
            <Field label="Downlink" value={`${mhz(spec?.downlink)} MHz`} tone="accent" />
            <Field label="Uplink" value={`${mhz(spec?.uplink)} MHz`} />
            <Field label="TX power" value={`${num(spec?.txPower, 2)} W`} />
            <Field label="Band" value={spec?.band ?? '—'} />
            <Field
              label="Modulation"
              value={spec?.modulation ?? '—'}
              className="col-span-2"
            />
          </div>
        </div>

        {/* live link readouts */}
        <div className="grid grid-cols-3 gap-2">
          <Readout
            label="RSSI"
            value={num(radio?.rssi, 1)}
            unit="dBm"
            tone={aboveHorizon ? 'default' : 'muted'}
            hint="Received signal strength at the ground station"
          />
          <Readout
            label="SNR"
            value={num(radio?.snr, 1)}
            unit="dB"
            tone={snrTone as 'default'}
          />
          <Readout
            label="Doppler"
            value={doppler(radio?.doppler)}
            unit="kHz"
            hint="Downlink Doppler shift from relative velocity"
          />
        </div>

        <div className="grid grid-cols-2 gap-x-3">
          <Field
            label="RX freq"
            value={radio?.correctedFrequency ? `${mhz(radio.correctedFrequency)} MHz` : '—'}
            tone="accent"
          />
          <Field label="Path loss" value={radio?.pathLoss ? `${num(radio.pathLoss, 1)} dB` : '—'} />
          <Field
            label="Link margin"
            value={radio?.linkMargin !== null && radio?.linkMargin !== undefined ? `${num(radio.linkMargin, 1)} dB` : '—'}
            tone={(radio?.linkMargin ?? -1) > 3 ? 'nominal' : 'warn'}
          />
          <Field label="Range" value={`${num(radio?.range, 0)} km`} />
          <Field
            label="Elevation"
            value={`${radio && radio.elevation >= 0 ? '+' : ''}${num(radio?.elevation, 1)}°`}
            tone={aboveHorizon ? 'nominal' : 'muted'}
          />
          <Field
            label="Azimuth"
            value={`${num(radio?.azimuth, 0)}° ${radio ? compass(radio.azimuth) : ''}`}
          />
        </div>

        {!aboveHorizon && (
          <div className="rounded-[2px] border border-line bg-surface/60 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-ink-muted">
            Spacecraft below the {5}° usable horizon — no signal is present to measure, so RSSI, SNR
            and Doppler read no-data rather than a plausible number.
          </div>
        )}

        {/* signal strength strip chart — one series, no legend needed */}
        <div>
          <div className="mb-0.5 flex items-baseline justify-between">
            <span className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
              RSSI trend · dBm
            </span>
            <span className="font-mono text-[9px] text-ink-muted">
              dashed line = demod threshold
            </span>
          </div>
          <div className="h-[72px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={strip} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <XAxis dataKey="t" hide />
                <YAxis
                  domain={[-135, -95]}
                  ticks={[-130, -115, -100]}
                  width={34}
                  tick={{ fontSize: 9, fill: CHROME.muted }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  y={-121}
                  stroke={CHROME.muted}
                  strokeDasharray="3 3"
                  strokeOpacity={0.6}
                />
                <Line
                  type="monotone"
                  dataKey="rssi"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                  name="RSSI"
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
                  formatter={(v: number) => [`${Number(v).toFixed(1)} dBm`, 'RSSI']}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* waterfall */}
        <div>
          <div className="mb-0.5 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Spectrum waterfall · ±{spec ? (spec.bandwidth / 1000).toFixed(1) : '—'} kHz
          </div>
          <Waterfall spectrum={radio?.spectrum ?? []} />
        </div>

        {/* CW beacon text */}
        <div>
          <div className="mb-0.5 font-mono text-2xs uppercase tracking-[0.12em] text-ink-muted">
            Decoded housekeeping beacon
          </div>
          <div className="overflow-x-auto rounded-[2px] border border-line bg-[var(--void)] px-2 py-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--nominal)]">
            {radio?.beaconText ?? '—'}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}