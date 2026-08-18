/**
 * REST surface.
 *
 * The dashboard gets live values over socket.io; these endpoints exist for the
 * things sockets are bad at — backfilling chart history on page load, and
 * issuing commands from anything that is not a connected socket client.
 */

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { TELEMETRY_CHANNELS, history, type TelemetryChannel } from '../db/history';
import { isDatabaseAvailable } from '../db/prisma';
import { RADIO_MODES } from '../sim/radio';
import { ANOMALY_SPECS } from '../sim/anomaly';
import { simulation } from '../sim/simulation';

export const api = Router();

const commandSchema = z.object({
  type: z.enum([
    'SET_RADIO_MODE',
    'FORCE_ROUTE_EVAL',
    'TRIGGER_ANOMALY',
    'CLEAR_ANOMALY',
    'RESET_SIM',
    'SET_SIM_SPEED',
    'SKIP_TO_AOS',
  ]),
  params: z.record(z.unknown()).optional().default({}),
});

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mission: config.mission.designator,
    simTime: simulation.clock.now(),
    speed: simulation.clock.getSpeed(),
    persistence: isDatabaseAvailable() ? 'POSTGRES' : 'MEMORY',
    uptimeSec: Math.round(process.uptime()),
  });
});

/** Everything the dashboard needs to render before the first socket frame. */
api.get('/snapshot', (_req, res) => {
  res.json(simulation.snapshot());
});

api.get('/radio/modes', (_req, res) => {
  res.json(Object.values(RADIO_MODES));
});

api.get('/anomalies/catalog', (_req, res) => {
  res.json(
    Object.entries(ANOMALY_SPECS).map(([kind, spec]) => ({
      kind,
      label: spec.label,
      severity: spec.severity,
      description: spec.description,
    })),
  );
});

/**
 * Telemetry history for one channel.
 *   GET /api/history/power?minutes=30
 *   GET /api/history/thermal?from=<ms>&to=<ms>&limit=800
 * Times are simulation-clock milliseconds.
 */
api.get('/history/:channel', async (req, res) => {
  const channel = req.params.channel as TelemetryChannel;
  if (!TELEMETRY_CHANNELS.includes(channel)) {
    return res.status(400).json({
      error: `unknown channel "${channel}"`,
      channels: TELEMETRY_CHANNELS,
    });
  }

  const now = simulation.clock.now();
  const minutes = Number(req.query.minutes);
  const to = Number(req.query.to) || now;
  const from =
    Number(req.query.from) || to - (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
  const limit = Math.min(Number(req.query.limit) || 1500, 5000);

  const rows = await history.queryTelemetry(channel, from, to, limit);
  res.json({
    channel,
    from,
    to,
    count: rows.length,
    persistence: isDatabaseAvailable() ? 'POSTGRES' : 'MEMORY',
    samples: rows,
  });
});

api.get('/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await history.queryEvents(limit));
});

api.get('/routing/decisions', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await history.queryDecisions(limit));
});

api.get('/commands', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 300);
  res.json(await history.queryCommands(limit));
});

/** Mock uplink. Responds with the PENDING record; the ack arrives over socket.io. */
api.post('/commands', (req, res) => {
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid command', issues: parsed.error.issues });
  }
  const command = simulation.submitCommand(parsed.data.type, parsed.data.params);
  res.status(202).json(command);
});