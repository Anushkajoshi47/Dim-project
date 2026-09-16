import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { api } from '../../src/routes/api';
import { simulation } from '../../src/sim/simulation';
import { history } from '../../src/db/history';
import { TELEMETRY_CHANNELS } from '../../src/db/history';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  return app;
}

const app = makeApp();

afterAll(() => {
  // The Simulation singleton owns setInterval timers; leave them running and
  // Vitest will not exit cleanly.
  simulation.stop();
  history.stop();
});

describe('GET /api/health', () => {
  it('returns 200 with the mission designator', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mission).toBe('KJS-SRS-01');
    expect(typeof res.body.simTime).toBe('number');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('reports MEMORY persistence when Postgres is not connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.persistence).toBe('MEMORY');
  });
});

describe('GET /api/snapshot', () => {
  it('returns a fully primed snapshot frame', async () => {
    const res = await request(app).get('/api/snapshot');

    expect(res.status).toBe(200);
    // The SnapshotFrame contract, per src/types.ts. Note there is no top-level
    // `clock` — the simulation clock is carried inside the orbit frame.
    for (const key of ['orbit', 'telemetry', 'radio', 'routing', 'events', 'commands', 'mission']) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it('carries the simulation clock inside the orbit frame', async () => {
    const { body } = await request(app).get('/api/snapshot');

    expect(body.orbit).toHaveProperty('clock');
    expect(typeof body.orbit.clock.simTime).toBe('number');
    expect(typeof body.orbit.clock.wallTime).toBe('number');
    expect(typeof body.orbit.clock.speed).toBe('number');
    expect(typeof body.orbit.clock.missionElapsed).toBe('number');
  });

  it('identifies the mission', async () => {
    const { body } = await request(app).get('/api/snapshot');

    expect(body.mission.designator).toBe('KJS-SRS-01');
    expect(body.mission.name).toBe('SomaiyaSat & SomaiyaPod');
    expect(body.mission.persistence).toBe('MEMORY');
    expect(typeof body.mission.epoch).toBe('number');
  });

  it('never returns an undefined engine frame (constructor primes them all)', async () => {
    const { body } = await request(app).get('/api/snapshot');
    expect(body.orbit).not.toBeNull();
    expect(body.telemetry).not.toBeNull();
    expect(body.radio).not.toBeNull();
    expect(body.routing).not.toBeNull();
  });
});

describe('GET /api/radio/modes', () => {
  it('returns all four mode specs', async () => {
    const res = await request(app).get('/api/radio/modes');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((m: any) => m.mode).sort())
      .toEqual(['APRS_DIGI', 'CW_BEACON', 'FM_VOICE', 'SSTV']);
  });
});

describe('GET /api/anomalies/catalog', () => {
  it('returns a labelled catalog entry per anomaly kind', async () => {
    const res = await request(app).get('/api/anomalies/catalog');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const entry of res.body) {
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('severity');
      expect(entry).toHaveProperty('description');
    }
  });
});

describe('GET /api/history/:channel', () => {
  it.each(TELEMETRY_CHANNELS)('accepts the "%s" channel', async (channel) => {
    const res = await request(app).get(`/api/history/${channel}`);

    expect(res.status).toBe(200);
    expect(res.body.channel).toBe(channel);
    expect(Array.isArray(res.body.samples)).toBe(true);
    expect(res.body.count).toBe(res.body.samples.length);
  });

  it('rejects an unknown channel with 400 and the valid list', async () => {
    const res = await request(app).get('/api/history/bogus');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('bogus');
    expect(res.body.channels).toEqual(TELEMETRY_CHANNELS);
  });

  it('defaults to a 30 minute window', async () => {
    const { body } = await request(app).get('/api/history/power');
    expect(body.to - body.from).toBe(30 * 60_000);
  });

  it('honours ?minutes=', async () => {
    const { body } = await request(app).get('/api/history/power?minutes=90');
    expect(body.to - body.from).toBe(90 * 60_000);
  });

  it('honours an explicit ?from=&to= range', async () => {
    const { body } = await request(app).get('/api/history/power?from=1000&to=5000');
    expect(body.from).toBe(1000);
    expect(body.to).toBe(5000);
  });

  it('falls back to 30 minutes for a non-numeric ?minutes=', async () => {
    const { body } = await request(app).get('/api/history/power?minutes=abc');
    expect(body.to - body.from).toBe(30 * 60_000);
  });
});

describe('GET list endpoints', () => {
  it.each([
    ['/api/events'],
    ['/api/routing/decisions'],
    ['/api/commands'],
  ])('%s returns an array', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/commands', () => {
  it('accepts a valid command with 202 and a PENDING record', async () => {
    const res = await request(app)
      .post('/api/commands')
      .send({ type: 'SET_RADIO_MODE', params: { mode: 'SSTV' } });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe('SET_RADIO_MODE');
    expect(res.body.status).toBe('PENDING');
    expect(res.body.ackAt).toBeNull();
    expect(res.body.uplinkDelay).toBeGreaterThanOrEqual(1000);
    expect(res.body.uplinkDelay).toBeLessThanOrEqual(3000);
  });

  it('defaults params to an empty object when omitted', async () => {
    const res = await request(app)
      .post('/api/commands')
      .send({ type: 'FORCE_ROUTE_EVAL' });

    expect(res.status).toBe(202);
    expect(res.body.params).toEqual({});
  });

  it('rejects an unknown command type with 400 and zod issues', async () => {
    const res = await request(app)
      .post('/api/commands')
      .send({ type: 'LAUNCH_MISSILES' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid command');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('rejects a body with no type at all', async () => {
    const res = await request(app).post('/api/commands').send({});
    expect(res.status).toBe(400);
  });

  it.each([
    'SET_RADIO_MODE', 'FORCE_ROUTE_EVAL', 'TRIGGER_ANOMALY',
    'CLEAR_ANOMALY', 'RESET_SIM', 'SET_SIM_SPEED', 'SKIP_TO_AOS',
  ])('accepts the documented command type %s', async (type) => {
    const res = await request(app).post('/api/commands').send({ type });
    expect(res.status).toBe(202);
  });
});
