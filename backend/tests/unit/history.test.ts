import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryStore, TELEMETRY_CHANNELS } from '../../src/db/history';
import type { EventDto, CommandDto } from '../../src/types';

let store: HistoryStore;

const makeEvent = (n: number): EventDto => ({
  id: `evt-${n}`,
  simTime: 1000 + n,
  severity: 'INFO',
  source: 'SYSTEM',
  message: `event ${n}`,
});

const makeCommand = (n: number): CommandDto => ({
  id: `cmd-${n}`,
  type: 'SET_RADIO_MODE',
  params: { mode: 'SSTV' },
  status: 'PENDING',
  issuedAt: 1000 + n,
  simTime: 1000 + n,
  ackAt: null,
  uplinkDelay: 1500,
  result: null,
});

beforeEach(() => {
  // A fresh instance per test — never the shared `history` singleton.
  store = new HistoryStore();
});

afterEach(() => {
  store.stop();
});

describe('TELEMETRY_CHANNELS', () => {
  it('lists exactly the six documented channels', () => {
    expect(TELEMETRY_CHANNELS).toEqual(
      ['power', 'thermal', 'attitude', 'obc', 'orbit', 'radio'],
    );
  });
});

describe('telemetry ring buffer', () => {
  it('returns what was recorded, within the requested window', async () => {
    store.recordTelemetry('power', 1000, { soc: 80 });
    store.recordTelemetry('power', 2000, { soc: 79 });
    store.recordTelemetry('power', 3000, { soc: 78 });

    const rows = await store.queryTelemetry('power', 1500, 2500, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({ soc: 79 });
  });

  it('keeps channels independent', async () => {
    store.recordTelemetry('power', 1000, { soc: 80 });
    store.recordTelemetry('thermal', 1000, { obc: 21 });

    expect(await store.queryTelemetry('power', 0, 9999, 100)).toHaveLength(1);
    expect(await store.queryTelemetry('thermal', 0, 9999, 100)).toHaveLength(1);
    expect(await store.queryTelemetry('orbit', 0, 9999, 100)).toHaveLength(0);
  });

  it('honours the limit by returning the most recent rows', async () => {
    for (let i = 0; i < 50; i++) store.recordTelemetry('obc', i, { i });

    const rows = await store.queryTelemetry('obc', 0, 9999, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0].data).toEqual({ i: 40 });
    expect(rows[9].data).toEqual({ i: 49 });
  });

  it('caps the ring at 4000 rows and drops the oldest', async () => {
    for (let i = 0; i < 4500; i++) store.recordTelemetry('radio', i, { i });

    const rows = await store.queryTelemetry('radio', 0, 99_999, 99_999);
    expect(rows).toHaveLength(4000);
    expect(rows[0].data).toEqual({ i: 500 });   // 0..499 evicted
  });

  it('returns an empty array for a channel that was never written', async () => {
    expect(await store.queryTelemetry('attitude', 0, 9999, 100)).toEqual([]);
  });
});

describe('event log', () => {
  it('returns recorded events', async () => {
    store.recordEvent(makeEvent(1));
    store.recordEvent(makeEvent(2));

    const events = await store.queryEvents();
    expect(events).toHaveLength(2);
    expect(events[1].message).toBe('event 2');
  });

  it('returns the newest N when a limit is given', async () => {
    for (let i = 0; i < 20; i++) store.recordEvent(makeEvent(i));

    const events = await store.queryEvents(5);
    expect(events).toHaveLength(5);
    expect(events[0].id).toBe('evt-15');
  });
});

describe('command log', () => {
  it('records and returns a command', async () => {
    store.recordCommand(makeCommand(1));
    expect(await store.queryCommands()).toHaveLength(1);
  });

  it('updateCommand replaces the record in place rather than appending', async () => {
    const cmd = makeCommand(1);
    store.recordCommand(cmd);

    store.updateCommand({ ...cmd, status: 'ACKED', ackAt: 5000, result: 'Executed' });

    const commands = await store.queryCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].status).toBe('ACKED');
    expect(commands[0].result).toBe('Executed');
  });

  it('ignores an update for an unknown command id', async () => {
    store.recordCommand(makeCommand(1));
    store.updateCommand({ ...makeCommand(99), status: 'ACKED' });

    const commands = await store.queryCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].status).toBe('PENDING');
  });
});

describe('clear', () => {
  it('wipes every buffer', async () => {
    store.recordTelemetry('power', 1000, { soc: 80 });
    store.recordEvent(makeEvent(1));
    store.recordCommand(makeCommand(1));

    await store.clear();

    expect(await store.queryTelemetry('power', 0, 9999, 100)).toEqual([]);
    expect(await store.queryEvents()).toEqual([]);
    expect(await store.queryCommands()).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('start() is idempotent and stop() is safe to call twice', () => {
    expect(() => { store.start(); store.start(); store.stop(); store.stop(); }).not.toThrow();
  });

  it('flush() is a no-op without a database', async () => {
    store.recordEvent(makeEvent(1));
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
