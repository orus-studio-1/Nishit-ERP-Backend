import { Request } from 'express';
import { setAuditContext } from '../../middleware/platform';

export const actor = (req: Request) => (req as any).user || {};
export const companyId = (req: Request) => actor(req).companyId || undefined;

// Does not write to the database itself -- it hands business context to the mutationAudit
// middleware, which writes the single audit row for this request. `tx` is accepted only for
// call-site compatibility and is unused.
export const auditEvent = (tx: any, req: Request, data: Record<string, unknown>) => {
  // rfqId was a secondary grouping reference on the old procurement-only table; it's
  // dropped here since entityType/entityId already identify the audited record on the
  // unified PlatformAuditLog table.
  const { rfqId, ...rest } = data;
  setAuditContext(req, { companyId: companyId(req), userId: actor(req).id, ...rest });
};
