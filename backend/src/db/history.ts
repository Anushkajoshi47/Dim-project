/**
 * History store.
 *
 * Writes are buffered and flushed in batches (default every 2 s) so a 1 Hz
 * telemetry loop never turns into a per-tick round trip to PostgreSQL. Reads
 * come from Postgres when it is available and from the in-memory ring buffers
 * otherwise, so the REST endpoints behave identically either way.
 */

import { config } from '../config';
import type { CommandDto, EventDto, RoutingDecisionDto } from '../types';
import { isDatabaseAvailable, markDatabaseDown, prisma } from './prisma';

export type TelemetryChannel = 'power' | 'thermal' | 'attitude' | 'obc' | 'orbit' | 'radio';

export const TELEMETRY_CHANNELS: TelemetryChannel[] = [
  'power',
  'thermal',
  'attitude',
  'obc',
  'orbit',
  'radio',
];

export interface HistoryRow {
  simTime: number;
  data: Record<string, unknown>;
}

/** Rows retained per channel when running without PostgreSQL. */
const MEMORY_LIMIT = 4000;

export class HistoryStore {
  private telemetryQueue: { channel: string; simTime: number; data: unknown }[] = [];
  private eventQueue: EventDto[] = [];
  private decisionQueue: RoutingDecisionDto[] = [];
  private commandQueue: CommandDto[] = [];
  private commandUpdates: CommandDto[] = [];

  private memTelemetry = new Map<string, HistoryRow[]>();
  private memEvents: EventDto[] = [];
  private memDecisions: RoutingDecisionDto[] = [];
  private memCommands: CommandDto[] = [];

  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, config.tick.persist);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ------------------------------------------------------------- writes */

  recordTelemetry(channel: TelemetryChannel, simTime: number, data: unknown): void {
    this.telemetryQueue.push({ channel, simTime, data });

    const ring = this.memTelemetry.get(channel) ?? [];
    ring.push({ simTime, data: data as Record<string, unknown> });
    if (ring.length > MEMORY_LIMIT) ring.splice(0, ring.length - MEMORY_LIMIT);
    this.memTelemetry.set(channel, ring);
  }

  recordEvent(event: EventDto): void {
    this.eventQueue.push(event);
    this.memEvents.push(event);
    if (this.memEvents.length > MEMORY_LIMIT) this.memEvents.shift();
  }

  recordDecision(decision: RoutingDecisionDto): void {
    this.decisionQueue.push(decision);
    this.memDecisions.push(decision);
    if (this.memDecisions.length > MEMORY_LIMIT) this.memDecisions.shift();
  }

  recordCommand(command: CommandDto): void {
    this.commandQueue.push(command);
    this.memCommands.push(command);
    if (this.memCommands.length > MEMORY_LIMIT) this.memCommands.shift();
  }

  updateCommand(command: CommandDto): void {
    this.commandUpdates.push(command);
    const idx = this.memCommands.findIndex((c) => c.id === command.id);
    if (idx >= 0) this.memCommands[idx] = command;
  }

  /* -------------------------------------------------------------- flush */

  async flush(): Promise<void> {
    if (this.flushing) return;

    const telemetry = this.telemetryQueue.splice(0);
    const events = this.eventQueue.splice(0);
    const decisions = this.decisionQueue.splice(0);
    const commands = this.commandQueue.splice(0);
    const updates = this.commandUpdates.splice(0);

    if (!isDatabaseAvailable()) return;
    if (!telemetry.length && !events.length && !decisions.length && !commands.length && !updates.length) {
      return;
    }

    this.flushing = true;
    try {
      if (telemetry.length) {
        await prisma.telemetrySample.createMany({
          data: telemetry.map((t) => ({
            channel: t.channel,
            simTime: new Date(t.simTime),
            data: t.data as never,
          })),
        });
      }

      if (events.length) {
        await prisma.eventLog.createMany({
          data: events.map((e) => ({
            eventId: e.id,
            simTime: new Date(e.simTime),
            severity: e.severity,
            source: e.source,
            message: e.message,
            data: (e.data ?? null) as never,
          })),
          skipDuplicates: true,
        });
      }

      if (decisions.length) {
        await prisma.routingDecision.createMany({
          data: decisions.map((d) => ({
            simTime: new Date(d.simTime),
            route: d.route,
            confidence: d.confidence,
            estLatencyMs: d.estLatency,
            estPacketLoss: d.estPacketLoss,
            queueDepth: d.queueDepth,
            reasoning: d.reasoning,
            candidates: d.candidates as never,
          })),
        });
      }

      if (commands.length) {
        await prisma.commandLog.createMany({
          data: commands.map((c) => ({
            commandId: c.id,
            type: c.type,
            params: c.params as never,
            status: c.status,
            issuedAt: new Date(c.issuedAt),
            simTime: new Date(c.simTime),
            ackAt: c.ackAt ? new Date(c.ackAt) : null,
            uplinkDelay: c.uplinkDelay,
            result: c.result,
          })),
          skipDuplicates: true,
        });
      }

      for (const c of updates) {
        await prisma.commandLog.updateMany({
          where: { commandId: c.id },
          data: {
            status: c.status,
            ackAt: c.ackAt ? new Date(c.ackAt) : null,
            result: c.result,
          },
        });
      }
    } catch (err) {
      markDatabaseDown(err);
    } finally {
      this.flushing = false;
    }
  }

  /* -------------------------------------------------------------- reads */

  async queryTelemetry(
    channel: TelemetryChannel,
    fromSim: number,
    toSim: number,
    limit = 1500,
  ): Promise<HistoryRow[]> {
    if (isDatabaseAvailable()) {
      try {
        const rows = await prisma.telemetrySample.findMany({
          where: { channel, simTime: { gte: new Date(fromSim), lte: new Date(toSim) } },
          orderBy: { simTime: 'desc' },
          take: limit,
        });
        return rows
          .map((r) => ({ simTime: r.simTime.getTime(), data: r.data as Record<string, unknown> }))
          .reverse();
      } catch (err) {
        markDatabaseDown(err);
      }
    }
    const ring = this.memTelemetry.get(channel) ?? [];
    return ring.filter((r) => r.simTime >= fromSim && r.simTime <= toSim).slice(-limit);
  }

  async queryEvents(limit = 200): Promise<EventDto[]> {
    if (isDatabaseAvailable()) {
      try {
        const rows = await prisma.eventLog.findMany({ orderBy: { simTime: 'desc' }, take: limit });
        return rows
          .map((r) => ({
            id: r.eventId,
            simTime: r.simTime.getTime(),
            severity: r.severity as EventDto['severity'],
            source: r.source as EventDto['source'],
            message: r.message,
            data: (r.data ?? undefined) as Record<string, unknown> | undefined,
          }))
          .reverse();
      } catch (err) {
        markDatabaseDown(err);
      }
    }
    return this.memEvents.slice(-limit);
  }

  async queryDecisions(limit = 100): Promise<RoutingDecisionDto[]> {
    if (isDatabaseAvailable()) {
      try {
        const rows = await prisma.routingDecision.findMany({
          orderBy: { simTime: 'desc' },
          take: limit,
        });
        return rows
          .map((r) => ({
            id: `db-${r.id}`,
            simTime: r.simTime.getTime(),
            route: r.route as RoutingDecisionDto['route'],
            label: r.route,
            confidence: r.confidence,
            estLatency: r.estLatencyMs,
            estPacketLoss: r.estPacketLoss,
            reasoning: r.reasoning,
            candidates: (r.candidates ?? []) as unknown as RoutingDecisionDto['candidates'],
            queueDepth: r.queueDepth,
            changed: false,
          }))
          .reverse();
      } catch (err) {
        markDatabaseDown(err);
      }
    }
    return this.memDecisions.slice(-limit);
  }

  async queryCommands(limit = 60): Promise<CommandDto[]> {
    if (isDatabaseAvailable()) {
      try {
        const rows = await prisma.commandLog.findMany({ orderBy: { issuedAt: 'desc' }, take: limit });
        return rows
          .map((r) => ({
            id: r.commandId,
            type: r.type as CommandDto['type'],
            params: r.params as Record<string, unknown>,
            status: r.status as CommandDto['status'],
            issuedAt: r.issuedAt.getTime(),
            simTime: r.simTime.getTime(),
            ackAt: r.ackAt ? r.ackAt.getTime() : null,
            uplinkDelay: r.uplinkDelay,
            result: r.result,
          }))
          .reverse();
      } catch (err) {
        markDatabaseDown(err);
      }
    }
    return this.memCommands.slice(-limit);
  }

  /** Wipes history — used by the RESET_SIM command. */
  async clear(): Promise<void> {
    this.memTelemetry.clear();
    this.memEvents = [];
    this.memDecisions = [];
    this.memCommands = [];
    this.telemetryQueue = [];
    this.eventQueue = [];
    this.decisionQueue = [];
    this.commandQueue = [];
    this.commandUpdates = [];
    if (!isDatabaseAvailable()) return;
    try {
      await prisma.$transaction([
        prisma.telemetrySample.deleteMany({}),
        prisma.routingDecision.deleteMany({}),
        prisma.eventLog.deleteMany({}),
        prisma.commandLog.deleteMany({}),
      ]);
    } catch (err) {
      markDatabaseDown(err);
    }
  }
}

export const history = new HistoryStore();