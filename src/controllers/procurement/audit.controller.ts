import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AuthRequest } from '../../middleware/auth';
import { success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

const resourceToDocument: Record<string, string> = {
  SETTINGS: 'BUYING_SETTINGS', 'PAYMENT-TERMS': 'PAYMENT_TERMS', 'SUPPLIER-ITEMS': 'SUPPLIER_ITEM', COMMUNICATIONS: 'COMMUNICATION',
  'MATERIAL-REQUESTS': 'MATERIAL_REQUEST', RFQS: 'RFQ', 'SUPPLIER-QUOTATIONS': 'SUPPLIER_QUOTATION', 'BLANKET-PURCHASE-ORDERS': 'BLANKET_PURCHASE_ORDER',
  'PURCHASE-ORDERS': 'PURCHASE_ORDER', 'GATE-ENTRIES': 'GATE_ENTRY', 'PURCHASE-RECEIPTS': 'PURCHASE_RECEIPT', 'QUALITY-INSPECTIONS': 'QUALITY_INSPECTION',
  'PURCHASE-RETURNS': 'PURCHASE_RETURN', 'LANDED-COST-VOUCHERS': 'LANDED_COST_VOUCHER', 'PURCHASE-INVOICES': 'PURCHASE_INVOICE',
  'THREE-WAY-MATCHES': 'THREE_WAY_MATCH', 'SUPPLIER-PAYMENTS': 'SUPPLIER_PAYMENT', 'VENDOR-RATINGS': 'VENDOR_RATING',
};
const documentToResource = Object.fromEntries(Object.entries(resourceToDocument).map(([resource, document]) => [document, resource]));
const companyId = (req: Request) => (req as AuthRequest).user!.companyId;

export async function getProcurementAuditTrail(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const needed = page * limit;
    const action = String(req.query.action || '').trim().toUpperCase();
    const actorId = String(req.query.userId || '').trim();
    const documentType = String(req.query.documentType || '').trim().toUpperCase();
    const entityId = String(req.query.entityId || '').trim();
    const layer = String(req.query.layer || '').trim().toUpperCase();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(`${String(req.query.to).slice(0, 10)}T23:59:59.999Z`) : undefined;
    const createdAt = from || to ? { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } : undefined;
    const businessWhere: any = {
      companyId: companyId(req), ...(action ? { action } : {}), ...(actorId ? { actorId } : {}), ...(entityId ? { entityId } : {}),
      ...(documentType ? { entityType: documentType } : {}), ...(createdAt ? { createdAt } : {}),
    };
    const requestWhere: any = {
      companyId: companyId(req), entityType: documentType ? `PROCUREMENT:${documentToResource[documentType] || documentType}` : { startsWith: 'PROCUREMENT:' },
      ...(action ? { action } : {}), ...(actorId ? { userId: actorId } : {}), ...(entityId ? { entityId } : {}), ...(createdAt ? { createdAt } : {}),
    };
    const includeBusiness = layer !== 'RECORD_CHANGE';
    const includeRequest = layer !== 'BUSINESS_EVENT';
    const [businessRows, requestRows, businessTotal, requestTotal, users] = await Promise.all([
      includeBusiness ? prisma.procurementAuditEvent.findMany({ where: businessWhere, take: needed, orderBy: { createdAt: 'desc' } }) : [],
      includeRequest ? prisma.platformAuditLog.findMany({ where: requestWhere, take: needed, orderBy: { createdAt: 'desc' } }) : [],
      includeBusiness ? prisma.procurementAuditEvent.count({ where: businessWhere }) : 0,
      includeRequest ? prisma.platformAuditLog.count({ where: requestWhere }) : 0,
      prisma.user.findMany({ where: { companyId: companyId(req) || undefined }, select: { id: true, firstName: true, lastName: true, email: true, role: true, employee: { select: { employeeId: true } } }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
    ]);
    const actors = new Map(users.map(user => [user.id, user]));
    const business = businessRows.map(row => ({ id: `business:${row.id}`, sourceId: row.id, layer: 'BUSINESS_EVENT', documentType: row.entityType, entityId: row.entityId, action: row.action, actorId: row.actorId, actor: row.actorId ? actors.get(row.actorId) || null : null, before: row.before, after: row.after, message: row.message, rfqId: row.rfqId, createdAt: row.createdAt }));
    const requests = requestRows.map(row => { const resource = row.entityType.split(':')[1] || 'PROCUREMENT'; return { id: `request:${row.id}`, sourceId: row.id, layer: 'RECORD_CHANGE', documentType: resourceToDocument[resource] || resource.replaceAll('-', '_'), entityId: row.entityId, action: row.action, actorId: row.userId, actor: row.userId ? actors.get(row.userId) || null : null, before: row.before, changes: row.diff, after: row.after, ip: row.ip, userAgent: row.userAgent, requestId: row.requestId, createdAt: row.createdAt }; });
    const combined = [...business, ...requests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = businessTotal + requestTotal;
    const items = combined.slice((page - 1) * limit, page * limit);
    const [actionFacets, documentFacets] = await Promise.all([
      prisma.procurementAuditEvent.groupBy({ by: ['action'], where: { companyId: companyId(req) }, _count: true, orderBy: { action: 'asc' } }),
      prisma.procurementAuditEvent.groupBy({ by: ['entityType'], where: { companyId: companyId(req) }, _count: true, orderBy: { entityType: 'asc' } }),
    ]);
    return success(res, { items, total, page, limit, totalPages: Math.ceil(total / limit), users, facets: { actions: actionFacets, documentTypes: documentFacets }, coverage: { businessEvents: businessTotal, recordChanges: requestTotal } });
  } catch (error) { return handlePrismaError(res, error); }
}
