import { PrismaClient } from '@prisma/client';

/**
 * Prisma client plus a connectivity probe.
 *
 * If PostgreSQL is unreachable the simulator does NOT crash — it drops to an
 * in-memory history buffer and reports `persistence: "MEMORY"` in the snapshot
 * so the dashboard can say so plainly. That keeps a live demo possible on a
 * machine without Docker, while the documented, supported path is Postgres.
 */
export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

let available = false;

export async function connectDatabase(): Promise<boolean> {
  try {
    await prisma.$connect();
    // Confirms the migration actually ran, not just that the server answered.
    await prisma.telemetrySample.count();
    available = true;
    console.log('[db] connected to PostgreSQL — telemetry history will persist');
  } catch (err) {
    available = false;
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.warn(
      `[db] PostgreSQL unavailable (${message})\n` +
        '[db] falling back to IN-MEMORY history. Run:\n' +
        '[db]   docker compose -f backend/docker-compose.yml up -d\n' +
        '[db]   npm -w backend run prisma:migrate',
    );
  }
  return available;
}

export const isDatabaseAvailable = () => available;

/** Marks the database unavailable after a runtime failure so writes stop retrying. */
export function markDatabaseDown(err: unknown): void {
  if (!available) return;
  available = false;
  console.warn('[db] write failed, switching to in-memory history:', err instanceof Error ? err.message : err);
}