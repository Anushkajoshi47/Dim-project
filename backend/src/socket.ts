import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { config } from './config';
import { simulation } from './sim/simulation';
import type { CommandType } from './types';

/**
 * socket.io wiring.
 *
 * Channels: `snapshot` (once, on connect) then `orbit` / `telemetry` / `radio` /
 * `routing` / `event` / `command` / `command:ack` as the engines tick.
 *
 * A fresh client is sent the full snapshot immediately so the dashboard renders
 * populated rather than empty-then-filling.
 */
export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
    // The dashboard is a LAN/localhost demo; websocket first, polling fallback.
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[socket] client connected ${socket.id}`);
    socket.emit('snapshot', simulation.snapshot());

    socket.on('command', (payload: { type: CommandType; params?: Record<string, unknown> }, ack?: (c: unknown) => void) => {
      try {
        const command = simulation.submitCommand(payload.type, payload.params ?? {});
        ack?.(command);
      } catch (err) {
        ack?.({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('snapshot:request', () => socket.emit('snapshot', simulation.snapshot()));

    socket.on('disconnect', (reason) => {
      console.log(`[socket] client disconnected ${socket.id} (${reason})`);
    });
  });

  simulation.attach(io);
  return io;
}