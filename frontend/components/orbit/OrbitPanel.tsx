'use client';

import dynamic from 'next/dynamic';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { latLon, num } from '@/lib/format';
import { useMissionStore } from '@/lib/store';
import { SERIES } from '@/lib/theme';

/**
 * Leaflet reads `window` during module evaluation, so the map is loaded
 * client-side only. Everything else on this panel renders normally.
 */
const GroundTrackMap = dynamic(() => import('./GroundTrackMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-muted">
      loading ground track…
    </div>
  ),
});

const SAT_COLOR = [SERIES[0], SERIES[1]];

export function OrbitPanel() {
  const orbit = useMissionStore((s) => s.orbit);

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title="Ground Track & Orbit"
        tag="FDS"
        right={
          <span className="font-mono text-2xs text-ink-muted">
            ISL {num(orbit?.interSatRange, 0)} km ·{' '}
            <span className={orbit?.interSatLos ? 'text-[var(--nominal)]' : 'text-[var(--warn)]'}>
              {orbit?.interSatLos ? 'LOS clear' : 'occulted'}
            </span>
          </span>
        }
      />

      <div className="relative min-h-0 flex-1">
        <GroundTrackMap />
      </div>

      {/* Per-spacecraft state strip under the map */}
      <div className="grid shrink-0 grid-cols-2 gap-px border-t border-line bg-line">
        {orbit?.satellites.map((sat, i) => (
          <div key={sat.id} className="bg-panel px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rotate-45"
                style={{ backgroundColor: SAT_COLOR[i] }}
              />
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ink">
                {sat.name}
              </span>
              <span className="ml-auto font-mono text-2xs uppercase text-ink-muted">
                orbit {sat.orbitNumber} · {sat.sunlit ? 'sunlit' : 'eclipse'}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-dim">
              <span className="tnum">{latLon(sat.lat, sat.lon)}</span>
              <span className="tnum">
                {sat.altitude.toFixed(0)} km · {sat.velocity.toFixed(3)} km/s
              </span>
              <span className="tnum">
                EL{' '}
                <span
                  className={
                    sat.look.elevation >= 5 ? 'text-[var(--nominal)]' : 'text-ink-muted'
                  }
                >
                  {sat.look.elevation >= 0 ? '+' : ''}
                  {sat.look.elevation.toFixed(1)}°
                </span>{' '}
                AZ {sat.look.azimuth.toFixed(0)}°
              </span>
              <span className="tnum">
                RNG {sat.look.range.toFixed(0)} km ({sat.look.rangeRate >= 0 ? '+' : ''}
                {sat.look.rangeRate.toFixed(2)} km/s)
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}