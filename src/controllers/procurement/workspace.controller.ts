import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import prisma from '../../lib/prisma';
import { error, success } from '../../utils/response';

const number = (value: any) => Number(value || 0);
const user = (req: Request) => (req as any).user || {};

export async function submitProcurementCaseRfq(req: Request, res: Response) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rfq = await tx.requestForQuotation.findUnique({ where: { id: req.params.id }, include: { suppliers: { include: { supplier: true } }, items: true } });
      if (!rfq) throw new Error('Procurement case not found');
      if (rfq.status !== 'DRAFT') throw new Error('Only a draft RFQ can be submitted');
      if (!rfq.items.length) throw new Error('Add at least one requested product');
      if (!rfq.suppliers.length) throw new Error('Invite at least one supplier before submitting the RFQ');
      for (const supplierRow of rfq.suppliers) {
        const recipient = supplierRow.email || supplierRow.supplier.email;
        if (!recipient) throw new Error(`${supplierRow.supplier.name} has no email address`);
        const token = supplierRow.portalToken || randomBytes(24).toString('hex');
        await tx.requestForQuotationSupplier.update({ where: { id: supplierRow.id }, data: { status: 'SENT', sentAt: new Date(), deliveredAt: new Date(), portalToken: token } });
        await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'PROCUREMENT_RFQ_EMAIL', payload: { rfqId: rfq.id, supplierId: supplierRow.supplierId, to: recipient, token } } });
      }
      const updated = await tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: 'SENT', submittedAt: new Date(), sentAt: new Date() } });
      await tx.procurementAuditEvent.create({ data: { companyId: rfq.companyId, rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'SUBMITTED_AND_SENT', actorId: user(req).id, before: { status: rfq.status }, after: { status: 'SENT', suppliers: rfq.suppliers.length } } });
      return updated;
    });
    return success(res, result, 'RFQ submitted and supplier emails queued');
  } catch (e: any) { return error(res, e.message || 'Could not submit procurement case', 400); }
}

async function relatedSalesOrders(po: any) {
  const references = new Set<string>();
  const mr = po.materialRequest;
  if (mr?.sourceDocumentType === 'SALES_ORDER' && mr.sourceDocumentId) references.add(mr.sourceDocumentId);
  for (const item of mr?.items || []) {
    if (item.sourceDocumentType === 'SALES_ORDER' && item.sourceDocumentId) references.add(item.sourceDocumentId);
  }
  if (!references.size) return [];
  return prisma.salesOrder.findMany({
    where: { id: { in: [...references] } },
    include: { customer: true, items: { include: { product: true } } },
  });
}

export async function getPurchaseOrderWorkspace(req: Request, res: Response) {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        materialRequest: { include: { items: true } },
        supplierQuotation: true,
        items: {
          include: {
            product: true,
            deliverySchedules: true,
            receiptItems: { include: { purchaseReceipt: true, warehouse: true } },
          },
        },
        receipts: { include: { items: { include: { product: true, warehouse: true } } }, orderBy: { postingDate: 'desc' } },
        invoices: { include: { purchaseReceipt: true, items: { include: { product: true } } }, orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { date: 'desc' } },
        communications: { orderBy: { sentAt: 'desc' } },
        deliverySchedules: { orderBy: { scheduledDate: 'asc' } },
      },
    });
    if (!po) return error(res, 'Purchase order not found', 404);

    const now = new Date();
    const lines = po.items.map((item: any) => {
      const orderedQty = number(item.quantity);
      const arrivedQty = number(item.receivedQty);
      const acceptedQty = number(item.acceptedQty);
      const rejectedQty = number(item.rejectedQty);
      const shortClosedQty = number(item.shortClosedQty);
      const returnedQty = item.receiptItems.reduce((sum: number, receiptItem: any) => sum + number(receiptItem.returnedQty), 0);
      const remainingQty = Math.max(0, orderedQty - acceptedQty - shortClosedQty);
      const outstandingSchedule = item.deliverySchedules.find((schedule: any) => number(schedule.quantity) > number(schedule.receivedQty));
      const promisedDate = item.expectedDate || outstandingSchedule?.scheduledDate || po.expectedDate;
      const overdue = remainingQty > 0 && promisedDate && new Date(promisedDate) < now;
      const movements = item.receiptItems.map((receiptItem: any) => ({
        id: receiptItem.id,
        receiptId: receiptItem.purchaseReceiptId,
        receiptNo: receiptItem.purchaseReceipt.receiptNo,
        postingDate: receiptItem.purchaseReceipt.postingDate,
        status: receiptItem.purchaseReceipt.status,
        warehouse: receiptItem.warehouse,
        arrivedQty: number(receiptItem.receivedQty),
        acceptedQty: number(receiptItem.acceptedQty),
        rejectedQty: number(receiptItem.rejectedQty),
        returnedQty: number(receiptItem.returnedQty),
      }));
      return { ...item, orderedQty, arrivedQty, acceptedQty, rejectedQty, returnedQty, shortClosedQty, remainingQty, promisedDate, overdue, status: remainingQty <= 0 ? 'RECEIVED' : overdue ? 'OVERDUE' : acceptedQty > 0 ? 'PARTIALLY_RECEIVED' : 'NOT_RECEIVED', movements };
    });
    const totals = lines.reduce((value: any, line: any) => ({
      orderedQty: value.orderedQty + line.orderedQty,
      arrivedQty: value.arrivedQty + line.arrivedQty,
      acceptedQty: value.acceptedQty + line.acceptedQty,
      rejectedQty: value.rejectedQty + line.rejectedQty,
      returnedQty: value.returnedQty + line.returnedQty,
      remainingQty: value.remainingQty + line.remainingQty,
    }), { orderedQty: 0, arrivedQty: 0, acceptedQty: 0, rejectedQty: 0, returnedQty: 0, remainingQty: 0 });
    const salesOrders = await relatedSalesOrders(po);
    const alerts = lines.filter((line: any) => line.overdue).map((line: any) => ({ type: 'OVERDUE', severity: 'HIGH', purchaseOrderItemId: line.id, productName: line.product.name, remainingQty: line.remainingQty, promisedDate: line.promisedDate, message: `${line.product.name}: ${line.remainingQty} ${line.uom || ''} overdue from ${po.supplier.name}` }));
    // Collect payments: directly linked to PO + linked through invoices
    const directPayments = (po as any).payments || [];
    const invoiceIds = ((po as any).invoices || []).map((inv: any) => inv.id);
    const invoicePayments = invoiceIds.length ? await prisma.supplierPayment.findMany({ where: { purchaseInvoiceId: { in: invoiceIds }, id: { notIn: directPayments.map((p: any) => p.id) } }, orderBy: { date: 'desc' } }) : [];
    const allPayments = [...directPayments, ...invoicePayments].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return success(res, { purchaseOrder: po, lines, totals, receipts: po.receipts, invoices: (po as any).invoices || [], payments: allPayments, communications: po.communications, relatedSalesOrders: salesOrders, alerts });
  } catch (e: any) { return error(res, e.message || 'Could not load purchase order workspace', 400); }
}

export async function updatePurchaseOrderCommitment(req: Request, res: Response) {
  try {
    const lines = Array.isArray(req.body.items) ? req.body.items : [];
    const row = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!po) throw new Error('Purchase order not found');
      for (const line of lines) {
        if (!po.items.some((item) => item.id === line.purchaseOrderItemId)) throw new Error('Invalid purchase-order line');
        await tx.purchaseOrderItem.update({ where: { id: line.purchaseOrderItemId }, data: { expectedDate: line.expectedDate ? new Date(line.expectedDate) : null } });
      }
      const updated = await tx.purchaseOrder.update({ where: { id: po.id }, data: { expectedDate: req.body.expectedDate ? new Date(req.body.expectedDate) : po.expectedDate, estimatedArrivalAt: req.body.estimatedArrivalAt ? new Date(req.body.estimatedArrivalAt) : po.estimatedArrivalAt, delayReason: req.body.delayReason ?? po.delayReason } });
      await tx.procurementAuditEvent.create({ data: { companyId: po.companyId, rfqId: po.rfqId, entityType: 'PURCHASE_ORDER', entityId: po.id, action: 'DELIVERY_COMMITMENT_UPDATED', actorId: user(req).id, after: req.body } });
      return updated;
    });
    return success(res, row, 'Supplier delivery commitment updated');
  } catch (e: any) { return error(res, e.message || 'Could not update commitment', 400); }
}

export async function communicatePurchaseOrderDelay(req: Request, res: Response) {
  try {
    const target = String(req.body.target || 'SUPPLIER').toUpperCase();
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { supplier: true, materialRequest: { include: { items: true } } } });
    if (!po) return error(res, 'Purchase order not found', 404);
    const subject = String(req.body.subject || `Delivery update for ${po.orderNo}`).trim();
    const message = String(req.body.message || '').trim();
    if (!message) return error(res, 'Message is required', 400);
    if (target === 'SUPPLIER') {
      const recipient = String(req.body.recipient || po.supplier.email || '').trim();
      if (!recipient) return error(res, 'Supplier email is required', 400);
      const communication = await prisma.$transaction(async (tx) => {
        const created = await tx.supplierCommunicationLog.create({ data: { companyId: po.companyId, supplierId: po.supplierId, purchaseOrderId: po.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'DELIVERY_FOLLOW_UP', recipient, status: 'QUEUED', queuedAt: new Date(), subject, message, createdById: user(req).id } });
        await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'PROCUREMENT_FOLLOWUP_EMAIL', payload: { communicationId: created.id, to: recipient } } });
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { lastFollowUpAt: new Date(), delayReason: req.body.delayReason || po.delayReason } });
        return created;
      });
      return success(res, communication, 'Supplier email queued');
    }
    if (target !== 'CUSTOMER') return error(res, 'Target must be SUPPLIER or CUSTOMER', 400);
    const salesOrders = await relatedSalesOrders(po);
    const order = salesOrders.find((candidate: any) => candidate.id === req.body.salesOrderId) || salesOrders[0];
    if (!order) return error(res, 'This purchase order is not linked to a customer sales order', 400);
    const recipient = String(req.body.recipient || order.customer.email || '').trim();
    if (!recipient) return error(res, 'Customer email is required', 400);
    const communication = await prisma.$transaction(async (tx) => {
      const created = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'SUPPLIER_DELAY', recipient, subject, message, status: 'QUEUED', createdById: user(req).id } });
      await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: created.id } } });
      await tx.procurementAuditEvent.create({ data: { companyId: po.companyId, rfqId: po.rfqId, entityType: 'PURCHASE_ORDER', entityId: po.id, action: 'CUSTOMER_DELAY_EMAIL_QUEUED', actorId: user(req).id, after: { salesOrderId: order.id, recipient, subject } } });
      return created;
    });
    return success(res, communication, 'Customer delay email queued');
  } catch (e: any) { return error(res, e.message || 'Could not queue communication', 400); }
}

export async function getProcurementCase(req: Request, res: Response) {
  try {
    const rfq = await prisma.requestForQuotation.findUnique({
      where: { id: req.params.id },
      include: {
        materialRequest: { include: { items: { include: { product: true } } } },
        items: { include: { product: true } },
        suppliers: { include: { supplier: true } },
        supplierQuotations: { include: { supplier: true, items: { include: { product: true } }, revisions: true, purchaseOrders: true }, orderBy: [{ supplierId: 'asc' }, { revisionNo: 'asc' }] },
        purchaseOrders: { include: { supplier: true, items: { include: { product: true } }, receipts: { include: { items: { include: { product: true, warehouse: true } } } }, invoices: true, communications: true }, orderBy: { createdAt: 'asc' } },
        communications: { include: { supplierQuotation: true, purchaseOrder: true }, orderBy: { sentAt: 'desc' } },
        auditEvents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!rfq) return error(res, 'Procurement case not found', 404);
    const quotes = rfq.supplierQuotations;
    const orders = rfq.purchaseOrders;
    const receipts = orders.flatMap((order: any) => order.receipts);
    const stage = orders.some((order: any) => order.status === 'RECEIVED') && orders.every((order: any) => ['RECEIVED', 'CANCELLED'].includes(order.status)) ? 'COMPLETED'
      : receipts.some((receipt: any) => receipt.status === 'SUBMITTED') ? 'RECEIVING'
      : orders.length ? 'ORDERED'
      : quotes.some((quote: any) => quote.status === 'SELECTED') ? 'SELECTED'
      : quotes.length ? 'QUOTATIONS'
      : rfq.status === 'SENT' ? 'AWAITING_QUOTES' : 'RFQ_DRAFT';
    const totals = orders.flatMap((order: any) => order.items).reduce((sum: any, item: any) => ({ ordered: sum.ordered + number(item.quantity), accepted: sum.accepted + number(item.acceptedQty), rejected: sum.rejected + number(item.rejectedQty), remaining: sum.remaining + Math.max(0, number(item.quantity) - number(item.acceptedQty) - number(item.shortClosedQty)) }), { ordered: 0, accepted: 0, rejected: 0, remaining: 0 });
    return success(res, { rfq, stage, quotes, orders, receipts, communications: rfq.communications, auditHistory: rfq.auditEvents, totals });
  } catch (e: any) { return error(res, e.message || 'Could not load procurement case', 400); }
}

export async function updateSupplierQuotationLifecycle(req: Request, res: Response) {
  try {
    const action = String(req.params.action || '').toLowerCase();
    const result = await prisma.$transaction(async (tx) => {
      const quote = await tx.supplierQuotation.findUnique({ where: { id: req.params.id } });
      if (!quote) throw new Error('Supplier quotation not found');
      let status: any;
      if (action === 'submit') {
        if (quote.status !== 'DRAFT') throw new Error('Only a draft supplier quotation can be submitted');
        status = 'SUBMITTED';
      } else if (action === 'select') {
        if (!['SUBMITTED', 'SELECTED'].includes(quote.status)) throw new Error('Submit the supplier quotation before selecting it');
        status = 'SELECTED';
      } else if (action === 'reject') {
        if (['SELECTED', 'CANCELLED'].includes(quote.status)) throw new Error('A selected or cancelled quotation cannot be rejected');
        status = 'REJECTED';
      } else throw new Error('Unsupported quotation action');
      const updated = await tx.supplierQuotation.update({ where: { id: quote.id }, data: { status, selected: status === 'SELECTED' } });
      if (quote.rfqId) {
        if (status === 'SUBMITTED') await tx.requestForQuotation.update({ where: { id: quote.rfqId }, data: { status: 'QUOTED' } });
        await tx.procurementAuditEvent.create({ data: { companyId: quote.companyId, rfqId: quote.rfqId, entityType: 'SUPPLIER_QUOTATION', entityId: quote.id, action: `QUOTATION_${status}`, actorId: user(req).id, before: { status: quote.status }, after: { status } } });
      }
      return updated;
    });
    return success(res, result, `Supplier quotation ${action} completed`);
  } catch (e: any) { return error(res, e.message || 'Could not update supplier quotation', 400); }
}

export async function addProcurementCaseCommunication(req: Request, res: Response) {
  try {
    const rfq = await prisma.requestForQuotation.findUnique({ where: { id: req.params.id }, include: { suppliers: { include: { supplier: true } } } });
    if (!rfq) return error(res, 'Procurement case not found', 404);
    const message = String(req.body.message || '').trim();
    if (!message) return error(res, 'Communication message is required', 400);
    const channel = String(req.body.channel || 'NOTE').toUpperCase() as any;
    const direction = String(req.body.direction || 'OUTBOUND').toUpperCase() as any;
    const supplier = rfq.suppliers.find((row: any) => row.supplierId === req.body.supplierId);
    const recipient = String(req.body.recipient || supplier?.email || supplier?.supplier.email || '').trim();
    const shouldSend = Boolean(req.body.send) && channel === 'EMAIL' && direction === 'OUTBOUND';
    if (shouldSend && !recipient) return error(res, 'Supplier email is required', 400);
    const communication = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierCommunicationLog.create({ data: { companyId: rfq.companyId, rfqId: rfq.id, supplierId: req.body.supplierId || undefined, supplierQuotationId: req.body.supplierQuotationId || undefined, purchaseOrderId: req.body.purchaseOrderId || undefined, channel, direction, kind: req.body.kind || 'NEGOTIATION', recipient: recipient || undefined, subject: req.body.subject || undefined, message, status: shouldSend ? 'QUEUED' : 'LOGGED', queuedAt: shouldSend ? new Date() : undefined, sentAt: new Date(), createdById: user(req).id } });
      if (shouldSend) await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'PROCUREMENT_FOLLOWUP_EMAIL', payload: { communicationId: created.id, to: recipient } } });
      await tx.procurementAuditEvent.create({ data: { companyId: rfq.companyId, rfqId: rfq.id, entityType: 'COMMUNICATION', entityId: created.id, action: shouldSend ? 'EMAIL_QUEUED' : 'COMMUNICATION_LOGGED', actorId: user(req).id, after: { channel, direction, supplierId: req.body.supplierId, recipient, kind: req.body.kind || 'NEGOTIATION' } } });
      return created;
    });
    return success(res, communication, shouldSend ? 'Supplier email queued and recorded' : 'Communication recorded', 201);
  } catch (e: any) { return error(res, e.message || 'Could not record communication', 400); }
}

export async function getSupplierCommunicationWorkspace(req: Request, res: Response) {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.supplierId } });
    if (!supplier) return error(res, 'Supplier not found', 404);
    const [communications, purchaseOrders, quotations, invitations, receipts] = await Promise.all([
      prisma.supplierCommunicationLog.findMany({ where: { supplierId: supplier.id }, include: { rfq: true, supplierQuotation: true, purchaseOrder: true }, orderBy: { sentAt: 'desc' }, take: 300 }),
      prisma.purchaseOrder.findMany({ where: { supplierId: supplier.id }, select: { id: true, orderNo: true, status: true, expectedDate: true, receivedPercent: true, total: true, currency: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.supplierQuotation.findMany({ where: { supplierId: supplier.id }, select: { id: true, rfqId: true, quotationNo: true, revisionNo: true, status: true, total: true, date: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.requestForQuotationSupplier.findMany({ where: { supplierId: supplier.id }, include: { rfq: true }, orderBy: { rfq: { createdAt: 'desc' } }, take: 100 }),
      prisma.purchaseReceipt.findMany({ where: { supplierId: supplier.id }, select: { id: true, receiptNo: true, purchaseOrderId: true, status: true, postingDate: true, acceptedQty: true, rejectedQty: true }, orderBy: { postingDate: 'desc' }, take: 100 }),
    ]);
    const stats = { total: communications.length, outbound: communications.filter(row => row.direction === 'OUTBOUND').length, inbound: communications.filter(row => row.direction === 'INBOUND').length, failed: communications.filter(row => row.status === 'FAILED').length, unreadReplies: 0 };
    return success(res, { supplier, communications, purchaseOrders, quotations, invitations, receipts, stats });
  } catch (e: any) { return error(res, e.message || 'Could not load supplier communication workspace', 400); }
}

export async function createSupplierWorkspaceCommunication(req: Request, res: Response) {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.supplierId } });
    if (!supplier) return error(res, 'Supplier not found', 404);
    const channel = String(req.body.channel || 'EMAIL').toUpperCase() as any;
    const direction = String(req.body.direction || 'OUTBOUND').toUpperCase() as any;
    if (!['EMAIL', 'PHONE', 'PORTAL', 'NOTE'].includes(channel)) return error(res, 'Invalid communication channel', 400);
    if (!['INBOUND', 'OUTBOUND'].includes(direction)) return error(res, 'Invalid communication direction', 400);
    const message = String(req.body.message || '').trim();
    if (!message) return error(res, 'Message is required', 400);
    const recipient = String(req.body.recipient || supplier.email || '').trim();
    const send = Boolean(req.body.send) && channel === 'EMAIL' && direction === 'OUTBOUND';
    if (send && !recipient) return error(res, 'Supplier email is required', 400);
    const communication = await prisma.$transaction(async tx => {
      const created = await tx.supplierCommunicationLog.create({ data: { companyId: supplier.companyId, supplierId: supplier.id, rfqId: req.body.rfqId || undefined, supplierQuotationId: req.body.supplierQuotationId || undefined, purchaseOrderId: req.body.purchaseOrderId || undefined, channel, direction, kind: req.body.kind || 'GENERAL', recipient: recipient || undefined, subject: req.body.subject || undefined, message, status: send ? 'QUEUED' : 'LOGGED', queuedAt: send ? new Date() : undefined, sentAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(), createdById: user(req).id } });
      if (send) await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'PROCUREMENT_FOLLOWUP_EMAIL', payload: { communicationId: created.id, to: recipient } } });
      await tx.procurementAuditEvent.create({ data: { companyId: supplier.companyId, rfqId: req.body.rfqId || undefined, entityType: 'SUPPLIER_COMMUNICATION', entityId: created.id, action: send ? 'EMAIL_QUEUED' : `${direction}_${channel}_LOGGED`, actorId: user(req).id, after: { supplierId: supplier.id, kind: req.body.kind || 'GENERAL', recipient, purchaseOrderId: req.body.purchaseOrderId } } });
      return created;
    });
    return success(res, communication, send ? 'Supplier email queued and recorded' : 'Supplier communication recorded', 201);
  } catch (e: any) { return error(res, e.message || 'Could not record supplier communication', 400); }
}

export async function retrySupplierCommunication(req: Request, res: Response) {
  try {
    const communication = await prisma.$transaction(async tx => {
      const existing = await tx.supplierCommunicationLog.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Communication not found');
      if (existing.channel !== 'EMAIL' || existing.direction !== 'OUTBOUND') throw new Error('Only outbound email can be retried');
      if (!existing.recipient) throw new Error('Communication recipient is missing');
      const updated = await tx.supplierCommunicationLog.update({ where: { id: existing.id }, data: { status: 'QUEUED', queuedAt: new Date(), failedAt: null, failureReason: null } });
      await tx.backgroundJob.create({ data: { tenantId: user(req).tenantId, type: 'PROCUREMENT_FOLLOWUP_EMAIL', payload: { communicationId: existing.id, to: existing.recipient } } });
      return updated;
    });
    return success(res, communication, 'Supplier email queued for retry');
  } catch (e: any) { return error(res, e.message || 'Could not retry supplier email', 400); }
}
