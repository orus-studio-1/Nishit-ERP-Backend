import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { error, success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generatePONo } from '../../utils/generate';
import { documentTotals, nextNo } from '../../services/procurement/procurement.service';
import { runThreeWayMatch } from '../../services/procurement/matching.service';
import { postStockLedger } from '../../services/inventory/stockLedger.service';

const D = Prisma.Decimal;
const actor = (req: Request) => (req as any).user || {};
const companyId = (req: Request) => actor(req).companyId || undefined;
const tenantId = (req: Request) => actor(req).tenantId;
const code = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const audit = (tx: any, req: Request, data: any) => tx.procurementAuditEvent.create({ data: { companyId: companyId(req), actorId: actor(req).id, ...data } });

async function approval(tx: any, req: Request, documentType: string, documentId: string) {
  if (!tenantId(req)) return undefined;
  const rule = await tx.approvalRule.findFirst({ where: { tenantId: tenantId(req), documentType, isActive: true }, orderBy: { priority: 'asc' } });
  if (!rule) return undefined;
  const steps = Array.isArray(rule.steps) ? rule.steps as any[] : [];
  return tx.approvalInstance.create({ data: { tenantId: tenantId(req), companyId: companyId(req), documentType, documentId, requestedBy: actor(req).id, ruleId: rule.id, actions: { create: steps.map((step, index) => ({ tenantId: tenantId(req), sequence: step.sequence || index + 1, approverType: step.approverType || 'USER', approverId: step.approverId })) } } });
}

export async function materialRequestSourcing(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    const result = await prisma.$transaction(async tx => {
      const mr = await tx.materialRequest.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
      if (!mr) throw new Error('Material request not found');
      if (operation === 'approve') { if (mr.status !== 'SUBMITTED') throw new Error('Only submitted requests can be approved'); const instance = mr.approvalInstanceId ? await tx.approvalInstance.findUnique({ where: { id: mr.approvalInstanceId } }) : null; if (instance && instance.status !== 'APPROVED') throw new Error('Platform approval is pending'); return tx.materialRequest.update({ where: { id: mr.id }, data: { approvedAt: new Date() } }); }
      const selected = new Map<string, Prisma.Decimal>((req.body.items || []).map((i: any) => [String(i.id || i.materialRequestItemId), new D(i.quantity)]));
      if (!selected.size) throw new Error('Select material-request lines and quantities');
      if (operation === 'create-rfq') {
        const items = mr.items.flatMap(item => { const qty = selected.get(item.id); if (!qty) return []; const open = item.quantity.minus(item.rfqQty).minus(item.orderedQty).minus(item.transferredQty); if (qty.gt(open)) throw new Error('RFQ quantity exceeds unsourced demand'); return [{ item, qty }]; });
        const rfq = await tx.requestForQuotation.create({ data: { rfqNo: await nextNo('requestForQuotation', 'rfqNo', 'RFQ', tx), companyId: mr.companyId, materialRequestId: mr.id, validUntil: req.body.validUntil ? new Date(req.body.validUntil) : undefined, terms: req.body.terms, message: req.body.message, items: { create: items.map(({ item, qty }) => ({ productId: item.productId, quantity: qty, uom: item.uom, stockUom: item.stockUom, conversionFactor: item.conversionFactor, description: item.description, requiredBy: item.requiredBy })) }, suppliers: { create: (req.body.supplierIds || []).map((supplierId: string) => ({ supplierId })) } }, include: { items: true, suppliers: true } });
        for (const { item, qty } of items) await tx.materialRequestItem.update({ where: { id: item.id }, data: { rfqQty: { increment: qty } } });
        await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'CREATED_FROM_MATERIAL_REQUEST', after: { selectedItems: req.body.items } }); return rfq;
      }
      if (operation === 'stock-transfer') {
        const transfer = await tx.stockTransferOrder.create({ data: { transferNo: code('TO'), companyId: mr.companyId, sourceWarehouseId: req.body.sourceWarehouseId, destinationWarehouseId: req.body.destinationWarehouseId, transitWarehouseId: req.body.transitWarehouseId, crossPlant: Boolean(req.body.transitWarehouseId), notes: `Material request ${mr.requestNo}`, items: { create: mr.items.flatMap(item => { const qty = selected.get(item.id); return qty ? [{ productId: item.productId, quantity: qty, valuationRate: item.product.costPrice }] : []; }) } } });
        for (const item of mr.items) { const qty = selected.get(item.id); if (qty) await tx.materialRequestItem.update({ where: { id: item.id }, data: { transferredQty: { increment: qty } } }); } return transfer;
      }
      throw new Error('Unsupported sourcing operation');
    }); return success(res, result, `Material request ${operation} completed`, 201);
  } catch (e: any) { return error(res, e.message || 'Sourcing failed', 400); }
}

export async function rfqOperation(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    const row = await prisma.$transaction(async tx => {
      const rfq = await tx.requestForQuotation.findUnique({ where: { id: req.params.id }, include: { suppliers: { include: { supplier: true } }, items: true } });
      if (!rfq) throw new Error('RFQ not found');
      if (operation === 'submit') { if (rfq.status !== 'DRAFT') throw new Error('Only draft RFQs can be submitted'); await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'SUBMIT', before: { status: rfq.status }, after: { status: 'DRAFT', submitted: true } }); return tx.requestForQuotation.update({ where: { id: rfq.id }, data: { submittedAt: new Date() } }); }
      if (operation === 'send') {
        if (!rfq.submittedAt) throw new Error('Submit RFQ before sending');
        for (const supplierRow of rfq.suppliers) { const token = supplierRow.portalToken || randomBytes(24).toString('hex'); await tx.requestForQuotationSupplier.update({ where: { id: supplierRow.id }, data: { status: 'SENT', sentAt: new Date(), deliveredAt: new Date(), portalToken: token } }); await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'PROCUREMENT_RFQ_EMAIL', payload: { rfqId: rfq.id, supplierId: supplierRow.supplierId, to: supplierRow.email || supplierRow.supplier.email, token } } }); }
        await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'SEND', after: { suppliers: rfq.suppliers.length } }); return tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: 'SENT', sentAt: new Date() } });
      }
      if (operation === 'cancel') { await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'CANCEL', message: req.body.reason }); return tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: 'CANCELLED', closedAt: new Date() } }); }
      if (operation === 'close') return tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      throw new Error('Unsupported RFQ operation');
    }); return success(res, row, `RFQ ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'RFQ operation failed', 400); }
}

export async function inviteSupplierToRfq(req: Request, res: Response) {
  try {
    const { supplierId, email } = req.body;
    if (!supplierId) return error(res, 'Supplier is required', 400);
    const row = await prisma.$transaction(async tx => {
      const rfq = await tx.requestForQuotation.findUnique({ where: { id: req.params.id } });
      if (!rfq) throw new Error('RFQ not found');
      if (rfq.status === 'CANCELLED' || rfq.status === 'CLOSED') throw new Error('Cannot invite suppliers to a cancelled or closed RFQ');
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new Error('Supplier not found');
      const existing = await tx.requestForQuotationSupplier.findFirst({ where: { rfqId: rfq.id, supplierId } });
      if (existing) throw new Error('This supplier is already invited to the RFQ');
      const recipient = email || supplier.email;
      // If RFQ is already SENT, immediately queue email and mark as SENT
      const alreadySent = rfq.status === 'SENT';
      const token = alreadySent ? randomBytes(24).toString('hex') : undefined;
      const invited = await tx.requestForQuotationSupplier.create({
        data: {
          rfqId: rfq.id,
          supplierId,
          email: recipient || undefined,
          ...(alreadySent ? { status: 'SENT', sentAt: new Date(), deliveredAt: new Date(), portalToken: token } : {}),
        },
        include: { supplier: true },
      });
      if (alreadySent && recipient) {
        await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'PROCUREMENT_RFQ_EMAIL', payload: { rfqId: rfq.id, supplierId, to: recipient, token } } });
      }
      await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'SUPPLIER_INVITED', after: { supplierId, supplierName: supplier.name, emailQueued: alreadySent } });
      return invited;
    });
    return success(res, row, 'Supplier invited to RFQ', 201);
  } catch (e: any) { return error(res, e.message || 'Failed to invite supplier', 400); }
}


export async function removeRfqSupplier(req: Request, res: Response) {
  try {
    const row = await prisma.$transaction(async tx => {
      const supplierRow = await tx.requestForQuotationSupplier.findUnique({ where: { id: req.params.supplierId }, include: { rfq: true } });
      if (!supplierRow) throw new Error('Supplier not found on this RFQ');
      if (supplierRow.status === 'SENT' || supplierRow.status === 'RESPONDED') throw new Error('Cannot remove a supplier who has already been contacted or responded');
      await audit(tx, req, { rfqId: supplierRow.rfqId, entityType: 'RFQ', entityId: supplierRow.rfqId, action: 'SUPPLIER_REMOVED', after: { supplierId: supplierRow.supplierId } });
      return tx.requestForQuotationSupplier.delete({ where: { id: req.params.supplierId } });
    });
    return success(res, row, 'Supplier removed from RFQ');
  } catch (e: any) { return error(res, e.message || 'Failed to remove supplier', 400); }
}

export async function acknowledgeRfq(req: Request, res: Response) {
  try { const supplier = await prisma.$transaction(async tx => { const existing = await tx.requestForQuotationSupplier.findUnique({ where: { portalToken: req.params.token }, include: { rfq: true, supplier: true } }); if (!existing) throw new Error('Invalid RFQ portal token'); const status = req.body.accepted === false ? 'DECLINED' : 'RESPONDED'; const updated = await tx.requestForQuotationSupplier.update({ where: { id: existing.id }, data: { status, acknowledgedAt: new Date(), respondedAt: new Date(), acknowledgement: req.body.message } }); await tx.procurementAuditEvent.create({ data: { companyId: existing.rfq.companyId, rfqId: existing.rfqId, entityType: 'RFQ', entityId: existing.rfqId, action: status === 'DECLINED' ? 'VENDOR_DECLINED' : 'VENDOR_ACKNOWLEDGED', before: { supplierId: existing.supplierId, status: existing.status }, after: { supplierId: existing.supplierId, supplierName: existing.supplier.name, status, message: req.body.message }, message: `${existing.supplier.name} ${status === 'DECLINED' ? 'declined' : 'acknowledged'} RFQ ${existing.rfq.rfqNo}` } }); return updated; }); return success(res, supplier, 'RFQ acknowledgement recorded'); }
  catch { return error(res, 'Invalid RFQ portal token', 404); }
}

export async function acknowledgePurchaseOrder(req: Request, res: Response) {
  try { const po = await prisma.$transaction(async tx => { const existing = await tx.purchaseOrder.findUnique({ where: { publicToken: req.params.token }, include: { supplier: true } }); if (!existing) throw new Error('Invalid purchase-order token'); const status = req.body.accepted === false ? 'CANCELLED' : 'CONFIRMED'; const updated = await tx.purchaseOrder.update({ where: { id: existing.id }, data: { acknowledgedAt: new Date(), vendorAcknowledgement: req.body.message, status } }); await tx.procurementAuditEvent.create({ data: { companyId: existing.companyId, rfqId: existing.rfqId, entityType: 'PURCHASE_ORDER', entityId: existing.id, action: status === 'CANCELLED' ? 'VENDOR_DECLINED' : 'VENDOR_ACKNOWLEDGED', before: { status: existing.status }, after: { status, supplierId: existing.supplierId, supplierName: existing.supplier.name, message: req.body.message }, message: `${existing.supplier.name} ${status === 'CANCELLED' ? 'declined' : 'acknowledged'} purchase order ${existing.orderNo}` } }); return updated; }); return success(res, po, 'Purchase order acknowledgement recorded'); }
  catch { return error(res, 'Invalid purchase-order token', 404); }
}

export async function recordPurchaseDispatch(req: Request, res: Response) {
  try {
    const trackingReference = String(req.body.trackingReference || '').trim();
    if (!trackingReference) return error(res, 'Tracking / LR reference is required', 400);
    const row = await prisma.$transaction(async tx => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id } });
      if (!po || !['SENT', 'CONFIRMED', 'RECEIVING'].includes(po.status)) throw new Error('A sent or confirmed purchase order is required');
      const updated = await tx.purchaseOrder.update({ where: { id: po.id }, data: { dispatchedAt: req.body.dispatchedAt ? new Date(req.body.dispatchedAt) : new Date(), carrier: req.body.carrier || undefined, trackingReference, estimatedArrivalAt: req.body.estimatedArrivalAt ? new Date(req.body.estimatedArrivalAt) : undefined, delayReason: null } });
      await tx.supplierCommunicationLog.create({ data: { companyId: po.companyId, supplierId: po.supplierId, purchaseOrderId: po.id, channel: 'PORTAL', direction: 'INBOUND', subject: `Dispatch ${po.orderNo}`, message: `Dispatched via ${req.body.carrier || 'carrier'}; tracking ${trackingReference}${req.body.estimatedArrivalAt ? `; ETA ${req.body.estimatedArrivalAt}` : ''}`, createdById: actor(req).id } });
      return updated;
    });
    return success(res, row, 'Goods-in-transit details recorded');
  } catch (e: any) { return error(res, e.message || 'Could not record dispatch', 400); }
}

export async function followUpPurchaseDelay(req: Request, res: Response) {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return error(res, 'Delay reason or follow-up note is required', 400);
    const row = await prisma.$transaction(async tx => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { supplier: true } });
      if (!po || ['DRAFT', 'RECEIVED', 'CANCELLED'].includes(po.status)) throw new Error('An open sent purchase order is required');
      const recipient = req.body.recipient || po.supplier.email;
      if (!recipient) throw new Error('Supplier email is required');
      const communication = await tx.supplierCommunicationLog.create({ data: { companyId: po.companyId, supplierId: po.supplierId, purchaseOrderId: po.id, channel: 'EMAIL', direction: 'OUTBOUND', subject: req.body.subject || `Delivery follow-up ${po.orderNo}`, message: req.body.message || `Please provide an update for delayed purchase order ${po.orderNo}. Recorded reason: ${reason}`, createdById: actor(req).id } });
      await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'PROCUREMENT_FOLLOWUP_EMAIL', payload: { communicationId: communication.id, to: recipient } } });
      return tx.purchaseOrder.update({ where: { id: po.id }, data: { delayReason: reason, lastFollowUpAt: new Date(), estimatedArrivalAt: req.body.estimatedArrivalAt ? new Date(req.body.estimatedArrivalAt) : po.estimatedArrivalAt } });
    });
    return success(res, row, 'Supplier delay follow-up queued');
  } catch (e: any) { return error(res, e.message || 'Could not follow up delayed order', 400); }
}

export async function reviseSupplierQuotation(req: Request, res: Response) {
  try { const row = await prisma.$transaction(async tx => { const source = await tx.supplierQuotation.findUnique({ where: { id: req.params.id }, include: { items: true } }); if (!source) throw new Error('Supplier quotation not found'); return tx.supplierQuotation.create({ data: { quotationNo: `${source.quotationNo}-R${source.revisionNo + 1}`, companyId: source.companyId, rfqId: source.rfqId, supplierId: source.supplierId, revisionNo: source.revisionNo + 1, supersedesId: source.id, date: new Date(), validUntil: req.body.validUntil ? new Date(req.body.validUntil) : source.validUntil, currency: source.currency, exchangeRate: source.exchangeRate, subtotal: source.subtotal, taxAmount: source.taxAmount, shippingAmount: source.shippingAmount, discount: source.discount, total: source.total, terms: source.terms, notes: source.notes, paymentTermsDays: source.paymentTermsDays, leadTimeDays: source.leadTimeDays, vendorRatingSnapshot: source.vendorRatingSnapshot, vendorDocumentDetails: source.vendorDocumentDetails, items: { create: source.items.map(i => ({ productId: i.productId, supplierItemCode: i.supplierItemCode, description: i.description, quantity: i.quantity, uom: i.uom, stockUom: i.stockUom, conversionFactor: i.conversionFactor, rate: i.rate, taxRate: i.taxRate, discount: i.discount, amount: i.amount, deliveryDate: i.deliveryDate, categoryCode: i.categoryCode, hsnCode: i.hsnCode, make: i.make, quantityTolerance: i.quantityTolerance })) } }, include: { items: true } }); }); return success(res, row, 'Supplier quotation revision created', 201); }
  catch (e: any) { return error(res, e.message || 'Revision failed', 400); }
}

export async function comparison(req: Request, res: Response) {
  try { const rfq = await prisma.requestForQuotation.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } }, supplierQuotations: { where: { status: { in: ['SUBMITTED', 'SELECTED'] } }, include: { supplier: true, items: true } } } }); if (!rfq) return error(res, 'RFQ not found', 404); const rows = rfq.items.map(item => ({ rfqItem: item, offers: rfq.supplierQuotations.flatMap(q => q.items.filter(line => line.productId === item.productId).map(line => ({ supplierId: q.supplierId, supplier: q.supplier.name, supplierQuotationId: q.id, supplierQuotationItemId: line.id, rate: line.rate, taxRate: line.taxRate, freight: q.shippingAmount, leadTimeDays: q.leadTimeDays, paymentTermsDays: q.paymentTermsDays, validUntil: q.validUntil, vendorRating: q.vendorRatingSnapshot ?? q.supplier.rating, landedUnitCost: line.rate.mul(new D(1).plus(line.taxRate.div(100))).plus(q.shippingAmount.div(q.items.length || 1)) }))) })); return success(res, { rfq, rows }); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function selectRfqVendors(req: Request, res: Response) {
  try { const result = await prisma.$transaction(async tx => { const rfq = await tx.requestForQuotation.findUnique({ where: { id: req.params.id } }); if (!rfq) throw new Error('RFQ not found'); await tx.rfqItemSelection.deleteMany({ where: { rfqId: rfq.id, approvalStatus: 'PENDING' } }); const rows = await Promise.all((req.body.selections || []).map(async (selection: any) => { const quote = await tx.supplierQuotation.findUnique({ where: { id: selection.supplierQuotationId }, include: { items: true } }); const line = quote?.items.find(i => i.id === selection.supplierQuotationItemId); if (!quote || !line || quote.rfqId !== rfq.id) throw new Error('Invalid quotation selection'); return tx.rfqItemSelection.create({ data: { companyId: rfq.companyId, rfqId: rfq.id, rfqItemId: selection.rfqItemId, productId: line.productId, supplierId: quote.supplierId, supplierQuotationId: quote.id, supplierQuotationItemId: line.id, quantity: new D(selection.quantity || line.quantity), rate: line.rate, selectedById: actor(req).id } }); })); const instance = await approval(tx, req, 'RFQ_VENDOR_SELECTION', rfq.id); await tx.requestForQuotation.update({ where: { id: rfq.id }, data: { selectionStatus: instance ? 'PENDING_APPROVAL' : 'APPROVED', selectionApprovalInstanceId: instance?.id } }); await audit(tx, req, { rfqId: rfq.id, entityType: 'RFQ', entityId: rfq.id, action: 'VENDOR_SELECTION', after: { selections: rows.map(r => r.id), approvalInstanceId: instance?.id } }); return rows; }); return success(res, result, 'Vendor selections saved'); }
  catch (e: any) { return error(res, e.message || 'Selection failed', 400); }
}

export async function generateSelectedPurchaseOrders(req: Request, res: Response) {
  try { const orders = await prisma.$transaction(async tx => { const rfq = await tx.requestForQuotation.findUnique({ where: { id: req.params.id }, include: { selections: true, supplierQuotations: { include: { items: true } } } }); if (!rfq || !rfq.selections.length) throw new Error('Approved vendor selections are required'); if (rfq.selectionApprovalInstanceId) { const instance = await tx.approvalInstance.findUnique({ where: { id: rfq.selectionApprovalInstanceId } }); if (instance?.status !== 'APPROVED') throw new Error('Vendor selection approval is pending'); } const grouped = new Map<string, typeof rfq.selections>(); for (const selection of rfq.selections) grouped.set(selection.supplierId, [...(grouped.get(selection.supplierId) || []), selection]); const docs = []; for (const [supplierId, selections] of grouped) { const quote = rfq.supplierQuotations.find(q => q.id === selections[0].supplierQuotationId)!; const lines = selections.map(selection => { const source = quote.items.find(i => i.id === selection.supplierQuotationItemId)!; return { productId: selection.productId, quantity: Number(selection.quantity), unitPrice: Number(selection.rate), taxRate: Number(source.taxRate), discount: Number(source.discount), total: Number(new D(selection.quantity).mul(selection.rate).mul(new D(1).plus(source.taxRate.div(100)))), uom: source.uom, stockUom: source.stockUom, conversionFactor: source.conversionFactor, supplierItemCode: source.supplierItemCode }; }); const totals = documentTotals(lines); const po = await tx.purchaseOrder.create({ data: { orderNo: `DRAFT-PO-${Date.now()}-${docs.length}`, companyId: rfq.companyId, supplierId, rfqId: rfq.id, supplierQuotationId: quote.id, subtotal: Number(totals.subtotal), taxAmount: Number(totals.taxAmount), shippingAmount: Number(quote.shippingAmount), total: Number(totals.total.plus(quote.shippingAmount)), baseTotal: totals.baseTotal, currency: quote.currency, exchangeRate: quote.exchangeRate, paymentTermsTemplateId: req.body.paymentTermsTemplateId, terms: quote.terms, items: { create: lines } } }); await tx.rfqItemSelection.updateMany({ where: { id: { in: selections.map(s => s.id) } }, data: { approvalStatus: 'APPROVED', purchaseOrderId: po.id } }); docs.push(po); } await tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: 'CLOSED', selectionStatus: 'PO_CREATED', closedAt: new Date() } }); return docs; }); return success(res, orders, 'Purchase orders generated from approved selections', 201); }
  catch (e: any) { return error(res, e.message || 'PO generation failed', 400); }
}

export async function purchaseOrderOperation(req: Request, res: Response) {
  try { const operation = req.params.operation; const row = await prisma.$transaction(async tx => { const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { supplier: true, items: true, receipts: true } }); if (!po) throw new Error('Purchase order not found'); if (operation === 'submit') { if (po.status !== 'DRAFT') throw new Error('Only draft POs can be submitted'); const instance = await approval(tx, req, 'PURCHASE_ORDER', po.id); return tx.purchaseOrder.update({ where: { id: po.id }, data: { orderNo: po.orderNo.startsWith('DRAFT-') ? await generatePONo() : po.orderNo, workflowStatus: instance ? 'DRAFT' : 'SUBMITTED', status: instance ? 'DRAFT' : 'CONFIRMED', approvalInstanceId: instance?.id, submittedAt: new Date() } }); } if (operation === 'approve') { if (!po.approvalInstanceId) throw new Error('No approval request exists'); const instance = await tx.approvalInstance.findUnique({ where: { id: po.approvalInstanceId } }); if (instance?.status !== 'APPROVED') throw new Error('Platform approval is pending'); return tx.purchaseOrder.update({ where: { id: po.id }, data: { workflowStatus: 'SUBMITTED', status: 'CONFIRMED' } }); } if (operation === 'send') { if (po.workflowStatus !== 'SUBMITTED') throw new Error('Approved PO is required'); const token = po.publicToken || randomBytes(24).toString('hex'); await tx.backgroundJob.create({ data: { tenantId: tenantId(req), type: 'PROCUREMENT_PO_EMAIL', payload: { purchaseOrderId: po.id, to: po.supplier.email, token } } }); return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'SENT', sentAt: new Date(), publicToken: token } }); } if (operation === 'acknowledge') return tx.purchaseOrder.update({ where: { id: po.id }, data: { acknowledgedAt: new Date(), vendorAcknowledgement: req.body.message, status: 'CONFIRMED' } }); if (operation === 'amend') { if (!['CANCELLED', 'CONFIRMED', 'SENT'].includes(po.status)) throw new Error('Submitted, acknowledged or cancelled PO required'); return tx.purchaseOrder.create({ data: { orderNo: `DRAFT-PO-A${po.revisionNo + 1}-${Date.now()}`, companyId: po.companyId, supplierId: po.supplierId, materialRequestId: po.materialRequestId, rfqId: po.rfqId, supplierQuotationId: po.supplierQuotationId, date: new Date(), expectedDate: po.expectedDate, subtotal: po.subtotal, taxAmount: po.taxAmount, shippingAmount: po.shippingAmount, discount: po.discount, total: po.total, baseTotal: po.baseTotal, currency: po.currency, exchangeRate: po.exchangeRate, notes: po.notes, terms: po.terms, revisionNo: po.revisionNo + 1, amendedFromId: po.id, branchId: po.branchId, companyGstin: po.companyGstin, supplierGstin: po.supplierGstin, items: { create: po.items.map(i => ({ productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, discount: i.discount, total: i.total, uom: i.uom, stockUom: i.stockUom, conversionFactor: i.conversionFactor, supplierItemCode: i.supplierItemCode, supplierItemName: i.supplierItemName })) } } }); } if (operation === 'close') { const pending = po.items.reduce((sum, i) => sum.plus(new D(i.quantity).minus(i.receivedQty).minus(i.shortClosedQty)), new D(0)); if (pending.gt(0) && !req.body.reason) throw new Error('Short-close reason is required'); if (pending.gt(0)) for (const item of po.items) { const open = new D(item.quantity).minus(item.receivedQty).minus(item.shortClosedQty); if (open.gt(0)) await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { shortClosedQty: { increment: open } } }); } return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED', closedAt: new Date(), shortCloseReason: req.body.reason } }); } if (operation === 'cancel') { if (po.receipts.some(r => r.status === 'SUBMITTED')) throw new Error('Cancel or return submitted receipts before cancelling PO'); return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED', workflowStatus: 'CANCELLED', cancelledAt: new Date() } }); } throw new Error('Unsupported PO operation'); }); return success(res, row, `Purchase order ${operation} completed`); }
  catch (e: any) { return error(res, e.message || 'PO operation failed', 400); }
}

export async function createGateEntry(req: Request, res: Response) {
  try { const po = await prisma.purchaseOrder.findUnique({ where: { id: req.body.purchaseOrderId }, include: { items: true } }); if (!po || !['CONFIRMED', 'SENT', 'RECEIVING'].includes(po.status)) return error(res, 'Confirmed purchase order is required', 400); const arrived = new Map((req.body.items || []).map((i: any) => [i.purchaseOrderItemId, new D(i.arrivedQty)])); const gate = await prisma.gateEntry.create({ data: { gateEntryNo: code('GATE'), companyId: po.companyId, supplierId: po.supplierId, purchaseOrderId: po.id, vehicleNo: req.body.vehicleNo, transporter: req.body.transporter, challanNo: req.body.challanNo, invoiceReference: req.body.invoiceReference, securityNotes: req.body.securityNotes, createdById: actor(req).id, items: { create: po.items.flatMap(item => { const qty: any = arrived.get(item.id); if (!qty) return []; const pending = new D(item.quantity).minus(item.receivedQty); if (qty.gt(pending)) throw new Error('Arrived quantity exceeds pending PO quantity'); return [{ purchaseOrderItemId: item.id, productId: item.productId, expectedQty: pending, arrivedQty: qty, supplierBatchNo: req.body.supplierBatches?.[item.id], serialNumbers: req.body.serialNumbers?.[item.id] || [] }]; }) } }, include: { items: true, purchaseOrder: true, supplier: true } }); return success(res, gate, 'Gate entry created', 201); }
  catch (e: any) { return error(res, e.message || 'Gate entry failed', 400); }
}

export async function validateGateEntry(req: Request, res: Response) {
  try { const updated = await prisma.gateEntry.updateMany({ where: { id: req.params.id, status: 'DRAFT' }, data: { status: 'SUBMITTED', validatedAt: new Date() } }); return updated.count ? success(res, null, 'Gate entry validated') : error(res, 'Draft gate entry not found', 400); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function createGrnFromGate(req: Request, res: Response) {
  try { const receipt = await prisma.$transaction(async tx => { const gate = await tx.gateEntry.findUnique({ where: { id: req.params.id }, include: { items: true, purchaseOrder: { include: { items: { include: { product: true } } } } } }); if (!gate || gate.status !== 'SUBMITTED') throw new Error('Validated gate entry is required'); const settings = await tx.buyingSettings.findFirst() || { overReceiptAllowancePercent: 0 }; const lines = gate.items.map(g => { const poItem = gate.purchaseOrder.items.find(i => i.id === g.purchaseOrderItemId)!; const tolerance = new D(poItem.quantity).mul(settings.overReceiptAllowancePercent || 0).div(100); const max = new D(poItem.quantity).minus(poItem.receivedQty).plus(tolerance); if (g.arrivedQty.gt(max)) throw new Error(`Over-receipt tolerance exceeded for ${poItem.product.sku}`); const inspect = poItem.product.receiptInspectionRequired; return { purchaseOrderItemId: poItem.id, productId: poItem.productId, warehouseId: req.body.warehouseId || poItem.product.defaultWarehouseId, description: poItem.description, receivedQty: g.arrivedQty, acceptedQty: inspect ? new D(0) : g.arrivedQty, rejectedQty: new D(0), rate: poItem.unitPrice, valuationRate: poItem.unitPrice, supplierBatchNo: g.supplierBatchNo, serialNo: g.serialNumbers.join(','), qualityStatus: inspect ? 'PENDING' as const : 'ACCEPTED' as const }; }); const doc = await tx.purchaseReceipt.create({ data: { receiptNo: await nextNo('purchaseReceipt', 'receiptNo', 'GRN', tx), companyId: gate.companyId, supplierId: gate.supplierId, purchaseOrderId: gate.purchaseOrderId, gateEntryId: gate.id, acceptedQty: lines.reduce((s, i) => s.plus(i.acceptedQty), new D(0)), rejectedQty: 0, subtotal: lines.reduce((s, i) => s.plus(i.receivedQty.mul(i.rate)), new D(0)), qcHoldWarehouseId: req.body.qcHoldWarehouseId, rejectedWarehouseId: req.body.rejectedWarehouseId, inspectionCompleted: lines.every(i => i.qualityStatus === 'ACCEPTED'), items: { create: lines } }, include: { items: { include: { product: true } } } }); for (const line of doc.items.filter((i: any) => i.product.receiptInspectionRequired)) await tx.qualityInspection.create({ data: { inspectionNo: code('QI'), companyId: gate.companyId, purchaseReceiptId: doc.id, productId: line.productId, inspectedQty: line.receivedQty } }); return doc; }); return success(res, receipt, 'GRN created from gate entry', 201); }
  catch (e: any) { return error(res, e.message || 'GRN creation failed', 400); }
}

export async function completeInspection(req: Request, res: Response) {
  try { const inspection = await prisma.$transaction(async tx => { const row = await tx.qualityInspection.findUnique({ where: { id: req.params.id }, include: { purchaseReceipt: { include: { items: true } }, product: true } }); if (!row?.purchaseReceipt) throw new Error('Inspection or GRN not found'); const accepted = new D(req.body.acceptedQty || 0), rejected = new D(req.body.rejectedQty || 0), deviation = new D(req.body.deviationQty || 0); if (!accepted.plus(rejected).plus(deviation).eq(row.inspectedQty)) throw new Error('Accepted, rejected and deviation quantities must equal inspected quantity'); if (deviation.gt(0) && !req.body.deviationReason) throw new Error('Deviation reason is required'); const status = rejected.eq(row.inspectedQty) ? 'REJECTED' : rejected.gt(0) || deviation.gt(0) ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED'; await tx.purchaseReceiptItem.updateMany({ where: { purchaseReceiptId: row.purchaseReceiptId!, productId: row.productId! }, data: { acceptedQty: accepted.plus(deviation), rejectedQty: rejected, deviationQty: deviation, qualityStatus: status } }); const updated = await tx.qualityInspection.update({ where: { id: row.id }, data: { status, acceptedQty: accepted.plus(deviation), rejectedQty: rejected, inspectedById: actor(req).id, remarks: req.body.remarks, certificateNo: req.body.certificateNo, certificateUrl: req.body.certificateUrl, deviationReason: req.body.deviationReason, approvedById: deviation.gt(0) ? actor(req).id : undefined } }); const pending = await tx.qualityInspection.count({ where: { purchaseReceiptId: row.purchaseReceiptId!, status: 'PENDING' } }); const totals = await tx.purchaseReceiptItem.aggregate({ where: { purchaseReceiptId: row.purchaseReceiptId! }, _sum: { acceptedQty: true, rejectedQty: true } }); await tx.purchaseReceipt.update({ where: { id: row.purchaseReceiptId! }, data: { inspectionCompleted: pending === 0, deviationApproved: deviation.gt(0) || undefined, acceptedQty: totals._sum.acceptedQty || 0, rejectedQty: totals._sum.rejectedQty || 0 } }); return updated; }); return success(res, inspection, 'Inspection completed'); }
  catch (e: any) { return error(res, e.message || 'Inspection failed', 400); }
}

export async function createPurchaseReturn(req: Request, res: Response) {
  try { const row = await prisma.$transaction(async tx => { const receipt = await tx.purchaseReceipt.findUnique({ where: { id: req.body.purchaseReceiptId }, include: { items: true } }); if (!receipt || receipt.status !== 'SUBMITTED') throw new Error('Submitted GRN is required'); const selected = new Map((req.body.items || []).map((i: any) => [i.purchaseReceiptItemId, new D(i.quantity)])); const items = receipt.items.flatMap(item => { const qty: any = selected.get(item.id); if (!qty) return []; const returnable = item.rejectedQty.plus(item.acceptedQty).minus(item.returnedQty); if (qty.gt(returnable)) throw new Error('Return quantity exceeds available receipt quantity'); if (!item.warehouseId) throw new Error('Receipt warehouse is missing'); return [{ purchaseReceiptItemId: item.id, productId: item.productId, warehouseId: item.warehouseId, quantity: qty, valuationRate: item.valuationRate }]; }); return tx.purchaseReturn.create({ data: { returnNo: code('PRTN'), companyId: receipt.companyId, supplierId: receipt.supplierId, purchaseReceiptId: receipt.id, reason: req.body.reason || 'Return to vendor', items: { create: items } }, include: { items: true } }); }); return success(res, row, 'Purchase return created', 201); }
  catch (e: any) { return error(res, e.message || 'Return creation failed', 400); }
}

export async function submitPurchaseReturn(req: Request, res: Response) {
  try { const row = await prisma.$transaction(async tx => { const ret = await tx.purchaseReturn.findUnique({ where: { id: req.params.id }, include: { items: true } }); if (!ret || ret.status !== 'DRAFT') throw new Error('Draft purchase return required'); for (const item of ret.items) { await postStockLedger(tx, { productId: item.productId, warehouseId: item.warehouseId, actualQty: item.quantity.neg(), rate: item.valuationRate, voucherType: 'PURCHASE_RETURN', voucherId: ret.id, voucherNo: ret.returnNo, postingDate: ret.postingDate, batchId: item.batchId || undefined, serialNoId: item.serialNoId || undefined, remarks: ret.reason }); await tx.purchaseReceiptItem.update({ where: { id: item.purchaseReceiptItemId }, data: { returnedQty: { increment: item.quantity } } }); } return tx.purchaseReturn.update({ where: { id: ret.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } }); }); return success(res, row, 'Purchase return submitted'); }
  catch (e: any) { return error(res, e.message || 'Return posting failed', 400); }
}

export async function runMatch(req: Request, res: Response) { try { return success(res, await runThreeWayMatch(req.params.invoiceId), 'Three-way match completed'); } catch (e: any) { return error(res, e.message || 'Matching failed', 400); } }
export async function approveMatchException(req: Request, res: Response) { try { const match = await prisma.procurementThreeWayMatch.findUnique({ where: { id: req.params.id } }); if (!match || match.status !== 'EXCEPTION') return error(res, 'Match exception not found', 404); const instance = match.approvalInstanceId ? await prisma.approvalInstance.findUnique({ where: { id: match.approvalInstanceId } }) : null; if (instance && instance.status !== 'APPROVED') return error(res, 'Exception approval is pending', 400); await prisma.$transaction([prisma.procurementThreeWayMatch.update({ where: { id: match.id }, data: { status: 'APPROVED_EXCEPTION', approvedById: actor(req).id, approvedAt: new Date() } }), prisma.purchaseInvoice.update({ where: { id: match.purchaseInvoiceId }, data: { matchStatus: 'APPROVED_EXCEPTION', postingBlocked: false } })]); return success(res, null, 'Match exception approved'); } catch (e) { return handlePrismaError(res, e); } }

export async function calculateVendorRatings(_req: Request, res: Response) {
  try { const suppliers = await prisma.supplier.findMany({ where: { isActive: true }, include: { purchaseOrders: { include: { items: true, receipts: { include: { items: true, qualityInspections: true } } } }, rfqSuppliers: true, supplierQuotations: true } }); const results = []; for (const supplier of suppliers) { const pos = supplier.purchaseOrders.filter(po => po.status !== 'CANCELLED'), receipts = pos.flatMap(po => po.receipts), ordered = pos.reduce((s, po) => s + po.items.reduce((n, i) => n + Number(i.quantity), 0), 0), accepted = receipts.reduce((s, r) => s + Number(r.acceptedQty), 0), rejected = receipts.reduce((s, r) => s + Number(r.rejectedQty), 0); const onTime = receipts.length ? receipts.filter(r => { const po = pos.find(p => p.id === r.purchaseOrderId); return !po?.expectedDate || r.postingDate <= po.expectedDate; }).length / receipts.length * 100 : 0; const quality = accepted + rejected ? accepted / (accepted + rejected) * 100 : 100; const responsiveness = supplier.rfqSuppliers.length ? supplier.rfqSuppliers.filter(r => r.respondedAt).length / supplier.rfqSuppliers.length * 100 : 50; const leadAdherence = onTime; const rejectionPpm = accepted + rejected ? rejected / (accepted + rejected) * 1_000_000 : 0; const price = supplier.supplierQuotations.length ? 75 : 50; const weighted = onTime * .25 + quality * .3 + price * .2 + responsiveness * .1 + leadAdherence * .15; const history = await prisma.vendorRatingHistory.create({ data: { companyId: supplier.companyId, supplierId: supplier.id, periodStart: new Date(Date.now() - 90 * 86400000), periodEnd: new Date(), onTimeDelivery: onTime, qualityAcceptance: quality, priceCompetitiveness: price, responsiveness, leadTimeAdherence: leadAdherence, rejectionPpm, weightedRating: weighted, calculation: { ordered, accepted, rejected, receipts: receipts.length } } }); await prisma.supplier.update({ where: { id: supplier.id }, data: { rating: weighted } }); results.push(history); } return success(res, results, 'Vendor ratings recalculated'); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function procurementReport(req: Request, res: Response) {
  try { const type = req.params.type; if (type === 'vendor-rating') return success(res, await prisma.vendorRatingHistory.findMany({ include: { supplier: true }, orderBy: { periodEnd: 'desc' } })); if (type === 'purchase-analysis' || type === 'spend') return success(res, await prisma.purchaseOrder.groupBy({ by: type === 'spend' ? ['supplierId'] : ['status'], where: { status: { not: 'CANCELLED' } }, _sum: { baseTotal: true }, _count: true })); if (type === 'price-trend') return success(res, await prisma.purchaseOrderItem.findMany({ include: { product: true, purchaseOrder: { include: { supplier: true } } }, orderBy: { createdAt: 'desc' }, take: 500 })); if (type === 'pending-grn' || type === 'po-overdue' || type === 'po-ageing') { const now = new Date(); const rows = await prisma.purchaseOrder.findMany({ where: { status: { in: ['CONFIRMED', 'SENT', 'RECEIVING'] }, ...(type === 'po-overdue' ? { expectedDate: { lt: now } } : {}) }, include: { supplier: true, items: true }, orderBy: { date: 'asc' } }); return success(res, rows.map(po => ({ ...po, ageDays: Math.floor((Date.now() - po.date.getTime()) / 86400000), pendingQty: po.items.reduce((s, i) => s.plus(new D(i.quantity).minus(i.receivedQty).minus(i.shortClosedQty)), new D(0)) }))); } if (type === 'gr-ir') return success(res, await prisma.purchaseOrder.findMany({ where: { receivedPercent: { gt: 0 } }, include: { supplier: true, receipts: true, invoices: true } })); if (type === 'rejections') return success(res, await prisma.purchaseReceipt.findMany({ where: { rejectedQty: { gt: 0 } }, include: { supplier: true, items: true } })); if (type === 'msme-overdue') return success(res, await prisma.purchaseInvoice.findMany({ where: { supplier: { msmeRegistered: true }, outstandingAmount: { gt: 0 }, dueDate: { lt: new Date() } }, include: { supplier: true } })); if (type === 'advance-outstanding') return success(res, await prisma.supplierPayment.findMany({ where: { type: 'ADVANCE', status: 'SUBMITTED', unallocatedAmount: { gt: 0 } }, include: { supplier: true, purchaseOrder: true } })); return error(res, 'Unknown procurement report', 404); }
  catch (e) { return handlePrismaError(res, e); }
}
