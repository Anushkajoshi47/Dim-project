'use client';

import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL, fetchHistory } from '@/lib/api';
import { useMissionStore } from '@/lib/store';
import type {
  CommandDto,
  EventDto,
  OrbitFrame,
  RadioFrame,
  RoutingFrame,
  SnapshotFrame,
  TelemetryFrame,
} from '@/lib/types';

/**
 * Single socket.io connection for the whole dashboard.
 *
 * Mounted once at the root. Every panel reads from the Zustand store rather
 * than holding its own subscription, so there is exactly one connection and one
 * source of truth regardless of how many panels are on screen.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const store = useMissionStore.getState();

    // Backfill charts from PostgreSQL before the first live frame arrives.
    void Promise.all([
      fetchHistory('power'),
      fetchHistory('thermal'),
      fetchHistory('attitude'),
    ])
      .then(([power, thermal, attitude]) => {
        store.seedHistory('power', power);
        store.seedHistory('thermal', thermal);
        store.seedHistory('attitude', attitude);
      })
      .catch(() => {
        // History is a nicety; the live stream still populates the charts.
      });

    const socket: Socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 800,
    });

    socket.on('connect', () => useMissionStore.getState().setConnected(true));
    socket.on('disconnect', () => useMissionStore.getState().setConnected(false));
    socket.on('connect_error', () => useMissionStore.getState().setConnected(false));

    socket.on('snapshot', (s: SnapshotFrame) => useMissionStore.getState().applySnapshot(s));
    socket.on('orbit', (f: OrbitFrame) => useMissionStore.getState().applyOrbit(f));
    socket.on('telemetry', (f: TelemetryFrame) => useMissionStore.getState().applyTelemetry(f));
    socket.on('radio', (f: RadioFrame) => useMissionStore.getState().applyRadio(f));
    socket.on('routing', (f: RoutingFrame) => useMissionStore.getState().applyRouting(f));
    socket.on('event', (e: EventDto) => useMissionStore.getState().pushEvent(e));
    socket.on('command', (c: CommandDto) => useMissionStore.getState().upsertCommand(c));
    socket.on('command:ack', (c: CommandDto) => useMissionStore.getState().upsertCommand(c));

    // Age out finished packet animations.
    const reaper = setInterval(() => useMissionStore.getState().reapPackets(), 500);

    return () => {
      clearInterval(reaper);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return <>{children}</>;
}