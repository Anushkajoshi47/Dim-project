import type { CommandDto, CommandType, HistorySample, RadioModeSpec } from './types';

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Backfill a chart channel from PostgreSQL so the graphs are populated on first
 * paint and survive a page refresh.
 */
export async function fetchHistory(
  channel: 'power' | 'thermal' | 'attitude',
  minutes = 240,
): Promise<HistorySample[]> {
  const body = await get<{ samples: HistorySample[] }>(
    `/api/history/${channel}?minutes=${minutes}`,
  );
  return body.samples ?? [];
}

export function fetchRadioModes(): Promise<RadioModeSpec[]> {
  return get<RadioModeSpec[]>('/api/radio/modes');
}

export interface AnomalyCatalogEntry {
  kind: string;
  label: string;
  severity: string;
  description: string;
}

export function fetchAnomalyCatalog(): Promise<AnomalyCatalogEntry[]> {
  return get<AnomalyCatalogEntry[]>('/api/anomalies/catalog');
}

/** Mock uplink. Resolves with the PENDING record; the ack arrives over socket.io. */
export async function sendCommand(
  type: CommandType,
  params: Record<string, unknown> = {},
): Promise<CommandDto> {
  const res = await fetch(`${BACKEND_URL}/api/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params }),
  });
  if (!res.ok) throw new Error(`command rejected — HTTP ${res.status}`);
  return (await res.json()) as CommandDto;
}