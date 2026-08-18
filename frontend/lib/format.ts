/** Formatting helpers for the numeric readouts. */

/** Fixed-decimal number, or an em dash when the channel has no valid value. */
export function num(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(dp);
}

export function signed(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`;
}

/** UTC clock, HH:MM:SS — the mission clock is always quoted in UTC. */
export function utcTime(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '--:--:--';
  return new Date(ms).toISOString().slice(11, 19);
}

export function utcDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '-------−--';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Elapsed seconds as DDd HH:MM:SS — used for uptime and mission elapsed time. */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** Compact countdown, e.g. "T-11h 24m" / "T-04:31". */
export function countdown(targetMs: number | null, nowMs: number): string {
  if (targetMs === null || !Number.isFinite(targetMs)) return '—';
  const delta = Math.max(0, targetMs - nowMs) / 1000;
  if (delta >= 3600) {
    const h = Math.floor(delta / 3600);
    const m = Math.floor((delta % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const m = Math.floor(delta / 60);
  const s = Math.floor(delta % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Latency spanning nine orders of magnitude: a direct downlink is tens of
 * milliseconds, store-and-forward is hours until the next pass.
 */
export function latency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export function percent(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(dp)}%`;
}

/** Frequency in MHz with kHz resolution. */
export function mhz(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4);
}

/** Doppler shift in kHz, signed. */
export function doppler(hz: number | null | undefined): string {
  if (hz === null || hz === undefined || !Number.isFinite(hz)) return '—';
  const k = hz / 1000;
  return `${k >= 0 ? '+' : ''}${k.toFixed(2)}`;
}

/** Compass point for an azimuth in degrees. */
export function compass(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Latitude/longitude in the usual hemisphere-suffixed form. */
export function latLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns}  ${Math.abs(lon).toFixed(3)}°${ew}`;
}