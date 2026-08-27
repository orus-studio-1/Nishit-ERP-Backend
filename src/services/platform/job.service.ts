import crypto from 'crypto';
import prisma from '../../lib/prisma';

type Handler = (payload: any, job: any) => Promise<any>;
const handlers = new Map<string, Handler>();
export const registerJobHandler = (type: string, handler: Handler) => handlers.set(type, handler);
export const enqueueJob = (type: string, payload: any, options: any = {}) => prisma.backgroundJob.create({ data: { tenantId: options.tenantId, type, payload, priority: options.priority || 100, maxAttempts: options.maxAttempts || 5, runAt: options.runAt || new Date() } });

export async function workOne(workerId = crypto.randomUUID()) {
  // Claim with one atomic statement. FOR UPDATE SKIP LOCKED still guarantees
  // one worker per job, without reserving a scarce interactive transaction
  // connection on a serverless/pooler database.
  const claimed = await prisma.$queryRawUnsafe(`
    WITH next_job AS (
      SELECT id FROM "BackgroundJob"
      WHERE status IN ('PENDING', 'RETRY') AND "runAt" <= now()
      ORDER BY priority, "runAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "BackgroundJob" AS job
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = $1, attempts = job.attempts + 1
    FROM next_job
    WHERE job.id = next_job.id
    RETURNING job.*
  `, workerId) as any[];
  const job = claimed[0];
  return Promise.resolve(job).then(async (job: any) => {
    if (!job) return null;
    try {
      const handler = handlers.get(job.type);
      if (!handler) throw new Error(`No handler registered for ${job.type}`);
      const result = await handler(job.payload, job);
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', result: result ?? {}, completedAt: new Date(), lockedAt: null, lockedBy: null } });
    } catch (e: any) {
      const dead = job.attempts >= job.maxAttempts;
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: dead ? 'DEAD' : 'RETRY', lastError: e.message, runAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** job.attempts)), lockedAt: null, lockedBy: null } });
    }
    return job.id;
  });
}
