import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { error, paginated, success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateOrderNo, generateQuotationNo } from '../../utils/generate';
import { normalizeSalesItems } from './shared';
import { reserveSalesOrderStock, releaseSalesOrderReservations } from '../../services/inventory/reservation.service';
import { preserveQuotationArtifact } from '../../services/sales/quotation-artifact.service';
import { quotationDefaults } from '../../services/sales/quotation-profile.service';
import { respondPaginated } from '../../utils/pagination';
import { setAuditContext } from '../../middleware/platform';

const D = Prisma.Decimal;
const actor = (req: Request) => (req as any).user || {};
const companyId = (req: Request) => actor(req).companyId || undefined;
const tenantId = (req: Request) => actor(req).tenantId;
const code = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const addressSnapshot = (customer: any) => ({ address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId });
const json = (value: any) => value == null ? undefined : JSON.parse(JSON.stringify(value));
// Does not write to the database itself -- hands business context to the mutationAudit
// middleware, which writes the single audit row for this request.
function salesAudit(tx: any, req: Request, entityType: string, entityId: string, action: string, before?: any, after?: any, diff?: any) {
  setAuditContext(req, { tenantId: tenantId(req), companyId: companyId(req), branchId: after?.branchId || before?.branchId, entityType, entityId, action, before: json(before), after: json(after), diff: json(diff) });
}

async function creditExposure(tx: any, customerId: string, orderTotal: Prisma.Decimal.Value = 0) {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new Error('Customer not found');
  const [orders, invoices, overdue] = await Promise.all([
    tx.salesOrder.aggregate({ where: { customerId, status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'ON_HOLD'] } }, _sum: { total: true } }),
    tx.salesInvoice.aggregate({ where: { customerId, status: 'SUBMITTED', paymentStatus: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }, _sum: { outstandingAmount: true } }),
    tx.salesInvoice.count({ where: { customerId, status: 'SUBMITTED', outstandingAmount: { gt: 0 }, dueDate: { lt: new Date() } } }),
  ]);
  const openOrderExposure = new D(orders._sum.total || 0);
  const invoiceExposure = new D(invoices._sum.outstandingAmount || 0);
  const requested = new D(orderTotal || 0);
  const totalExposure = openOrderExposure.plus(invoiceExposure).plus(requested);
  const limit = new D(customer.creditLimit || 0);
  const reasons: string[] = [];
  if (customer.isOnHold) reasons.push(customer.holdReason || 'Customer is on hold');
  if (overdue > 0) reasons.push(`${overdue} overdue invoice(s)`);
  if (limit.gt(0) && totalExposure.gt(limit)) reasons.push(`Credit exposure ${totalExposure} exceeds limit ${limit}`);
  return { customerId, creditLimit: limit, creditDays: customer.paymentTerms, openOrderExposure, outstandingInvoiceExposure: invoiceExposure, requestedExposure: requested, totalExposure, overdueInvoices: overdue, blocked: reasons.length > 0, reasons };
}

export async function listEnquiries(req: Request, res: Response) {
  try {
    const search = String(req.query.search || '').trim();
    const where: any = {
      ...(companyId(req) ? { companyId: companyId(req) } : {}),
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.followUpStatus ? { followUpStatus: req.query.followUpStatus } : {}),
      ...(search ? { OR: [
        { enquiryNo: { contains: search, mode: 'insensitive' } },
        { requirements: { contains: search, mode: 'insensitive' } },
        { sourceReference: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ] } : {}),
    };
    return respondPaginated(res, prisma.salesEnquiry, req, { where, include: { customer: true, items: { include: { product: true } }, convertedQuotation: true }, orderBy: { createdAt: 'desc' } });
  } catch (e) { return handlePrismaError(res, e); }
}

export async function getEnquiry(req: Request, res: Response) {
  try {
    const row = await prisma.salesEnquiry.findUnique({ where: { id: req.params.id }, include: { customer: true, items: { include: { product: true } }, convertedQuotation: true } });
    return row ? success(res, row) : error(res, 'Sales enquiry not found', 404);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function getSalesCaseWorkspace(req: Request, res: Response) {
  try {
    const enquiry = await prisma.salesEnquiry.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: { include: { product: true } }, convertedQuotation: true },
    });
    if (!enquiry) return error(res, 'Sales enquiry not found', 404);
    if (companyId(req) && enquiry.companyId !== companyId(req)) return error(res, 'Sales enquiry not found', 404);

    const quotations: any[] = [];
    if (enquiry.convertedQuotationId) {
      let parentIds = [enquiry.convertedQuotationId];
      while (parentIds.length) {
        const rows = await prisma.quotation.findMany({
          where: { OR: [{ id: { in: parentIds } }, { supersedesId: { in: parentIds } }] },
          include: { items: { include: { product: true } }, salesOrders: true },
          orderBy: [{ revisionNo: 'asc' }, { createdAt: 'asc' }],
        });
        const unseen = rows.filter(row => !quotations.some(existing => existing.id === row.id));
        if (!unseen.length) break;
        quotations.push(...unseen);
        parentIds = unseen.map(row => row.id);
      }
    }

    const quotationIds = quotations.map(row => row.id);
    const orders = quotationIds.length ? await prisma.salesOrder.findMany({
      where: { quotationId: { in: quotationIds } },
      include: {
        items: { include: { product: { include: { stockLevels: true } }, stockReservations: true } },
        deliveryNotes: { include: { items: { include: { product: true } } }, orderBy: { date: 'asc' } },
        productionPlans: { include: { items: true } }, invoices: true,
      },
      orderBy: { createdAt: 'asc' },
    }) : [];

    const entityIds = [enquiry.id, ...quotationIds, ...orders.map(row => row.id), ...orders.flatMap(row => row.deliveryNotes.map(note => note.id)), ...orders.flatMap(row => row.productionPlans.map(plan => plan.id)), ...orders.flatMap(row => row.invoices.map(invoice => invoice.id))];
    const communications = await prisma.salesCommunication.findMany({
      where: { entityId: { in: entityIds }, ...(companyId(req) ? { companyId: companyId(req) } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    entityIds.push(...communications.map(row => row.id));
    const supplyRequests = orders.length ? await prisma.materialRequest.findMany({ where: { sourceDocumentType: 'SALES_ORDER', sourceDocumentId: { in: orders.map(row => row.id) } }, include: { items: { include: { product: true } }, purchaseOrders: true }, orderBy: { createdAt: 'desc' } }) : [];
    entityIds.push(...supplyRequests.map(row => row.id), ...supplyRequests.flatMap(row => row.purchaseOrders.map(po => po.id)));
    const auditHistory = await prisma.platformAuditLog.findMany({ where: { entityId: { in: entityIds } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const productIds = [...new Set([...enquiry.items.map(item => item.productId), ...orders.flatMap(order => order.items.map(item => item.productId))])];
    const levels = productIds.length ? await prisma.stockLevel.groupBy({
      by: ['productId'], where: { productId: { in: productIds } }, _sum: { quantity: true, reservedQty: true },
    }) : [];
    const availability = new Map(levels.map(level => [level.productId, Math.max(0, Number(level._sum.quantity || 0) - Number(level._sum.reservedQty || 0))]));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const lineChanges = quotations.map((quotation, index) => {
      const previous = index ? quotations[index - 1] : null;
      const oldLines = new Map((previous?.items || []).map((item: any) => [item.productId, item]));
      return { quotationId: quotation.id, revisionNo: quotation.revisionNo, changes: quotation.items.flatMap((item: any) => {
        const old: any = oldLines.get(item.productId);
        if (!old) return previous ? [{ productId: item.productId, product: item.product?.name, kind: 'ADDED', after: item }] : [];
        const fields = ['quantity', 'unitPrice', 'discount', 'taxRate'].filter(field => Number(old[field]) !== Number(item[field]));
        if (String(old.requestedDeliveryDate || '').slice(0, 10) !== String(item.requestedDeliveryDate || '').slice(0, 10)) fields.push('requestedDeliveryDate');
        if (String(old.committedDeliveryDate || '').slice(0, 10) !== String(item.committedDeliveryDate || '').slice(0, 10)) fields.push('committedDeliveryDate');
        return fields.length ? [{ productId: item.productId, product: item.product?.name, kind: 'CHANGED', fields, before: old, after: item }] : [];
      }).concat(previous ? previous.items.filter((old: any) => !quotation.items.some((item: any) => item.productId === old.productId)).map((old: any) => ({ productId: old.productId, product: old.product?.name, kind: 'REMOVED', before: old })) : []) };
    });
    const alerts = orders.flatMap(order => order.items.flatMap(item => {
      const promised = item.committedDeliveryDate || order.deliveryDate || enquiry.items.find(line => line.productId === item.productId)?.targetDate || enquiry.targetDate;
      const openQty = Math.max(0, Number(item.quantity) - Number(item.deliveredQty) - Number(item.shortClosedQty));
      const available = availability.get(item.productId) || 0;
      if (!promised || openQty <= 0) return [];
      const daysRemaining = Math.ceil((new Date(promised).getTime() - today.getTime()) / 86400000);
      if (available >= openQty && daysRemaining > 3) return [];
      return [{ id: `${order.id}:${item.id}`, orderId: order.id, orderNo: order.orderNo, salesOrderItemId: item.id, productId: item.productId, product: item.product.name, promisedDate: promised, daysRemaining, openQty, availableQty: available, shortageQty: Math.max(0, openQty - available), severity: daysRemaining < 0 ? 'OVERDUE' : daysRemaining <= 1 ? 'CRITICAL' : daysRemaining <= 3 ? 'HIGH' : 'MEDIUM', action: available < openQty ? (item.supplyMode === 'MAKE_TO_ORDER' ? 'PLAN_PRODUCTION' : 'CREATE_MATERIAL_REQUEST') : 'CREATE_DISPATCH' }];
    }));
    const allCommitmentAlerts = orders.length ? await syncCommitmentAlerts(req) : [];
    const orderIds = new Set(orders.map(order => order.id));
    const commitmentAlerts = allCommitmentAlerts.filter(alert => orderIds.has(alert.salesOrderId));
    return success(res, { enquiry, quotations, orders, communications, lineChanges, alerts, commitmentAlerts, auditHistory, supplyRequests, summary: { revisionCount: quotations.length, orderCount: orders.length, dispatchCount: orders.reduce((sum, order) => sum + order.deliveryNotes.length, 0), alertCount: commitmentAlerts.length } });
  } catch (e) { return handlePrismaError(res, e); }
}

export async function createEnquiry(req: Request, res: Response) {
  try {
    const { customerId, items = [] } = req.body;
    if (!customerId || !items.length) return error(res, 'Customer and at least one item are required', 400);
    if (items.some((item: any) => !item.productId || !Number.isFinite(Number(item.targetQty || item.quantity)) || Number(item.targetQty || item.quantity) <= 0)) return error(res, 'Every item requires a product and target quantity greater than zero', 400);
    const source = String(req.body.source || 'MANUAL').toUpperCase();
    if (!['MANUAL', 'EMAIL', 'WHATSAPP', 'PHONE', 'WEB', 'REFERRAL'].includes(source)) return error(res, 'Invalid enquiry source', 400);
    const row = await prisma.$transaction(async tx => { const created = await tx.salesEnquiry.create({ data: { enquiryNo: code('SC'), companyId: companyId(req), customerId, opportunityId: req.body.opportunityId, source, sourceReference: req.body.sourceReference, originalMessage: req.body.originalMessage, priority: req.body.priority || 'MEDIUM', assignedToId: req.body.assignedToId || actor(req).id, attachments: req.body.attachments || [], receivedAt: req.body.receivedAt ? new Date(req.body.receivedAt) : new Date(), followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : undefined, followUpStatus: req.body.followUpStatus || 'PENDING', requirements: req.body.requirements, targetDate: req.body.targetDate ? new Date(req.body.targetDate) : undefined, currency: req.body.currency || 'INR', territory: req.body.territory, salesChannel: req.body.salesChannel, branchId: req.body.branchId, createdById: actor(req).id, items: { create: items.map((i: any) => ({ productId: i.productId, description: i.description, targetQty: new D(i.targetQty || i.quantity || 0), targetDate: i.targetDate ? new Date(i.targetDate) : undefined, targetPrice: i.targetPrice == null ? undefined : new D(i.targetPrice), uomId: i.uomId })) } }, include: { customer: true, items: true } }); await salesAudit(tx, req, 'SALES_CASE', created.id, 'CREATE', undefined, created); return created; });
    return success(res, row, 'Sales enquiry created', 201);
  } catch (e: any) { return e.message ? error(res, e.message, 400) : handlePrismaError(res, e); }
}

export async function followUpEnquiry(req: Request, res: Response) {
  try {
    const status = String(req.body.status || 'COMPLETED').toUpperCase();
    if (!['PENDING', 'COMPLETED', 'NO_RESPONSE', 'RESCHEDULED'].includes(status)) return error(res, 'Invalid follow-up status', 400);
    const row = await prisma.$transaction(async tx => {
      const enquiry = await tx.salesEnquiry.findUnique({ where: { id: req.params.id } });
      if (!enquiry) throw new Error('Sales enquiry not found');
      if (['LOST', 'CANCELLED', 'QUOTED'].includes(enquiry.status)) throw new Error(`Follow-up cannot be recorded for a ${enquiry.status.toLowerCase()} enquiry`);
      if (!String(req.body.notes || '').trim()) throw new Error('Follow-up notes are required');
      await tx.salesCommunication.create({ data: { companyId: enquiry.companyId, entityType: 'ENQUIRY', entityId: enquiry.id, channel: String(req.body.channel || 'PHONE').toUpperCase(), direction: 'OUTBOUND', kind: 'FOLLOW_UP', recipient: req.body.recipient, subject: req.body.subject, message: req.body.notes || `Follow-up marked ${status}`, status: 'LOGGED', sentAt: status === 'COMPLETED' ? new Date() : undefined, createdById: actor(req).id } });
      const updated = await tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { followUpStatus: status, followUpAt: req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : status === 'COMPLETED' ? null : enquiry.followUpAt } });
      await salesAudit(tx, req, 'SALES_CASE', enquiry.id, 'FOLLOW_UP', enquiry, updated, { status, notes: req.body.notes }); return updated;
    });
    return success(res, row, 'Enquiry follow-up recorded');
  } catch (e: any) { return error(res, e.message || 'Could not record follow-up', e.message?.includes('not found') ? 404 : 400); }
}

export async function loseEnquiry(req: Request, res: Response) {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return error(res, 'Loss reason is required', 400);
    const row = await prisma.$transaction(async tx => { const existing = await tx.salesEnquiry.findUnique({ where: { id: req.params.id } }); if (!existing) throw new Error('Sales case not found'); const updated = await tx.salesEnquiry.update({ where: { id: existing.id }, data: { status: 'LOST', lossReason: reason, lostAt: new Date(), followUpStatus: 'COMPLETED' } }); await salesAudit(tx, req, 'SALES_CASE', existing.id, 'MARK_LOST', existing, updated, { reason }); return updated; });
    return success(res, row, 'Enquiry marked as lost');
  } catch (e) { return handlePrismaError(res, e); }
}

export async function listSalesCommunications(req: Request, res: Response) {
  try {
    const where: any = { entityType: String(req.params.entityType).toUpperCase(), entityId: req.params.entityId, ...(companyId(req) ? { companyId: companyId(req) } : {}) };
    return success(res, await prisma.salesCommunication.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (e) { return handlePrismaError(res, e); }
}

export async function createSalesCommunication(req: Request, res: Response) {
  try {
    const channel = String(req.body.channel || 'EMAIL').toUpperCase();
    if (!['EMAIL', 'WHATSAPP', 'PHONE', 'MEETING', 'OTHER'].includes(channel)) return error(res, 'Invalid communication channel', 400);
    if (!String(req.body.message || '').trim()) return error(res, 'Message is required', 400);
    const send = Boolean(req.body.send) && ['EMAIL', 'WHATSAPP'].includes(channel);
    const row = await prisma.$transaction(async tx => {
      const communication = await tx.salesCommunication.create({ data: { companyId: companyId(req), entityType: String(req.params.entityType).toUpperCase(), entityId: req.params.entityId, channel, direction: String(req.body.direction || 'OUTBOUND').toUpperCase(), kind: String(req.body.kind || 'GENERAL').toUpperCase(), recipient: req.body.recipient, subject: req.body.subject, message: req.body.message, status: send ? 'QUEUED' : 'LOGGED', sentAt: send ? undefined : req.body.sentAt ? new Date(req.body.sentAt) : undefined, createdById: actor(req).id } });
      if (send) await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } });
      await salesAudit(tx, req, 'SALES_COMMUNICATION', communication.id, send ? 'QUEUE_SEND' : 'LOG', undefined, communication, { parentEntityType: communication.entityType, parentEntityId: communication.entityId });
      return communication;
    });
    return success(res, row, send ? 'Communication queued' : 'Communication logged', 201);
  } catch (e: any) { return error(res, e.message || 'Could not save communication', 400); }
}

export async function sendShippingNotification(req: Request, res: Response) {
  try {
    const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!order) return error(res, 'Sales order not found', 404);
    const channel = String(req.body.channel || 'EMAIL').toUpperCase();
    const recipient = req.body.recipient || (channel === 'EMAIL' ? order.customer.email : order.customer.phone);
    if (!recipient) return error(res, `${channel} recipient is required`, 400);
    req.params.entityType = 'ORDER'; req.params.entityId = order.id;
    req.body = { ...req.body, channel, recipient, kind: 'SHIPPING', send: true, subject: req.body.subject || `Shipping update for ${order.orderNo}`, message: req.body.message || `Your order ${order.orderNo} has been shipped.${req.body.trackingNo ? ` Tracking: ${req.body.trackingNo}` : ''}` };
    return createSalesCommunication(req, res);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function retrySalesCommunication(req: Request, res: Response) {
  try {
    const row = await prisma.$transaction(async tx => {
      const communication = await tx.salesCommunication.findUnique({ where: { id: req.params.id } });
      if (!communication) throw new Error('Communication not found');
      if (!['EMAIL', 'WHATSAPP'].includes(communication.channel)) throw new Error('Only email or WhatsApp communication can be retried');
      if (!communication.recipient) throw new Error('Communication recipient is missing');
      const updated = await tx.salesCommunication.update({ where: { id: communication.id }, data: { status: 'QUEUED', sentAt: null } });
      if (communication.kind === 'RATE_QUOTE' && communication.entityType === 'QUOTATION') {
        const quotation = await tx.quotation.findUnique({ where: { id: communication.entityId } });
        if (!quotation) throw new Error('Quotation not found for this communication');
        await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_QUOTATION_EMAIL', payload: { quotationId: quotation.id, to: communication.recipient, token: quotation.publicToken, communicationId: communication.id, channel: communication.channel } } });
      } else await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } });
      await salesAudit(tx, req, 'SALES_COMMUNICATION', communication.id, 'RETRY', communication, updated);
      return updated;
    });
    return success(res, row, 'Communication queued for retry');
  } catch (e: any) { return error(res, e.message || 'Could not retry communication', e.message?.includes('not found') ? 404 : 400); }
}

export async function updateEnquiry(req: Request, res: Response) {
  try {
    const existing = await prisma.salesEnquiry.findUnique({ where: { id: req.params.id } });
    if (!existing) return error(res, 'Sales enquiry not found', 404);
    if (!['DRAFT', 'NEW'].includes(existing.status)) return error(res, 'Only new sales cases can be edited', 400);
    const { items, targetDate, ...values } = req.body;
    const row = await prisma.$transaction(async tx => {
      if (items) await tx.salesEnquiryItem.deleteMany({ where: { enquiryId: existing.id } });
      const updated = await tx.salesEnquiry.update({ where: { id: existing.id }, data: { ...values, ...(targetDate ? { targetDate: new Date(targetDate) } : {}), ...(items ? { items: { create: items.map((i: any) => ({ productId: i.productId, description: i.description, targetQty: new D(i.targetQty || i.quantity || 0), targetDate: i.targetDate ? new Date(i.targetDate) : undefined, targetPrice: i.targetPrice == null ? undefined : new D(i.targetPrice), uomId: i.uomId })) } } : {}) }, include: { customer: true, items: true } });
      await salesAudit(tx, req, 'SALES_CASE', existing.id, 'UPDATE_ENQUIRY', existing, updated);
      return updated;
    });
    return success(res, row, 'Sales enquiry updated');
  } catch (e: any) { return e.message ? error(res, e.message, 400) : handlePrismaError(res, e); }
}

export async function submitEnquiry(req: Request, res: Response) {
  try {
    const row = await prisma.$transaction(async tx => { const before = await tx.salesEnquiry.findUnique({ where: { id: req.params.id } }); if (!before || !['DRAFT', 'NEW'].includes(before.status)) throw new Error('Only a new sales case can be qualified'); const after = await tx.salesEnquiry.update({ where: { id: before.id }, data: { status: 'QUALIFIED', submittedAt: new Date() }, include: { items: true } }); await salesAudit(tx, req, 'SALES_CASE', before.id, 'QUALIFY', before, after); return after; });
    return success(res, row, 'Sales enquiry submitted');
  } catch (e) { return handlePrismaError(res, e); }
}

export async function convertEnquiry(req: Request, res: Response) {
  try {
    const quotation = await prisma.$transaction(async tx => {
      const enquiry = await tx.salesEnquiry.findUnique({ where: { id: req.params.id }, include: { customer: true, items: { include: { product: true } } } });
      if (!enquiry) throw new Error('Sales enquiry not found');
      if (!['SUBMITTED', 'QUALIFIED'].includes(enquiry.status)) throw new Error('Only qualified sales cases can create a quotation');
      const calculated = await normalizeSalesItems(tx, enquiry.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.targetQty, unitPrice: i.targetPrice })), { customerId: enquiry.customerId, currency: 'INR' });
      const company = enquiry.companyId ? await tx.company.findUnique({ where: { id: enquiry.companyId } }) : null;
      const defaults = quotationDefaults(company);
      const dates = new Map(enquiry.items.map(item => [item.productId, item.targetDate || enquiry.targetDate]));
      const q = await tx.quotation.create({ data: { quotationNo: `DRAFT-QTN-${Date.now()}-${Math.floor(Math.random() * 1000)}`, companyId: enquiry.companyId, customerId: enquiry.customerId, customerNameSnapshot: enquiry.customer.name, currency: 'INR', subtotal: calculated.subtotal, taxAmount: calculated.taxAmount, total: calculated.subtotal.plus(calculated.taxAmount), terms: defaults.terms, deliveryTerms: defaults.deliveryTerms, deliveryChargesNote: defaults.deliveryChargesNote, companySnapshot: defaults.companySnapshot, billingAddressSnapshot: addressSnapshot(enquiry.customer), shippingAddressSnapshot: addressSnapshot(enquiry.customer), branchId: enquiry.branchId, createdById: actor(req).id, items: { create: calculated.items.map((item: any) => ({ ...item, requestedDeliveryDate: dates.get(item.productId), committedDeliveryDate: dates.get(item.productId) })) } }, include: { items: true, customer: true } });
      await tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { status: 'QUOTING', convertedQuotationId: q.id } });
      await salesAudit(tx, req, 'QUOTATION', q.id, 'CREATE_FROM_ENQUIRY', undefined, q, { salesCaseId: enquiry.id });
      return q;
    });
    return success(res, quotation, 'Enquiry converted to quotation', 201);
  } catch (e: any) { return error(res, e.message || 'Conversion failed', 400); }
}

export async function closeSalesCase(req: Request, res: Response) {
  try {
    const closed = await prisma.$transaction(async tx => {
      const enquiry = await tx.salesEnquiry.findUnique({ where: { id: req.params.id } });
      if (!enquiry) throw new Error('Sales case not found');
      if (enquiry.status !== 'WON') throw new Error('Only a won sales case can be closed');
      const quotationIds: string[] = [];
      if (enquiry.convertedQuotationId) { let ids = [enquiry.convertedQuotationId]; while (ids.length) { const rows = await tx.quotation.findMany({ where: { OR: [{ id: { in: ids } }, { supersedesId: { in: ids } }] }, select: { id: true } }); const unseen = rows.map(row => row.id).filter(id => !quotationIds.includes(id)); quotationIds.push(...unseen); ids = unseen; } }
      const orders = await tx.salesOrder.findMany({ where: { quotationId: { in: quotationIds }, status: { not: 'CANCELLED' } }, include: { items: true, invoices: true } });
      if (!orders.length) throw new Error('The accepted sales order is missing');
      if (orders.some(order => !['DELIVERED', 'CLOSED'].includes(order.status) || order.items.some(item => item.deliveredQty.plus(item.shortClosedQty).lt(item.quantity)))) throw new Error('All quantities must be delivered or formally short-closed');
      if (orders.some(order => Number(order.billedPercent) < 100 || order.invoices.some(invoice => Number(invoice.outstandingAmount) > 0))) throw new Error('All required invoices must be raised and fully paid');
      const openAlerts = await tx.salesCommitmentAlert.count({ where: { salesOrderId: { in: orders.map(order => order.id) }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
      if (openAlerts) throw new Error('Resolve all fulfilment alerts before closing the sales case');
      const updated = await tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { status: 'CLOSED', followUpStatus: 'COMPLETED' } });
      await salesAudit(tx, req, 'SALES_CASE', enquiry.id, 'CLOSE', enquiry, updated, { reason: req.body.reason || 'Commercial and fulfilment obligations completed' });
      return updated;
    });
    return success(res, closed, 'Sales case closed');
  } catch (e: any) { return error(res, e.message || 'Could not close sales case', e.message?.includes('not found') ? 404 : 400); }
}

export async function quotationOperation(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    const result = await prisma.$transaction(async tx => {
      const q = await tx.quotation.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } }, customer: true } });
      if (!q) throw new Error('Quotation not found');
      if (operation === 'submit') {
        if (q.status !== 'DRAFT') throw new Error('Only draft quotations can be submitted');
        if (q.validUntil && q.validUntil < new Date()) throw new Error('Quotation validity has already expired');
        let approvalInstanceId: string | undefined;
        if (tenantId(req)) {
          const rules = await tx.approvalRule.findMany({ where: { tenantId: tenantId(req), documentType: 'SALES_QUOTATION', isActive: true }, orderBy: { priority: 'asc' } });
          const maxDiscount = Math.max(0, ...q.items.map(i => Number(i.discount)));
          const minMargin = Math.min(...q.items.map(i => Number(i.marginPercent)));
          const rule = rules.find((row: any) => { const c = row.conditions as any || {}; return (c.discountPercentAbove != null && maxDiscount > Number(c.discountPercentAbove)) || (c.marginPercentBelow != null && minMargin < Number(c.marginPercentBelow)); });
          if (rule) {
            const steps = Array.isArray(rule.steps) ? rule.steps as any[] : [];
            const instance = await tx.approvalInstance.create({ data: { tenantId: tenantId(req), companyId: companyId(req), documentType: 'SALES_QUOTATION', documentId: q.id, requestedBy: actor(req).id, ruleId: rule.id, actions: { create: steps.map((step, index) => ({ tenantId: tenantId(req), sequence: step.sequence || index + 1, approverType: step.approverType || 'USER', approverId: step.approverId, dueAt: step.dueHours ? new Date(Date.now() + step.dueHours * 3600000) : undefined })) } } });
            approvalInstanceId = instance.id;
          }
        }
        const updated = await tx.quotation.update({ where: { id: q.id }, data: { quotationNo: q.quotationNo.startsWith('DRAFT-') ? await generateQuotationNo() : q.quotationNo, submittedAt: new Date(), approvalInstanceId, status: approvalInstanceId ? 'PENDING_APPROVAL' : 'APPROVED', ...(!approvalInstanceId ? { approvedAt: new Date(), approvedById: actor(req).id } : {}) } });
        await salesAudit(tx, req, 'QUOTATION', q.id, 'SUBMIT', q, updated); return updated;
      }
      if (operation === 'revise') {
        if (!q.submittedAt) throw new Error('Submit the quotation before creating a revision');
        if (!['SENT', 'VIEWED', 'UNDER_NEGOTIATION'].includes(q.status)) throw new Error('Only a customer-facing quotation can enter negotiation revision');
        if (await tx.quotation.count({ where: { supersedesId: q.id } })) throw new Error('A newer revision already exists');
        const revisionReason = String(req.body.revisionReason || '').trim();
        if (!revisionReason) throw new Error('Revision reason is required');
        const baseNo = q.quotationNo.replace(/-R\d+$/, '');
        const revised = await tx.quotation.create({ data: { quotationNo: `${baseNo}-R${q.revisionNo + 1}`, companyId: q.companyId, customerId: q.customerId, customerNameSnapshot: q.customerNameSnapshot, companySnapshot: q.companySnapshot as any, date: new Date(), validUntil: req.body.validUntil ? new Date(req.body.validUntil) : q.validUntil, status: 'DRAFT', subtotal: q.subtotal, taxAmount: q.taxAmount, discount: q.discount, deliveryCharges: q.deliveryCharges, deliveryChargesNote: q.deliveryChargesNote, total: q.total, currency: 'INR', notes: q.notes, terms: q.terms, revisionNo: q.revisionNo + 1, supersedesId: q.id, revisionReason, negotiationNote: req.body.negotiationNote, internalNotes: q.internalNotes, customerNotes: q.customerNotes, createdById: actor(req).id, commercialConditions: q.commercialConditions as any, billingAddressSnapshot: q.billingAddressSnapshot as any, shippingAddressSnapshot: q.shippingAddressSnapshot as any, branchId: q.branchId, placeOfSupply: q.placeOfSupply, taxMode: q.taxMode, deliveryTerms: q.deliveryTerms, transporterInfo: q.transporterInfo as any, items: { create: q.items.map(i => ({ productId: i.productId, description: i.description, hsnCode: i.hsnCode, brand: i.brand, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, discount: i.discount, total: i.total, uomId: i.uomId, costRate: i.costRate, marginPercent: i.marginPercent, priceSource: i.priceSource, requestedDeliveryDate: i.requestedDeliveryDate, committedDeliveryDate: i.committedDeliveryDate })) } } });
        await tx.quotation.update({ where: { id: q.id }, data: { status: 'SUPERSEDED' } });
        await salesAudit(tx, req, 'QUOTATION', revised.id, 'CREATE_REVISION', q, revised, { revisionReason, negotiationNote: req.body.negotiationNote }); return revised;
      }
      if (operation === 'send') {
        if (!q.submittedAt) throw new Error('Submit the quotation before sending');
        if (q.approvalInstanceId) {
          const approval = await tx.approvalInstance.findUnique({ where: { id: q.approvalInstanceId } });
          if (approval?.status !== 'APPROVED') throw new Error('Quotation approval is pending');
        }
        if (await tx.quotation.count({ where: { supersedesId: q.id } })) throw new Error('Only the latest quotation revision can be sent');
        if (!['APPROVED', 'PENDING_APPROVAL'].includes(q.status)) throw new Error('Only an approved quotation can be sent');
        const channel = String(req.body.channel || 'EMAIL').toUpperCase();
        if (!['EMAIL', 'WHATSAPP'].includes(channel)) throw new Error('Quotation channel must be EMAIL or WHATSAPP');
        const recipient = req.body.recipient || req.body.email || (channel === 'EMAIL' ? q.customer.email : q.customer.phone);
        if (!recipient) throw new Error(`Customer ${channel === 'EMAIL' ? 'email' : 'phone'} is missing`);
        const token = q.publicToken || randomBytes(24).toString('hex');
        await preserveQuotationArtifact(q.id, tx);
        const communication = await tx.salesCommunication.create({ data: { companyId: q.companyId, entityType: 'QUOTATION', entityId: q.id, channel, kind: 'RATE_QUOTE', recipient, subject: `Quotation ${q.quotationNo}`, message: req.body.message || 'Quotation and rates sent to customer', status: 'QUEUED', createdById: actor(req).id } });
        await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_QUOTATION_EMAIL', payload: { quotationId: q.id, to: recipient, token, communicationId: communication.id, channel }, status: 'PENDING' } });
        const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'SENT', sentAt: new Date(), publicToken: token, sentPdfUrl: req.body.sentPdfUrl } });
        await salesAudit(tx, req, 'QUOTATION', q.id, 'SEND', q, updated, { channel, recipient }); return updated;
      }
      if (operation === 'accept') {
        if (!['SENT', 'VIEWED', 'UNDER_NEGOTIATION'].includes(q.status)) throw new Error('Only a customer-facing quotation can be accepted');
        if (await tx.quotation.count({ where: { supersedesId: q.id } })) throw new Error('Only the latest quotation revision can be accepted');
        const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), customerPoNo: req.body.customerPoNo, acceptanceAttachmentUrl: req.body.acceptanceAttachmentUrl } });
        let rootId = q.id, parentId = q.supersedesId;
        while (parentId) { const parent = await tx.quotation.findUnique({ where: { id: parentId }, select: { id: true, supersedesId: true } }); if (!parent) break; rootId = parent.id; parentId = parent.supersedesId; }
        const enquiry = await tx.salesEnquiry.findFirst({ where: { convertedQuotationId: rootId }, include: { items: true } });
        const enquiryDates = new Map((enquiry?.items || []).map(item => [item.productId, item.targetDate || enquiry?.targetDate]));
        const committedDates = q.items.map(item => item.committedDeliveryDate || item.requestedDeliveryDate || enquiryDates.get(item.productId)).filter(Boolean) as Date[];
        const completionDate = committedDates.length ? new Date(Math.max(...committedDates.map(date => date.getTime()))) : enquiry?.targetDate;
        let order = await tx.salesOrder.findFirst({ where: { quotationId: q.id, status: { not: 'CANCELLED' } }, include: { items: true } });
        if (!order) {
          order = await tx.salesOrder.create({ data: { orderNo: `DRAFT-SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`, companyId: q.companyId, customerId: q.customerId, quotationId: q.id, customerPoNo: req.body.customerPoNo, deliveryDate: completionDate, completionDate, subtotal: q.subtotal, taxAmount: q.taxAmount, discount: q.discount, total: q.total, currency: q.currency, notes: q.notes, terms: q.terms, branchId: q.branchId, billingAddressSnapshot: q.billingAddressSnapshot as any, shippingAddressSnapshot: q.shippingAddressSnapshot as any, placeOfSupply: q.placeOfSupply, taxMode: q.taxMode, deliveryTerms: q.deliveryTerms, transporterInfo: q.transporterInfo as any, items: { create: q.items.map(item => ({ productId: item.productId, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, taxRate: item.taxRate, discount: item.discount, total: item.total, uomId: item.uomId, requestedDeliveryDate: item.requestedDeliveryDate || enquiryDates.get(item.productId), committedDeliveryDate: item.committedDeliveryDate || item.requestedDeliveryDate || enquiryDates.get(item.productId), supplyMode: item.product.supplyPolicy === 'MANUFACTURE' ? 'MAKE_TO_ORDER' : 'MAKE_TO_STOCK' })) } }, include: { items: true } });
          await salesAudit(tx, req, 'SALES_ORDER', order.id, 'AUTO_CREATE_FROM_ACCEPTANCE', undefined, order, { quotationId: q.id, revisionNo: q.revisionNo });
        }
        if (enquiry) await tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { status: 'WON' } });
        if (q.customer.email) {
          const communication = await tx.salesCommunication.create({ data: { companyId: q.companyId, entityType: 'QUOTATION', entityId: q.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'QUOTATION_ACCEPTED', recipient: q.customer.email, subject: `Quotation accepted – ${q.quotationNo}`, message: `Thank you for accepting quotation ${q.quotationNo}, revision ${q.revisionNo}. Your order ${order.orderNo} has been created. We will keep you informed as each part of the order is dispatched.`, status: 'QUEUED', createdById: actor(req).id } });
          await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_QUOTATION_EMAIL', payload: { quotationId: q.id, to: q.customer.email, token: q.publicToken, communicationId: communication.id, channel: 'EMAIL' } } });
        }
        await salesAudit(tx, req, 'QUOTATION', q.id, 'ACCEPT', q, updated, { confirmation: req.body.confirmation || 'Recorded by user', salesOrderId: order.id }); return updated;
      }
      if (operation === 'negotiate') { if (!['SENT', 'VIEWED'].includes(q.status)) throw new Error('Only a sent or viewed quotation can enter negotiation'); const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'UNDER_NEGOTIATION', negotiationNote: req.body.negotiationNote || q.negotiationNote } }); let rootId = q.id, parentId = q.supersedesId; while (parentId) { const parent = await tx.quotation.findUnique({ where: { id: parentId }, select: { id: true, supersedesId: true } }); if (!parent) break; rootId = parent.id; parentId = parent.supersedesId; } await tx.salesEnquiry.updateMany({ where: { convertedQuotationId: rootId }, data: { status: 'NEGOTIATION' } }); await salesAudit(tx, req, 'QUOTATION', q.id, 'NEGOTIATION', q, updated, { note: req.body.negotiationNote }); return updated; }
      if (operation === 'approve') {
        if (q.status !== 'PENDING_APPROVAL' || !q.approvalInstanceId) throw new Error('Quotation is not pending approval');
        const approval = await tx.approvalInstance.findUnique({ where: { id: q.approvalInstanceId } });
        if (approval?.status !== 'APPROVED') throw new Error('Platform approval is still pending');
        const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor(req).id } });
        await salesAudit(tx, req, 'QUOTATION', q.id, 'APPROVE', q, updated); return updated;
      }
      if (operation === 'reject') {
        if (!req.body.reason) throw new Error('Rejection reason is required');
        const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: req.body.reason } });
        let rootId = q.id, parentId = q.supersedesId; while (parentId) { const parent = await tx.quotation.findUnique({ where: { id: parentId }, select: { id: true, supersedesId: true } }); if (!parent) break; rootId = parent.id; parentId = parent.supersedesId; } await tx.salesEnquiry.updateMany({ where: { convertedQuotationId: rootId }, data: { status: 'LOST', lossReason: req.body.reason, lostAt: new Date() } });
        await salesAudit(tx, req, 'QUOTATION', q.id, 'REJECT', q, updated, { reason: req.body.reason }); return updated;
      }
      if (operation === 'expire') { const updated = await tx.quotation.update({ where: { id: q.id }, data: { status: 'EXPIRED' } }); await salesAudit(tx, req, 'QUOTATION', q.id, 'EXPIRE', q, updated); return updated; }
      throw new Error('Unsupported quotation operation');
    });
    return success(res, result, `Quotation ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Quotation operation failed', 400); }
}

export async function trackQuotationOpen(req: Request, res: Response) {
  try {
    const existing = await prisma.quotation.findUnique({ where: { publicToken: req.params.token } });
    if (!existing) return error(res, 'Invalid quotation token', 404);
    const q = await prisma.quotation.update({ where: { id: existing.id }, data: { openedAt: existing.openedAt || new Date(), status: existing.status === 'SENT' ? 'VIEWED' : existing.status }, select: { id: true, quotationNo: true, status: true } });
    return success(res, q, 'Quotation open recorded');
  } catch { return error(res, 'Invalid quotation token', 404); }
}

export async function getCreditExposure(req: Request, res: Response) {
  try { return success(res, await prisma.$transaction(tx => creditExposure(tx, req.params.customerId, req.query.orderTotal as string || 0))); }
  catch (e: any) { return error(res, e.message || 'Credit check failed', 400); }
}

export async function orderOperation(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    req.body = req.body || {};
    const row = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: true, customer: true } });
      if (!order) throw new Error('Sales order not found');
      if (operation === 'submit') {
        if (order.status !== 'DRAFT') throw new Error('Only draft orders can be submitted');
        const exposure = await creditExposure(tx, order.customerId, order.total);
        if (exposure.blocked) {
          let approvalInstanceId: string | undefined;
          if (tenantId(req)) {
            const rule = await tx.approvalRule.findFirst({ where: { tenantId: tenantId(req), documentType: 'SALES_CREDIT', isActive: true }, orderBy: { priority: 'asc' } });
            if (rule) {
              const steps = Array.isArray(rule.steps) ? rule.steps as any[] : [];
              const instance = await tx.approvalInstance.create({ data: { tenantId: tenantId(req), companyId: companyId(req), documentType: 'SALES_CREDIT', documentId: order.id, requestedBy: actor(req).id, ruleId: rule.id, actions: { create: steps.map((step, index) => ({ tenantId: tenantId(req), sequence: step.sequence || index + 1, approverType: step.approverType || 'USER', approverId: step.approverId })) } } });
              approvalInstanceId = instance.id;
            }
          }
          return tx.salesOrder.update({ where: { id: order.id }, data: { orderNo: order.orderNo.startsWith('DRAFT-') ? await generateOrderNo() : order.orderNo, status: 'ON_HOLD', creditStatus: 'BLOCKED', creditBlockReason: exposure.reasons.join('; '), holdReason: exposure.reasons.join('; '), approvalInstanceId } });
        }
        const confirmed = await tx.salesOrder.update({ where: { id: order.id }, data: { orderNo: order.orderNo.startsWith('DRAFT-') ? await generateOrderNo() : order.orderNo, status: 'CONFIRMED', creditStatus: 'PASSED', submittedAt: new Date() } });
        await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId);
        const allocated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
        await salesAudit(tx, req, 'SALES_ORDER', order.id, 'CONFIRM_AND_ALLOCATE', order, allocated);
        if (order.customer.email) {
          const communication = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', kind: 'ORDER_ACCEPTANCE', recipient: order.customer.email, subject: `Order acceptance ${confirmed.orderNo}`, message: `We have accepted your order ${confirmed.orderNo}.`, status: 'QUEUED', createdById: actor(req).id } });
          await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } });
        }
        return allocated;
      }
      if (operation === 'cancel') { if (!req.body.reason) throw new Error('Cancellation reason is required'); await releaseSalesOrderReservations(tx, order.id); const updated = await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body.reason } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'CANCEL', order, updated, { reason: req.body.reason }); return updated; }
      if (operation === 'hold') { if (!req.body.reason) throw new Error('Hold reason is required'); const updated = await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'ON_HOLD', holdReason: req.body.reason } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'HOLD', order, updated, { reason: req.body.reason }); return updated; }
      if (operation === 'resume') { if (order.status !== 'ON_HOLD') throw new Error('Only held orders can be resumed'); const updated = await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CONFIRMED', resumedAt: new Date(), holdReason: null } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'RESUME', order, updated); return updated; }
      if (operation === 'close') { if ((Number(order.deliveredPercent) < 100 || Number(order.billedPercent) < 100) && !req.body.reason) throw new Error('Short-close reason is required for partially fulfilled orders'); await releaseSalesOrderReservations(tx, order.id); const updated = await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CLOSED', closedAt: new Date(), shortCloseReason: req.body.reason } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'CLOSE', order, updated, { reason: req.body.reason }); return updated; }
      if (operation === 'approve-credit') {
        const approvalId = order.approvalInstanceId || req.body.approvalInstanceId;
        if (!approvalId) throw new Error('A credit approval request is required');
        const approval = await tx.approvalInstance.findUnique({ where: { id: approvalId } });
        if (!approval || approval.status !== 'APPROVED') throw new Error('Credit approval is not approved');
        await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId);
        return tx.salesOrder.update({ where: { id: order.id }, data: { creditStatus: 'APPROVED', creditBlockReason: null, status: 'CONFIRMED', holdReason: null, approvalInstanceId: approvalId, submittedAt: order.submittedAt || new Date() } });
      }
      if (operation === 'release-stock') { await releaseSalesOrderReservations(tx, order.id); const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'RELEASE_STOCK', order, updated); return updated; }
      if (operation === 'reserve-stock') { await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId); const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } }); await salesAudit(tx, req, 'SALES_ORDER', order.id, 'RESERVE_STOCK', order, updated); return updated; }
      if (operation === 'amend') return tx.salesOrder.create({ data: { orderNo: `${order.orderNo}-A${order.revisionNo + 1}`, companyId: order.companyId, customerId: order.customerId, quotationId: order.quotationId, customerPoNo: order.customerPoNo, sourceWarehouseId: order.sourceWarehouseId, deliveryDate: order.deliveryDate, subtotal: order.subtotal, taxAmount: order.taxAmount, discount: order.discount, total: order.total, currency: order.currency, notes: order.notes, terms: order.terms, revisionNo: order.revisionNo + 1, amendedFromId: order.id, billingAddressSnapshot: order.billingAddressSnapshot as any, shippingAddressSnapshot: order.shippingAddressSnapshot as any, items: { create: order.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, discount: i.discount, total: i.total, sourceWarehouseId: i.sourceWarehouseId, supplyMode: i.supplyMode, uomId: i.uomId })) } } });
      throw new Error('Unsupported sales order operation');
    });
    return success(res, row, `Sales order ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Sales order operation failed', 400); }
}

export async function createSalesOrderMaterialRequest(req: Request, res: Response) {
  try {
    const created = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
      if (!order) throw new Error('Sales order not found');
      if (!['CONFIRMED', 'PROCESSING', 'SHIPPED'].includes(order.status)) throw new Error('Only an active confirmed order can raise supply demand');
      const item = order.items.find(row => row.id === req.body.salesOrderItemId);
      if (!item) throw new Error('Sales order item not found');
      const existing = await tx.materialRequest.findFirst({ where: { sourceDocumentType: 'SALES_ORDER_ITEM', sourceDocumentId: item.id, status: { in: ['DRAFT', 'SUBMITTED'] } }, include: { items: true } });
      if (existing) return existing;
      const levels = await tx.stockLevel.aggregate({ where: { productId: item.productId }, _sum: { quantity: true, reservedQty: true } });
      const available = new D(levels._sum.quantity || 0).minus(levels._sum.reservedQty || 0);
      const open = item.quantity.minus(item.deliveredQty);
      const shortage = Prisma.Decimal.max(0, open.minus(Prisma.Decimal.max(0, available)));
      if (shortage.lte(0)) throw new Error('No stock shortage remains for this item');
      const request = await tx.materialRequest.create({ data: { requestNo: code('MR'), companyId: order.companyId, type: item.supplyMode === 'MAKE_TO_ORDER' ? 'MANUFACTURE' : 'PURCHASE', source: 'MANUAL', requiredBy: order.deliveryDate, requestedById: actor(req).id, sourceDocumentType: 'SALES_ORDER', sourceDocumentId: order.id, demandReference: `${order.orderNo} · ${item.product.sku}`, notes: `Automatically raised for sales-order shortage: ${order.orderNo}`, items: { create: { productId: item.productId, warehouseId: item.sourceWarehouseId || order.sourceWarehouseId, quantity: shortage, requiredBy: order.deliveryDate, sourceDocumentType: 'SALES_ORDER_ITEM', sourceDocumentId: item.id, description: item.description || item.product.name } } }, include: { items: { include: { product: true } } } });
      await tx.salesOrderItem.update({ where: { id: item.id }, data: { incomingQty: shortage, supplyStatus: item.supplyMode === 'MAKE_TO_ORDER' ? 'PRODUCTION_REQUIRED' : 'PURCHASE_REQUIRED' } });
      await salesAudit(tx, req, 'MATERIAL_REQUEST', request.id, 'CREATE_FOR_SALES_SHORTAGE', undefined, request, { salesOrderId: order.id, salesOrderItemId: item.id, shortage: shortage.toString() });
      const notifyUser = order.companyId ? await tx.user.findFirst({ where: { companyId: order.companyId, role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } }) : null;
      if (notifyUser) await tx.notification.create({ data: { companyId: order.companyId, userId: notifyUser.id, title: `${request.type === 'PURCHASE' ? 'Procurement' : 'Production'} required for ${order.orderNo}`, message: `${item.product.name}: ${shortage.toString()} required by ${order.deliveryDate ? order.deliveryDate.toLocaleDateString() : 'uncommitted date'}`, type: 'WARNING', link: '/procurement/material-requests' } });
      return request;
    });
    return success(res, created, 'Supply request created', 201);
  } catch (e: any) { return error(res, e.message || 'Could not create supply request', e.message?.includes('not found') ? 404 : 400); }
}

export async function updateSalesOrderPromises(req: Request, res: Response) {
  try {
    const reason = String(req.body.reason || '').trim(); if (!reason) return error(res, 'Promise-change reason is required', 400);
    const updated = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } }, customer: true } });
      if (!order) throw new Error('Sales order not found');
      if (['CANCELLED', 'CLOSED', 'DELIVERED'].includes(order.status)) throw new Error('Delivery promises cannot change on a completed order');
      const requested = new Map((req.body.items || []).map((item: any) => [item.salesOrderItemId || item.id, item.committedDeliveryDate]));
      for (const item of order.items) { const value = requested.get(item.id); if (value) await tx.salesOrderItem.update({ where: { id: item.id }, data: { committedDeliveryDate: new Date(String(value)) } }); }
      const refreshedItems = await tx.salesOrderItem.findMany({ where: { salesOrderId: order.id } });
      const dates = refreshedItems.map(item => item.committedDeliveryDate).filter(Boolean) as Date[]; const completionDate = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : order.deliveryDate;
      const after = await tx.salesOrder.update({ where: { id: order.id }, data: { deliveryDate: completionDate, completionDate }, include: { items: { include: { product: true } }, customer: true } });
      await salesAudit(tx, req, 'SALES_ORDER', order.id, 'CHANGE_DELIVERY_PROMISE', order, after, { reason });
      if (req.body.notifyCustomer && order.customer.email) { const communication = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'PROMISE_DATE_CHANGE', recipient: order.customer.email, subject: `Updated delivery commitment for ${order.orderNo}`, message: req.body.customerMessage || `The delivery schedule for ${order.orderNo} has been updated. Reason: ${reason}`, status: 'QUEUED', createdById: actor(req).id } }); await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } }); }
      return after;
    }); return success(res, updated, 'Delivery promises updated');
  } catch (e: any) { return error(res, e.message || 'Could not update delivery promises', e.message?.includes('not found') ? 404 : 400); }
}

export async function updateSalesOrderPicking(req: Request, res: Response) {
  try {
    const updated = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!order) throw new Error('Sales order not found');
      if (['CANCELLED', 'CLOSED', 'DELIVERED'].includes(order.status)) throw new Error('A completed order cannot be picked');
      const requested = new Map((req.body.items || []).map((row: any) => [String(row.salesOrderItemId || row.id), new D(row.pickedQty || 0)]));
      for (const item of order.items) {
        const picked = requested.get(item.id) as Prisma.Decimal | undefined;
        if (picked === undefined) continue;
        const maximum = Prisma.Decimal.max(0, item.readyQty.minus(item.dispatchedQty));
        if (picked.lt(0) || picked.gt(maximum)) throw new Error(`Picked quantity for item ${item.id} must be between 0 and ${maximum}`);
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { pickedQty: picked } });
      }
      const after = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } } } });
      await salesAudit(tx, req, 'SALES_ORDER', order.id, 'UPDATE_PICKING', order, after);
      return after;
    });
    return success(res, updated, 'Picking quantities updated');
  } catch (e: any) { return error(res, e.message || 'Could not update picking', e.message?.includes('not found') ? 404 : 400); }
}

export async function shortCloseSalesOrderLines(req: Request, res: Response) {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return error(res, 'Short-close reason is required', 400);
    const updated = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!order) throw new Error('Sales order not found');
      if (['CANCELLED', 'CLOSED', 'DELIVERED'].includes(order.status)) throw new Error('A completed order cannot be short-closed');
      const requested = new Map((req.body.items || []).map((row: any) => [String(row.salesOrderItemId || row.id), new D(row.shortClosedQty || 0)]));
      for (const item of order.items) {
        const quantity = requested.get(item.id) as Prisma.Decimal | undefined;
        if (quantity === undefined) continue;
        const maximum = Prisma.Decimal.max(0, item.quantity.minus(item.deliveredQty).minus(item.returnedQty));
        if (quantity.lt(0) || quantity.gt(maximum)) throw new Error(`Short-close quantity for item ${item.id} must be between 0 and ${maximum}`);
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { shortClosedQty: quantity, supplyStatus: quantity.gte(maximum) ? 'SHORT_CLOSED' : item.supplyStatus } });
      }
      const after = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { product: true } } } });
      await salesAudit(tx, req, 'SALES_ORDER', order.id, 'SHORT_CLOSE_LINES', order, after, { reason });
      return after;
    });
    return success(res, updated, 'Order lines short-closed');
  } catch (e: any) { return error(res, e.message || 'Could not short-close lines', e.message?.includes('not found') ? 404 : 400); }
}

export async function createProductionPlan(req: Request, res: Response) {
  try {
    const plan = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: true, productionPlans: { where: { status: { in: ['DRAFT', 'PLANNED', 'IN_PROGRESS'] } }, include: { items: true } } } });
      if (!order) throw new Error('Sales order not found');
      const requested = new Map<string, Prisma.Decimal>((req.body.items || []).map((i: any) => [String(i.salesOrderItemId), new D(i.quantity)] as [string, Prisma.Decimal]));
      const alreadyPlanned = new Map<string, Prisma.Decimal>();
      for (const existingPlan of order.productionPlans) for (const line of existingPlan.items) alreadyPlanned.set(line.salesOrderItemId, (alreadyPlanned.get(line.salesOrderItemId) || new D(0)).plus(line.plannedQty).minus(line.producedQty));
      const items: any[] = order.items.filter(i => i.supplyMode === 'MAKE_TO_ORDER' || requested.has(i.id)).flatMap(i => {
        const remaining = i.quantity.minus(i.producedQty).minus(alreadyPlanned.get(i.id) || 0);
        const plannedQty = requested.get(i.id) || remaining;
        if (plannedQty.lte(0)) return [];
        if (plannedQty.gt(remaining)) throw new Error(`Production quantity exceeds unplanned quantity ${remaining}`);
        return [{ salesOrderItemId: i.id, plannedQty }];
      });
      if (!items.length) throw new Error('No make-to-order quantities require production');
      const created = await tx.salesProductionPlan.create({ data: { planNo: code('PP'), companyId: order.companyId, salesOrderId: order.id, targetDate: req.body.targetDate ? new Date(req.body.targetDate) : order.deliveryDate, notes: req.body.notes, items: { create: items } }, include: { items: true } });
      await salesAudit(tx, req, 'PRODUCTION_PLAN', created.id, 'CREATE_FOR_SALES_ORDER', undefined, created, { salesOrderId: order.id });
      return created;
    });
    return success(res, plan, 'Production plan created', 201);
  } catch (e: any) { return error(res, e.message || 'Production plan failed', 400); }
}

export async function updateProductionPlan(req: Request, res: Response) {
  try {
    const plan = await prisma.$transaction(async tx => {
      const existing = await tx.salesProductionPlan.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!existing) throw new Error('Production plan not found');
      const quantities = new Map((req.body.items || []).map((i: any) => [i.id || i.productionPlanItemId, new D(i.producedQty)]));
      for (const item of existing.items) {
        const produced = quantities.get(item.id) as Prisma.Decimal | undefined;
        if (!produced) continue;
        if (produced.lt(item.producedQty) || produced.gt(item.plannedQty)) throw new Error('Produced quantity cannot decrease or exceed planned quantity');
        const delta = produced.minus(item.producedQty);
        await tx.salesProductionPlanItem.update({ where: { id: item.id }, data: { producedQty: produced, status: produced.gte(item.plannedQty) ? 'COMPLETED' : produced.gt(0) ? 'IN_PROGRESS' : 'PLANNED' } });
        const orderItem = await tx.salesOrderItem.findUnique({ where: { id: item.salesOrderItemId } });
        const backorderReduction = Prisma.Decimal.min(delta, orderItem?.backorderQty || 0);
        await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { producedQty: { increment: delta }, readyQty: { increment: delta }, backorderQty: { decrement: backorderReduction }, incomingQty: { decrement: Prisma.Decimal.min(delta, orderItem?.incomingQty || 0) }, supplyStatus: produced.gte(item.plannedQty) ? 'READY' : 'IN_PRODUCTION' } });
      }
      const refreshed = await tx.salesProductionPlan.findUnique({ where: { id: existing.id }, include: { items: true } });
      const completed = refreshed!.items.every(i => i.producedQty.gte(i.plannedQty));
      const updated = await tx.salesProductionPlan.update({ where: { id: existing.id }, data: { status: completed ? 'COMPLETED' : refreshed!.items.some(i => i.producedQty.gt(0)) ? 'IN_PROGRESS' : req.body.status || existing.status }, include: { items: true } });
      await salesAudit(tx, req, 'PRODUCTION_PLAN', existing.id, 'UPDATE_PROGRESS', existing, updated);
      return updated;
    });
    return success(res, plan, 'Production progress updated');
  } catch (e: any) { return error(res, e.message || 'Production update failed', 400); }
}

export async function availableToPromise(req: Request, res: Response) {
  try {
    const requested = new D(req.query.quantity as string || 0);
    const levels = await prisma.stockLevel.findMany({ where: { productId: req.params.productId, ...(req.query.warehouseId ? { warehouseId: req.query.warehouseId as string } : {}) }, include: { warehouse: true } });
    const rows = levels.map(l => { const available = new D(l.quantity).minus(l.reservedQty); return { warehouseId: l.warehouseId, warehouse: l.warehouse.name, onHand: l.quantity, reserved: l.reservedQty, available, canFulfil: available.gte(requested) }; });
    return success(res, { productId: req.params.productId, requested, projectedAvailable: rows.reduce((n, l) => n.plus(l.available), new D(0)), warehouses: rows });
  } catch (e) { return handlePrismaError(res, e); }
}

export async function fulfilmentDashboard(req: Request, res: Response) {
  try {
    const where: any = { status: { notIn: ['DRAFT', 'CANCELLED'] }, ...(companyId(req) ? { companyId: companyId(req) } : {}) };
    const orders = await prisma.salesOrder.findMany({ where, include: { customer: true, quotation: { include: { enquirySource: true } }, items: { include: { product: { include: { stockLevels: { include: { warehouse: true } } } }, stockReservations: true } }, productionPlans: true, deliveryNotes: { include: { items: true } }, invoices: true }, orderBy: [{ deliveryDate: 'asc' }, { date: 'desc' }] });
    const orderIds = orders.map(order => order.id);
    const requests = orderIds.length ? await prisma.materialRequest.findMany({ where: { sourceDocumentType: 'SALES_ORDER', sourceDocumentId: { in: orderIds } }, include: { items: true, purchaseOrders: { include: { supplier: true, items: true, receipts: { include: { items: true } } } } }, orderBy: { createdAt: 'desc' } }) : [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = orders.flatMap(order => order.items.map(item => {
      const lineRequests = requests.filter(request => request.sourceDocumentId === order.id && request.items.some(requestItem => requestItem.sourceDocumentId === item.id || requestItem.productId === item.productId));
      const purchaseOrders = lineRequests.flatMap(request => request.purchaseOrders).filter(po => po.items.some(poItem => poItem.productId === item.productId));
      const supplierOrderedQty = purchaseOrders.reduce((sum, po) => sum + po.items.filter(poItem => poItem.productId === item.productId).reduce((n, poItem) => n + Number(poItem.quantity), 0), 0);
      const supplierReceivedQty = purchaseOrders.reduce((sum, po) => sum + po.items.filter(poItem => poItem.productId === item.productId).reduce((n, poItem) => n + Number(poItem.receivedQty || poItem.acceptedQty), 0), 0);
      const onHandQty = item.product.stockLevels.reduce((sum, level) => sum + Number(level.quantity), 0);
      const reservedForOrder = item.stockReservations.filter(reservation => ['ACTIVE', 'PARTIAL'].includes(reservation.status)).reduce((sum, reservation) => sum + Math.max(0, Number(reservation.reservedQty) - Number(reservation.fulfilledQty)), 0);
      const orderedQty = Number(item.quantity), dispatchedQty = Number(item.dispatchedQty), deliveredQty = Number(item.deliveredQty), shortClosedQty = Number(item.shortClosedQty);
      const remainingToDispatch = Math.max(0, orderedQty - dispatchedQty - shortClosedQty), remainingToDeliver = Math.max(0, orderedQty - deliveredQty - shortClosedQty);
      const procurementGap = Math.max(0, remainingToDispatch - reservedForOrder - Math.max(0, supplierOrderedQty - supplierReceivedQty));
      const promisedDate = item.committedDeliveryDate || order.deliveryDate;
      const daysToPromise = promisedDate ? Math.ceil((new Date(promisedDate).setHours(0,0,0,0) - today.getTime()) / 86400000) : null;
      const nextSupplierDate = purchaseOrders.map(po => po.estimatedArrivalAt || po.expectedDate).filter(Boolean).sort((a: any, b: any) => new Date(a).getTime() - new Date(b).getTime())[0] || null;
      const risk = remainingToDeliver <= 0 ? 'COMPLETE' : daysToPromise != null && daysToPromise < 0 ? 'OVERDUE' : nextSupplierDate && promisedDate && new Date(nextSupplierDate) > new Date(promisedDate) ? 'SUPPLIER_LATE' : procurementGap > 0 ? 'PURCHASE_REQUIRED' : supplierOrderedQty > supplierReceivedQty ? 'INCOMING' : reservedForOrder >= remainingToDispatch ? 'READY' : 'AT_RISK';
      return { id: item.id, salesOrderId: order.id, salesCaseId: order.quotation?.enquirySource?.id, orderNo: order.orderNo, customer: order.customer.name, productId: item.productId, sku: item.product.sku, product: item.product.name, orderedQty, onHandQty, reservedForOrder, procurementGap, supplierOrderedQty, supplierReceivedQty, incomingQty: Math.max(0, supplierOrderedQty - supplierReceivedQty), dispatchedQty, deliveredQty, remainingToDispatch, remainingToDeliver, promisedDate, daysToPromise, nextSupplierDate, risk, supplyStatus: item.supplyStatus, materialRequests: lineRequests.map(request => ({ id: request.id, requestNo: request.requestNo, status: request.status })), purchaseOrders: purchaseOrders.map(po => ({ id: po.id, orderNo: po.orderNo, supplier: po.supplier.name, status: po.status, expectedDate: po.expectedDate, estimatedArrivalAt: po.estimatedArrivalAt, dispatchedAt: po.dispatchedAt, trackingReference: po.trackingReference })) };
    }));
    return success(res, rows);
  } catch (e) { return handlePrismaError(res, e); }
}

async function syncCommitmentAlerts(req: Request, onlyOrderId?: string) {
  const company = companyId(req);
  const policy = await prisma.salesAlertPolicy.findFirst({ where: { companyId: company } }) || { warningDays: [7, 3, 1, 0], isActive: true, notifyManagers: true };
  if (!policy.isActive) return [];
  const warningDays = (Array.isArray(policy.warningDays) ? policy.warningDays : [7, 3, 1, 0]).map(Number).sort((a, b) => b - a);
  const orders = await prisma.salesOrder.findMany({ where: { ...(onlyOrderId ? { id: onlyOrderId } : {}), ...(company ? { companyId: company } : {}), status: { in: ['CONFIRMED', 'AWAITING_STOCK', 'PARTIALLY_READY', 'READY_TO_DISPATCH', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED', 'PARTIALLY_DELIVERED', 'PROCESSING', 'SHIPPED'] } }, include: { items: { include: { product: { include: { stockLevels: true } } } }, deliveryNotes: { where: { status: 'SUBMITTED' } } } });
  const activeKeys = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      const promised = item.committedDeliveryDate || order.deliveryDate;
      if (!promised) continue;
      const remaining = Prisma.Decimal.max(0, item.quantity.minus(item.deliveredQty).minus(item.shortClosedQty));
      if (remaining.lte(0)) continue;
      const available = item.product.stockLevels.reduce((sum, level) => sum.plus(level.quantity).minus(level.reservedQty), new D(0));
      const shortage = Prisma.Decimal.max(0, remaining.minus(Prisma.Decimal.max(0, available)).minus(item.incomingQty || 0));
      const today = new Date(); today.setHours(0, 0, 0, 0); const due = new Date(promised); due.setHours(0, 0, 0, 0);
      const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      const threshold = days < 0 ? 'OVERDUE' : warningDays.find(day => days <= day);
      if (threshold == null) continue;
      const type = days < 0 ? 'OVERDUE' : days === 0 ? 'DUE_TODAY' : shortage.gt(0) ? `SHORTAGE_D${threshold}` : `NOT_READY_D${threshold}`;
      const key = `${order.id}:${item.id}:${type}`; activeKeys.add(key);
      const severity = days < 0 || days <= 1 ? 'CRITICAL' : days <= 3 ? 'HIGH' : 'MEDIUM';
      const action = shortage.gt(0) ? (item.supplyMode === 'MAKE_TO_ORDER' ? 'CREATE_PRODUCTION_PLAN' : 'CREATE_MATERIAL_REQUEST') : 'CREATE_DISPATCH';
      const title = `${days < 0 ? 'Overdue' : `${days} day commitment`}: ${item.product.name}`;
      const message = `${order.orderNo} has ${remaining.toString()} open, ${available.toString()} available and ${shortage.toString()} unplanned shortage.`;
      const existing = await prisma.salesCommitmentAlert.findUnique({ where: { alertKey: key } });
      await prisma.salesCommitmentAlert.upsert({ where: { alertKey: key }, update: { severity, title, message, action, dueAt: promised, status: existing?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN', resolvedAt: null }, create: { companyId: order.companyId, salesOrderId: order.id, salesOrderItemId: item.id, alertKey: key, type, severity, title, message, action, actionHref: `/sales/enquiries`, dueAt: promised } });
      if (!existing && policy.notifyManagers) {
        const users = await prisma.user.findMany({ where: { ...(order.companyId ? { companyId: order.companyId } : {}), role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true }, take: 20 });
        if (users.length) await prisma.notification.createMany({ data: users.map(user => ({ companyId: order.companyId, userId: user.id, title, message, type: severity === 'CRITICAL' ? 'ERROR' : 'WARNING', link: '/sales/fulfilment' })) });
      }
    }
    for (const note of order.deliveryNotes) {
      if (!note.expectedDeliveryAt || ['DELIVERED', 'RETURNED'].includes(note.shipmentStatus) || note.expectedDeliveryAt >= new Date()) continue;
      const key = `${order.id}:${note.id}:SHIPMENT_OVERDUE`; activeKeys.add(key);
      await prisma.salesCommitmentAlert.upsert({ where: { alertKey: key }, update: { status: 'OPEN', resolvedAt: null }, create: { companyId: order.companyId, salesOrderId: order.id, alertKey: key, type: 'SHIPMENT_OVERDUE', severity: 'CRITICAL', title: `Shipment overdue: ${note.deliveryNo}`, message: `Expected delivery was ${note.expectedDeliveryAt.toLocaleDateString()}.`, action: 'CONTACT_TRANSPORTER', actionHref: '/invoicing/delivery-notes', dueAt: note.expectedDeliveryAt } });
    }
  }
  const scope = { ...(onlyOrderId ? { salesOrderId: onlyOrderId } : {}), ...(company ? { companyId: company } : {}), status: { in: ['OPEN', 'ACKNOWLEDGED'] } };
  const current = await prisma.salesCommitmentAlert.findMany({ where: scope });
  const managedTypes = new Set(['OVERDUE', 'DUE_TODAY', 'SHIPMENT_OVERDUE']);
  const stale = current.filter(alert => (managedTypes.has(alert.type) || alert.type.startsWith('SHORTAGE_D') || alert.type.startsWith('NOT_READY_D')) && !activeKeys.has(alert.alertKey)).map(alert => alert.id);
  if (stale.length) await prisma.salesCommitmentAlert.updateMany({ where: { id: { in: stale } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  return prisma.salesCommitmentAlert.findMany({ where: { ...scope, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, orderBy: [{ severity: 'asc' }, { dueAt: 'asc' }] });
}

export async function listCommitmentAlerts(req: Request, res: Response) { try { return success(res, await syncCommitmentAlerts(req, req.query.orderId as string | undefined)); } catch (e) { return handlePrismaError(res, e); } }
export async function acknowledgeCommitmentAlert(req: Request, res: Response) { try { const row = await prisma.salesCommitmentAlert.update({ where: { id: req.params.id }, data: { status: 'ACKNOWLEDGED', acknowledgedById: actor(req).id, acknowledgedAt: new Date() } }); return success(res, row, 'Alert acknowledged'); } catch (e) { return handlePrismaError(res, e); } }
export async function getSalesAlertPolicy(req: Request, res: Response) { try { const row = await prisma.salesAlertPolicy.findFirst({ where: { companyId: companyId(req) } }); return success(res, row || { warningDays: [7, 3, 1, 0], notifyAssignedSalesperson: true, notifyManagers: true, notifyProcurement: true, isActive: true }); } catch (e) { return handlePrismaError(res, e); } }
export async function updateSalesAlertPolicy(req: Request, res: Response) { try { const warningDays = (req.body.warningDays || [7, 3, 1, 0]).map(Number).filter((day: number) => day >= 0 && day <= 365); const row = await prisma.salesAlertPolicy.upsert({ where: { companyId: companyId(req) }, update: { warningDays, notifyAssignedSalesperson: req.body.notifyAssignedSalesperson, notifyManagers: req.body.notifyManagers, notifyProcurement: req.body.notifyProcurement, isActive: req.body.isActive }, create: { companyId: companyId(req), warningDays, notifyAssignedSalesperson: req.body.notifyAssignedSalesperson ?? true, notifyManagers: req.body.notifyManagers ?? true, notifyProcurement: req.body.notifyProcurement ?? true, isActive: req.body.isActive ?? true } }); return success(res, row, 'Sales alert policy updated'); } catch (e) { return handlePrismaError(res, e); } }

export async function salesReport(req: Request, res: Response) {
  try {
    const type = req.params.type, company = companyId(req);
    const base: any = company ? { companyId: company } : {};
    if (type === 'open-order-book' || type === 'backorders' || type === 'order-ageing') {
      const rows = await prisma.salesOrder.findMany({ where: { ...base, status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'ON_HOLD'] }, ...(type === 'backorders' ? { items: { some: { backorderQty: { gt: 0 } } } } : {}) }, include: { customer: true, items: true }, orderBy: { date: 'asc' } });
      return success(res, rows.map(o => ({ ...o, ageDays: Math.floor((Date.now() - o.date.getTime()) / 86400000) })));
    }
    if (type === 'quotation-conversion') { const grouped = await prisma.quotation.groupBy({ by: ['status'], where: base, _count: true, _sum: { total: true } }); return success(res, grouped); }
    if (type === 'price-variance') return success(res, await prisma.salesPriceVariance.findMany({ where: base, orderBy: { createdAt: 'desc' } }));
    if (type === 'gross-margin') { const rows = await prisma.quotationItem.findMany({ where: { quotation: base }, include: { quotation: true, product: true } }); return success(res, rows.map(i => ({ quotationNo: i.quotation.quotationNo, product: i.product.name, revenue: i.total, cost: i.costRate.mul(i.quantity), margin: i.total.minus(i.costRate.mul(i.quantity)) }))); }
    if (type === 'delivery-performance') return success(res, await prisma.salesOrder.findMany({ where: base, select: { id: true, orderNo: true, date: true, deliveryDate: true, deliveredPercent: true, status: true } }));
    if (type === 'performance') return success(res, await prisma.salesOrder.groupBy({ by: ['customerId', 'territory', 'salesChannel'], where: { ...base, status: { not: 'CANCELLED' } }, _count: true, _sum: { total: true } }));
    return error(res, 'Unknown report type', 404);
  } catch (e) { return handlePrismaError(res, e); }
}
