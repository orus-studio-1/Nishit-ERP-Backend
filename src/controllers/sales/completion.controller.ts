import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { error, paginated, success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateOrderNo, generateQuotationNo } from '../../utils/generate';
import { normalizeSalesItems } from './shared';
import { reserveSalesOrderStock, releaseSalesOrderReservations } from '../../services/inventory/reservation.service';

const D = Prisma.Decimal;
const actor = (req: Request) => (req as any).user || {};
const companyId = (req: Request) => actor(req).companyId || undefined;
const tenantId = (req: Request) => actor(req).tenantId;
const code = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const addressSnapshot = (customer: any) => ({ address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId });

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
    const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
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
    const [rows, total] = await Promise.all([prisma.salesEnquiry.findMany({ where, include: { customer: true, items: { include: { product: true } }, convertedQuotation: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.salesEnquiry.count({ where })]);
    return paginated(res, rows, total, page, limit);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function getEnquiry(req: Request, res: Response) {
  try {
    const row = await prisma.salesEnquiry.findUnique({ where: { id: req.params.id }, include: { customer: true, items: { include: { product: true } }, convertedQuotation: true } });
    return row ? success(res, row) : error(res, 'Sales enquiry not found', 404);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function createEnquiry(req: Request, res: Response) {
  try {
    const { customerId, items = [] } = req.body;
    if (!customerId || !items.length) return error(res, 'Customer and at least one item are required', 400);
    if (items.some((item: any) => !item.productId || !Number.isFinite(Number(item.targetQty || item.quantity)) || Number(item.targetQty || item.quantity) <= 0)) return error(res, 'Every item requires a product and target quantity greater than zero', 400);
    const source = String(req.body.source || 'MANUAL').toUpperCase();
    if (!['MANUAL', 'EMAIL', 'WHATSAPP', 'PHONE', 'WEB', 'REFERRAL'].includes(source)) return error(res, 'Invalid enquiry source', 400);
    const row = await prisma.salesEnquiry.create({ data: { enquiryNo: code('ENQ'), companyId: companyId(req), customerId, opportunityId: req.body.opportunityId, source, sourceReference: req.body.sourceReference, receivedAt: req.body.receivedAt ? new Date(req.body.receivedAt) : new Date(), followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : undefined, followUpStatus: req.body.followUpStatus || 'PENDING', requirements: req.body.requirements, targetDate: req.body.targetDate ? new Date(req.body.targetDate) : undefined, currency: req.body.currency || 'USD', territory: req.body.territory, salesChannel: req.body.salesChannel, branchId: req.body.branchId, createdById: actor(req).id, items: { create: items.map((i: any) => ({ productId: i.productId, description: i.description, targetQty: new D(i.targetQty || i.quantity || 0), targetDate: i.targetDate ? new Date(i.targetDate) : undefined, targetPrice: i.targetPrice == null ? undefined : new D(i.targetPrice), uomId: i.uomId })) } }, include: { customer: true, items: true } });
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
      return tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { followUpStatus: status, followUpAt: req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : status === 'COMPLETED' ? null : enquiry.followUpAt } });
    });
    return success(res, row, 'Enquiry follow-up recorded');
  } catch (e: any) { return error(res, e.message || 'Could not record follow-up', e.message?.includes('not found') ? 404 : 400); }
}

export async function loseEnquiry(req: Request, res: Response) {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return error(res, 'Loss reason is required', 400);
    const row = await prisma.salesEnquiry.update({ where: { id: req.params.id }, data: { status: 'LOST', lossReason: reason, lostAt: new Date(), followUpStatus: 'COMPLETED' } });
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

export async function updateEnquiry(req: Request, res: Response) {
  try {
    const existing = await prisma.salesEnquiry.findUnique({ where: { id: req.params.id } });
    if (!existing) return error(res, 'Sales enquiry not found', 404);
    if (existing.status !== 'DRAFT') return error(res, 'Only draft enquiries can be edited', 400);
    const { items, targetDate, ...values } = req.body;
    const row = await prisma.$transaction(async tx => {
      if (items) await tx.salesEnquiryItem.deleteMany({ where: { enquiryId: existing.id } });
      return tx.salesEnquiry.update({ where: { id: existing.id }, data: { ...values, ...(targetDate ? { targetDate: new Date(targetDate) } : {}), ...(items ? { items: { create: items.map((i: any) => ({ productId: i.productId, description: i.description, targetQty: new D(i.targetQty || i.quantity || 0), targetDate: i.targetDate ? new Date(i.targetDate) : undefined, targetPrice: i.targetPrice == null ? undefined : new D(i.targetPrice), uomId: i.uomId })) } } : {}) }, include: { customer: true, items: true } });
    });
    return success(res, row, 'Sales enquiry updated');
  } catch (e: any) { return e.message ? error(res, e.message, 400) : handlePrismaError(res, e); }
}

export async function submitEnquiry(req: Request, res: Response) {
  try {
    const updated = await prisma.salesEnquiry.updateMany({ where: { id: req.params.id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    if (!updated.count) return error(res, 'Only a draft enquiry can be submitted', 400);
    return success(res, await prisma.salesEnquiry.findUnique({ where: { id: req.params.id }, include: { items: true } }), 'Sales enquiry submitted');
  } catch (e) { return handlePrismaError(res, e); }
}

export async function convertEnquiry(req: Request, res: Response) {
  try {
    const quotation = await prisma.$transaction(async tx => {
      const enquiry = await tx.salesEnquiry.findUnique({ where: { id: req.params.id }, include: { customer: true, items: { include: { product: true } } } });
      if (!enquiry) throw new Error('Sales enquiry not found');
      if (enquiry.status !== 'SUBMITTED') throw new Error('Only submitted enquiries can be converted');
      const calculated = await normalizeSalesItems(tx, enquiry.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.targetQty, unitPrice: i.targetPrice })), { customerId: enquiry.customerId, currency: enquiry.currency });
      const q = await tx.quotation.create({ data: { quotationNo: `DRAFT-QTN-${Date.now()}-${Math.floor(Math.random() * 1000)}`, companyId: enquiry.companyId, customerId: enquiry.customerId, currency: enquiry.currency, subtotal: calculated.subtotal, taxAmount: calculated.taxAmount, total: calculated.subtotal.plus(calculated.taxAmount), billingAddressSnapshot: addressSnapshot(enquiry.customer), shippingAddressSnapshot: addressSnapshot(enquiry.customer), branchId: enquiry.branchId, items: { create: calculated.items } }, include: { items: true, customer: true } });
      await tx.salesEnquiry.update({ where: { id: enquiry.id }, data: { status: 'QUOTED', convertedQuotationId: q.id } });
      return q;
    });
    return success(res, quotation, 'Enquiry converted to quotation', 201);
  } catch (e: any) { return error(res, e.message || 'Conversion failed', 400); }
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
        return tx.quotation.update({ where: { id: q.id }, data: { quotationNo: q.quotationNo.startsWith('DRAFT-') ? await generateQuotationNo() : q.quotationNo, submittedAt: new Date(), approvalInstanceId } });
      }
      if (operation === 'revise') {
        if (!q.submittedAt) throw new Error('Submit the quotation before creating a revision');
        return tx.quotation.create({ data: { quotationNo: `${q.quotationNo}-R${q.revisionNo + 1}`, companyId: q.companyId, customerId: q.customerId, date: new Date(), validUntil: req.body.validUntil ? new Date(req.body.validUntil) : q.validUntil, status: 'DRAFT', subtotal: q.subtotal, taxAmount: q.taxAmount, discount: q.discount, total: q.total, currency: q.currency, notes: q.notes, terms: q.terms, revisionNo: q.revisionNo + 1, supersedesId: q.id, commercialConditions: q.commercialConditions as any, billingAddressSnapshot: q.billingAddressSnapshot as any, shippingAddressSnapshot: q.shippingAddressSnapshot as any, branchId: q.branchId, placeOfSupply: q.placeOfSupply, taxMode: q.taxMode, deliveryTerms: q.deliveryTerms, transporterInfo: q.transporterInfo as any, items: { create: q.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, discount: i.discount, total: i.total, uomId: i.uomId, costRate: i.costRate, marginPercent: i.marginPercent, priceSource: i.priceSource })) } } });
      }
      if (operation === 'send') {
        if (!q.submittedAt) throw new Error('Submit the quotation before sending');
        if (q.approvalInstanceId) {
          const approval = await tx.approvalInstance.findUnique({ where: { id: q.approvalInstanceId } });
          if (approval?.status !== 'APPROVED') throw new Error('Quotation approval is pending');
        }
        const token = q.publicToken || randomBytes(24).toString('hex');
        const communication = await tx.salesCommunication.create({ data: { companyId: q.companyId, entityType: 'QUOTATION', entityId: q.id, channel: 'EMAIL', kind: 'RATE_QUOTE', recipient: req.body.email || q.customer.email, subject: `Quotation ${q.quotationNo}`, message: req.body.message || 'Quotation and rates sent to customer', status: 'QUEUED', createdById: actor(req).id } });
        await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_QUOTATION_EMAIL', payload: { quotationId: q.id, to: req.body.email || q.customer.email, token, communicationId: communication.id }, status: 'PENDING' } });
        return tx.quotation.update({ where: { id: q.id }, data: { status: 'SENT', sentAt: new Date(), publicToken: token } });
      }
      if (operation === 'accept') return tx.quotation.update({ where: { id: q.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      if (operation === 'reject') {
        if (!req.body.reason) throw new Error('Rejection reason is required');
        return tx.quotation.update({ where: { id: q.id }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: req.body.reason } });
      }
      if (operation === 'expire') return tx.quotation.update({ where: { id: q.id }, data: { status: 'EXPIRED' } });
      throw new Error('Unsupported quotation operation');
    });
    return success(res, result, `Quotation ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Quotation operation failed', 400); }
}

export async function trackQuotationOpen(req: Request, res: Response) {
  try {
    const q = await prisma.quotation.update({ where: { publicToken: req.params.token }, data: { openedAt: new Date() }, select: { id: true, quotationNo: true, status: true } });
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
        await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId);
        const confirmed = await tx.salesOrder.update({ where: { id: order.id }, data: { orderNo: order.orderNo.startsWith('DRAFT-') ? await generateOrderNo() : order.orderNo, status: 'CONFIRMED', creditStatus: 'PASSED', submittedAt: new Date() } });
        if (order.customer.email) {
          const communication = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', kind: 'ORDER_ACCEPTANCE', recipient: order.customer.email, subject: `Order acceptance ${confirmed.orderNo}`, message: `We have accepted your order ${confirmed.orderNo}.`, status: 'QUEUED', createdById: actor(req).id } });
          await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } });
        }
        return confirmed;
      }
      if (operation === 'cancel') { if (!req.body.reason) throw new Error('Cancellation reason is required'); await releaseSalesOrderReservations(tx, order.id); return tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body.reason } }); }
      if (operation === 'hold') { if (!req.body.reason) throw new Error('Hold reason is required'); return tx.salesOrder.update({ where: { id: order.id }, data: { status: 'ON_HOLD', holdReason: req.body.reason } }); }
      if (operation === 'resume') { if (order.status !== 'ON_HOLD') throw new Error('Only held orders can be resumed'); return tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CONFIRMED', resumedAt: new Date(), holdReason: null } }); }
      if (operation === 'close') { if ((Number(order.deliveredPercent) < 100 || Number(order.billedPercent) < 100) && !req.body.reason) throw new Error('Short-close reason is required for partially fulfilled orders'); await releaseSalesOrderReservations(tx, order.id); return tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CLOSED', closedAt: new Date(), shortCloseReason: req.body.reason } }); }
      if (operation === 'approve-credit') {
        const approvalId = order.approvalInstanceId || req.body.approvalInstanceId;
        if (!approvalId) throw new Error('A credit approval request is required');
        const approval = await tx.approvalInstance.findUnique({ where: { id: approvalId } });
        if (!approval || approval.status !== 'APPROVED') throw new Error('Credit approval is not approved');
        await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId);
        return tx.salesOrder.update({ where: { id: order.id }, data: { creditStatus: 'APPROVED', creditBlockReason: null, status: 'CONFIRMED', holdReason: null, approvalInstanceId: approvalId, submittedAt: order.submittedAt || new Date() } });
      }
      if (operation === 'release-stock') { await releaseSalesOrderReservations(tx, order.id); return order; }
      if (operation === 'reserve-stock') { await reserveSalesOrderStock(tx, order.id, req.body.warehouseId || order.sourceWarehouseId); return order; }
      if (operation === 'amend') return tx.salesOrder.create({ data: { orderNo: `${order.orderNo}-A${order.revisionNo + 1}`, companyId: order.companyId, customerId: order.customerId, quotationId: order.quotationId, customerPoNo: order.customerPoNo, sourceWarehouseId: order.sourceWarehouseId, deliveryDate: order.deliveryDate, subtotal: order.subtotal, taxAmount: order.taxAmount, discount: order.discount, total: order.total, currency: order.currency, notes: order.notes, terms: order.terms, revisionNo: order.revisionNo + 1, amendedFromId: order.id, billingAddressSnapshot: order.billingAddressSnapshot as any, shippingAddressSnapshot: order.shippingAddressSnapshot as any, items: { create: order.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, discount: i.discount, total: i.total, sourceWarehouseId: i.sourceWarehouseId, supplyMode: i.supplyMode, uomId: i.uomId })) } } });
      throw new Error('Unsupported sales order operation');
    });
    return success(res, row, `Sales order ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Sales order operation failed', 400); }
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
      return tx.salesProductionPlan.create({ data: { planNo: code('PP'), companyId: order.companyId, salesOrderId: order.id, targetDate: req.body.targetDate ? new Date(req.body.targetDate) : order.deliveryDate, notes: req.body.notes, items: { create: items } }, include: { items: true } });
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
        await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { producedQty: { increment: delta }, backorderQty: { decrement: Prisma.Decimal.min(delta, (await tx.salesOrderItem.findUnique({ where: { id: item.salesOrderItemId } }))?.backorderQty || 0) } } });
      }
      const refreshed = await tx.salesProductionPlan.findUnique({ where: { id: existing.id }, include: { items: true } });
      const completed = refreshed!.items.every(i => i.producedQty.gte(i.plannedQty));
      return tx.salesProductionPlan.update({ where: { id: existing.id }, data: { status: completed ? 'COMPLETED' : refreshed!.items.some(i => i.producedQty.gt(0)) ? 'IN_PROGRESS' : req.body.status || existing.status }, include: { items: true } });
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
    const orders = await prisma.salesOrder.findMany({ where, include: { customer: true, items: true, stockReservations: true, productionPlans: true, deliveryNotes: true, invoices: true }, orderBy: { date: 'desc' } });
    return success(res, orders.map(o => ({ ...o, backorderQty: o.items.reduce((n, i) => n.plus(i.backorderQty), new D(0)), orderedQty: o.items.reduce((n, i) => n.plus(i.quantity), new D(0)), producedQty: o.items.reduce((n, i) => n.plus(i.producedQty), new D(0)), deliveredQty: o.items.reduce((n, i) => n.plus(i.deliveredQty), new D(0)), invoicedQty: o.items.reduce((n, i) => n.plus(i.billedQty), new D(0)) })));
  } catch (e) { return handlePrismaError(res, e); }
}

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
