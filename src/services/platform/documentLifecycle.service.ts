import prisma from '../../lib/prisma';
import crypto from 'crypto';
import { currentTenantContext } from '../../utils/tenant';
import { allocateDocumentNo } from '../../utils/generate';

type Hook = (tx: any, lifecycle: any, input: any) => Promise<void>;
const hooks = new Map<string, { submit?: Hook; cancel?: Hook; clone?: Hook }>();
export function registerDocumentHooks(entityType: string, value: { submit?: Hook; cancel?: Hook; clone?: Hook }) { hooks.set(entityType, value); }

function trusted() {
  const context = currentTenantContext();
  if (!context?.tenantId || !context.companyId || !context.userId) throw new Error('TENANT_CONTEXT_REQUIRED');
  return context;
}

export async function createLifecycle(entityType: string, entityId: string, createdBy?: string, branchId?: string) {
  const context = trusted();
  return prisma.documentLifecycle.create({ data: { tenantId: context.tenantId!, companyId: context.companyId!, branchId: branchId || context.branchId, entityType, entityId, createdBy: createdBy || context.userId! } });
}

export async function submitLifecycle(id: string, expectedVersion: number, input: { documentType: string; prefix: string }) {
  const context = trusted();
  return prisma.$transaction(async (tx: any) => {
    const locked = await tx.$queryRawUnsafe('SELECT * FROM "DocumentLifecycle" WHERE id = $1::uuid AND "tenantId" = $2::uuid FOR UPDATE', id, context.tenantId) as any[];
    const row = locked[0];
    if (!row) throw new Error('DOCUMENT_NOT_FOUND');
    if (row.status !== 'DRAFT') throw new Error('INVALID_DOCUMENT_STATE');
    if (row.version !== expectedVersion) throw new Error('STALE_VERSION');
    const documentNo = row.documentNo || await allocateDocumentNo(input.documentType, input.prefix, 5, tx);
    await hooks.get(row.entityType)?.submit?.(tx, row, input);
    return tx.documentLifecycle.update({ where: { id }, data: { status: 'SUBMITTED', documentNo, submittedBy: context.userId, submittedAt: new Date(), version: { increment: 1 } } });
  });
}

export async function cancelLifecycle(id: string, expectedVersion: number, reason: string) {
  const context = trusted();
  if (!reason?.trim()) throw new Error('CANCEL_REASON_REQUIRED');
  return prisma.$transaction(async (tx: any) => {
    const row = await tx.documentLifecycle.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!row) throw new Error('DOCUMENT_NOT_FOUND');
    if (row.status !== 'SUBMITTED') throw new Error('INVALID_DOCUMENT_STATE');
    if (row.version !== expectedVersion) throw new Error('STALE_VERSION');
    await hooks.get(row.entityType)?.cancel?.(tx, row, { reason });
    return tx.documentLifecycle.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: context.userId, cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  });
}

export async function amendLifecycle(id: string, expectedVersion: number) {
  const context = trusted();
  return prisma.$transaction(async (tx: any) => {
    const original = await tx.documentLifecycle.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!original) throw new Error('DOCUMENT_NOT_FOUND');
    if (original.status !== 'CANCELLED') throw new Error('INVALID_DOCUMENT_STATE');
    if (original.version !== expectedVersion) throw new Error('STALE_VERSION');
    const nextEntityId = crypto.randomUUID();
    const amendment = await tx.documentLifecycle.count({ where: { tenantId: context.tenantId, amendedFromId: original.id } });
    const created = await tx.documentLifecycle.create({ data: { tenantId: context.tenantId, companyId: original.companyId, branchId: original.branchId, entityType: original.entityType, entityId: nextEntityId, documentNo: original.documentNo ? `${original.documentNo}-${amendment + 1}` : null, amendedFromId: original.id, createdBy: context.userId } });
    await hooks.get(original.entityType)?.clone?.(tx, original, { targetEntityId: nextEntityId });
    return created;
  });
}
