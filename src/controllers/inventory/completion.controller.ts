import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { error, paginated, success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { postStockLedger, postStockTransfer } from '../../services/inventory/stockLedger.service';

const D = Prisma.Decimal;
const auth = (req: Request) => (req as any).user || {};
const companyId = (req: Request) => auth(req).companyId || undefined;
const tenantId = (req: Request) => auth(req).tenantId || undefined;
const number = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const transferInclude = { sourceWarehouse: true, transitWarehouse: true, destinationWarehouse: true, items: true };
const reconciliationInclude = { warehouse: true, items: true };

export async function barcodeLookup(req: Request, res: Response) {
  try {
    const value = String(req.params.value || '').trim();
    const product = await prisma.product.findFirst({ where: { OR: [{ barcode: value }, { sku: value }, { customerCodes: { some: { customerCode: value } } }, { supplierItems: { some: { supplierItemCode: value } } }] }, include: { unit: true, category: true, stockLevels: { include: { warehouse: true } }, batches: { where: { isActive: true }, orderBy: { expiryDate: 'asc' } }, serialNumbers: { where: { serialNo: value } } } });
    if (product) return success(res, { type: 'PRODUCT', product });
    const serial = await prisma.serialNumber.findFirst({ where: { serialNo: value }, include: { product: true, warehouse: true, ledgerEntries: { orderBy: { postingDate: 'desc' } } } });
    if (serial) return success(res, { type: 'SERIAL', serial });
    const batch = await prisma.batch.findFirst({ where: { OR: [{ batchNo: value }, { supplierBatchNo: value }] }, include: { product: true, warehouse: true, ledgerEntries: { orderBy: { postingDate: 'desc' } } } });
    return batch ? success(res, { type: 'BATCH', batch }) : error(res, 'Barcode, item, batch or serial not found', 404);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function upsertWarehouseRule(req: Request, res: Response) {
  try {
    const productId = req.params.productId, warehouseId = req.body.warehouseId;
    if (!warehouseId) return error(res, 'warehouseId is required', 400);
    const values = { companyId: companyId(req), reorderLevel: new D(req.body.reorderLevel || 0), reorderQty: new D(req.body.reorderQty || 0), safetyStock: new D(req.body.safetyStock || 0), leadTimeDays: Number(req.body.leadTimeDays || 0), minimumOrderQty: new D(req.body.minimumOrderQty || 0), orderMultiple: new D(req.body.orderMultiple || 1), isDefault: Boolean(req.body.isDefault) };
    const row = await prisma.productWarehouseRule.upsert({ where: { productId_warehouseId: { productId, warehouseId } }, update: values, create: { productId, warehouseId, ...values } });
    return success(res, row, 'Warehouse reorder rule saved');
  } catch (e) { return handlePrismaError(res, e); }
}

export async function upsertCustomerItemCode(req: Request, res: Response) {
  try {
    if (!req.body.customerId || !req.body.customerCode) return error(res, 'customerId and customerCode are required', 400);
    const row = await prisma.customerItemCode.upsert({ where: { customerId_productId: { customerId: req.body.customerId, productId: req.params.productId } }, update: { customerCode: req.body.customerCode, description: req.body.description }, create: { companyId: companyId(req), productId: req.params.productId, customerId: req.body.customerId, customerCode: req.body.customerCode, description: req.body.description } });
    return success(res, row, 'Customer item code saved');
  } catch (e) { return handlePrismaError(res, e); }
}

export async function createBatchGenealogy(req: Request, res: Response) {
  try {
    const output = await prisma.batch.findUnique({ where: { id: req.body.outputBatchId } }), input = await prisma.batch.findUnique({ where: { id: req.body.inputBatchId } });
    if (!output || !input) return error(res, 'Input and output batches are required', 400);
    const row = await prisma.batchGenealogy.create({ data: { companyId: companyId(req), outputBatchId: output.id, inputBatchId: input.id, outputProductId: output.productId, inputProductId: input.productId, quantityUsed: new D(req.body.quantityUsed), stockEntryId: req.body.stockEntryId } });
    return success(res, row, 'Batch genealogy recorded', 201);
  } catch (e) { return handlePrismaError(res, e); }
}

export async function createReconciliation(req: Request, res: Response) {
  try {
    if (!req.body.warehouseId) return error(res, 'warehouseId is required', 400);
    const row = await prisma.$transaction(async tx => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: req.body.warehouseId } });
      if (!warehouse || !warehouse.isActive) throw new Error('Active warehouse not found');
      const levels = await tx.stockLevel.findMany({ where: { warehouseId: warehouse.id }, include: { product: true } });
      const reconciliation = await tx.stockReconciliation.create({ data: { reconciliationNo: number('REC'), companyId: companyId(req), warehouseId: warehouse.id, blindCount: Boolean(req.body.blindCount), varianceThreshold: new D(req.body.varianceThreshold || 0), notes: req.body.notes, items: { create: levels.map(level => ({ productId: level.productId, bookQty: level.quantity, valuationRate: level.product.costPrice })) } }, include: reconciliationInclude });
      return reconciliation;
    });
    return success(res, row, 'Stock reconciliation created', 201);
  } catch (e: any) { return error(res, e.message || 'Could not create reconciliation', 400); }
}

export async function listReconciliations(req: Request, res: Response) {
  try { const page = Number(req.query.page) || 1, limit = Number(req.query.limit) || 20; const where: any = { ...(companyId(req) ? { companyId: companyId(req) } : {}), ...(req.query.status ? { status: req.query.status } : {}) }; const [rows, total] = await Promise.all([prisma.stockReconciliation.findMany({ where, include: reconciliationInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.stockReconciliation.count({ where })]); return paginated(res, rows, total, page, limit); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function reconciliationTemplate(req: Request, res: Response) {
  try {
    const row = await prisma.stockReconciliation.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!row) return error(res, 'Reconciliation not found', 404);
    const products = await prisma.product.findMany({ where: { id: { in: row.items.map(i => i.productId) } }, select: { id: true, sku: true, name: true } });
    const map = new Map(products.map(p => [p.id, p]));
    const csv = ['itemId,sku,itemName,bookQty,countedQty,batchId,serialNoId', ...row.items.map(i => { const p = map.get(i.productId); return [i.id, p?.sku, `"${String(p?.name || '').replace(/"/g, '""')}"`, row.blindCount ? '' : i.bookQty, '', i.batchId || '', i.serialNoId || ''].join(','); })].join('\n');
    return success(res, { fileName: `${row.reconciliationNo}.csv`, content: `data:text/csv;base64,${Buffer.from(csv).toString('base64')}` });
  } catch (e) { return handlePrismaError(res, e); }
}

export async function startReconciliation(req: Request, res: Response) {
  try {
    const row = await prisma.$transaction(async tx => {
      const existing = await tx.stockReconciliation.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status !== 'DRAFT') throw new Error('Only a draft reconciliation can start');
      await tx.warehouse.update({ where: { id: existing.warehouseId }, data: { isFrozen: true, frozenAt: new Date(), frozenById: auth(req).id } });
      return tx.stockReconciliation.update({ where: { id: existing.id }, data: { status: 'COUNTING', snapshotAt: new Date(), frozenAt: new Date(), countedById: auth(req).id }, include: reconciliationInclude });
    });
    return success(res, row, 'Warehouse frozen and count started');
  } catch (e: any) { return error(res, e.message || 'Could not start count', 400); }
}

export async function uploadCounts(req: Request, res: Response) {
  try {
    const items = req.body.items || [];
    const row = await prisma.$transaction(async tx => {
      const existing = await tx.stockReconciliation.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!existing || existing.status !== 'COUNTING') throw new Error('Reconciliation is not open for counting');
      for (const input of items) {
        const current = existing.items.find(i => i.id === input.itemId || i.productId === input.productId);
        if (!current) throw new Error('Count row does not belong to this reconciliation');
        const countedQty = new D(input.countedQty);
        if (countedQty.lt(0)) throw new Error('Counted quantity cannot be negative');
        const varianceQty = countedQty.minus(current.bookQty), varianceValue = varianceQty.mul(current.valuationRate);
        await tx.stockReconciliationItem.update({ where: { id: current.id }, data: { countedQty, varianceQty, varianceValue, countNotes: input.notes, countedAt: new Date() } });
      }
      const refreshed = await tx.stockReconciliation.findUnique({ where: { id: existing.id }, include: { items: true } });
      const maxVariance = refreshed!.items.reduce((max, i) => D.max(max, i.varianceValue.abs()), new D(0));
      let approvalInstanceId: string | undefined;
      if (maxVariance.gt(existing.varianceThreshold) && tenantId(req)) {
        const rule = await tx.approvalRule.findFirst({ where: { tenantId: tenantId(req), documentType: 'STOCK_RECONCILIATION', isActive: true }, orderBy: { priority: 'asc' } });
        if (rule) { const steps = Array.isArray(rule.steps) ? rule.steps as any[] : []; const approval = await tx.approvalInstance.create({ data: { tenantId: tenantId(req), companyId: companyId(req), documentType: 'STOCK_RECONCILIATION', documentId: existing.id, requestedBy: auth(req).id, ruleId: rule.id, actions: { create: steps.map((step, index) => ({ tenantId: tenantId(req), sequence: step.sequence || index + 1, approverType: step.approverType || 'USER', approverId: step.approverId })) } } }); approvalInstanceId = approval.id; }
      }
      return tx.stockReconciliation.update({ where: { id: existing.id }, data: { status: maxVariance.gt(existing.varianceThreshold) ? 'PENDING_APPROVAL' : 'APPROVED', approvalInstanceId }, include: reconciliationInclude });
    });
    return success(res, row, 'Count quantities uploaded and variances calculated');
  } catch (e: any) { return error(res, e.message || 'Could not upload count', 400); }
}

export async function approveReconciliation(req: Request, res: Response) {
  try { const rec = await prisma.stockReconciliation.findUnique({ where: { id: req.params.id } }); if (!rec || rec.status !== 'PENDING_APPROVAL') return error(res, 'Reconciliation is not pending approval', 400); if (rec.approvalInstanceId) { const approval = await prisma.approvalInstance.findUnique({ where: { id: rec.approvalInstanceId } }); if (approval?.status !== 'APPROVED') return error(res, 'Platform approval is still pending', 400); } await prisma.stockReconciliation.update({ where: { id: rec.id }, data: { status: 'APPROVED' } }); return success(res, null, 'Reconciliation approved'); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function submitReconciliation(req: Request, res: Response) {
  try {
    const result = await prisma.$transaction(async tx => {
      const rec = await tx.stockReconciliation.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!rec || rec.status !== 'APPROVED') throw new Error('Approved reconciliation is required');
      if (rec.items.some(i => i.countedQty == null)) throw new Error('Every reconciliation row must be counted');
      const entry = await tx.stockEntry.create({ data: { entryNo: number('STE-REC'), companyId: rec.companyId, purpose: 'STOCK_RECONCILIATION', status: 'SUBMITTED', postingDate: new Date(), toWarehouseId: rec.warehouseId, submittedAt: new Date(), sourceDocumentType: 'STOCK_RECONCILIATION', sourceDocumentId: rec.id, items: { create: rec.items.map(i => ({ productId: i.productId, warehouseId: rec.warehouseId, quantity: i.countedQty!, valuationRate: i.valuationRate, batchId: i.batchId, serialNoId: i.serialNoId })) } } });
      for (const item of rec.items) if (!item.varianceQty.eq(0)) await postStockLedger(tx, { productId: item.productId, warehouseId: rec.warehouseId, actualQty: item.varianceQty, rate: item.valuationRate, voucherType: 'STOCK_RECONCILIATION', voucherId: rec.id, voucherNo: rec.reconciliationNo, batchId: item.batchId || undefined, serialNoId: item.serialNoId || undefined, remarks: 'Physical count adjustment' });
      await tx.warehouse.update({ where: { id: rec.warehouseId }, data: { isFrozen: false, frozenAt: null, frozenById: null } });
      return tx.stockReconciliation.update({ where: { id: rec.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), adjustmentEntryId: entry.id }, include: reconciliationInclude });
    });
    return success(res, result, 'Reconciliation submitted and adjustment posted');
  } catch (e: any) { return error(res, e.message || 'Could not submit reconciliation', 400); }
}

export async function cancelReconciliation(req: Request, res: Response) {
  try { const row = await prisma.$transaction(async tx => { const rec = await tx.stockReconciliation.findUnique({ where: { id: req.params.id } }); if (!rec || rec.status === 'SUBMITTED') throw new Error('Submitted reconciliation must be reversed through its stock entry'); await tx.warehouse.update({ where: { id: rec.warehouseId }, data: { isFrozen: false, frozenAt: null, frozenById: null } }); return tx.stockReconciliation.update({ where: { id: rec.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }); }); return success(res, row, 'Reconciliation cancelled'); }
  catch (e: any) { return error(res, e.message || 'Could not cancel reconciliation', 400); }
}

export async function createTransferOrder(req: Request, res: Response) {
  try {
    const { sourceWarehouseId, destinationWarehouseId, items = [] } = req.body;
    if (!sourceWarehouseId || !destinationWarehouseId || sourceWarehouseId === destinationWarehouseId || !items.length) return error(res, 'Different source/destination warehouses and items are required', 400);
    const [source, destination] = await Promise.all([prisma.warehouse.findUnique({ where: { id: sourceWarehouseId } }), prisma.warehouse.findUnique({ where: { id: destinationWarehouseId } })]);
    if (!source || !destination) return error(res, 'Warehouse not found', 404);
    for (const item of items) {
      const quantity = new D(item.quantity || 0);
      if (!item.productId || quantity.lte(0)) return error(res, 'Every transfer item requires a product and positive quantity', 400);
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) return error(res, 'Transfer product not found', 404);
      if (product.hasBatchNo) {
        if (!item.batchId) return error(res, `Batch is required for ${product.sku}`, 400);
        const batch = await prisma.batch.findUnique({ where: { id: item.batchId } });
        if (!batch || batch.productId !== product.id || batch.warehouseId !== sourceWarehouseId || batch.quantity.lt(quantity)) return error(res, `Selected batch has insufficient source stock for ${product.sku}`, 400);
      }
      if (product.hasSerialNo) {
        if (!item.serialNoId || !quantity.eq(1)) return error(res, `A transfer line for serialized item ${product.sku} must have one serial and quantity 1`, 400);
        const serial = await prisma.serialNumber.findUnique({ where: { id: item.serialNoId } });
        if (!serial || serial.productId !== product.id || serial.warehouseId !== sourceWarehouseId || serial.status !== 'AVAILABLE') return error(res, `Selected serial is not available in the source warehouse for ${product.sku}`, 400);
      }
    }
    const crossPlant = Boolean(source.plantId && destination.plantId && source.plantId !== destination.plantId);
    if (crossPlant && !req.body.transitWarehouseId) return error(res, 'Across-plant transfer requires a goods-in-transit warehouse', 400);
    const row = await prisma.stockTransferOrder.create({ data: { transferNo: number('TO'), companyId: companyId(req), sourceWarehouseId, destinationWarehouseId, transitWarehouseId: req.body.transitWarehouseId, crossPlant, transporter: req.body.transporter, vehicleNo: req.body.vehicleNo, trackingReference: req.body.trackingReference, notes: req.body.notes, items: { create: items.map((i: any) => ({ productId: i.productId, quantity: new D(i.quantity), valuationRate: new D(i.valuationRate || 0), batchId: i.batchId, serialNoId: i.serialNoId })) } }, include: transferInclude });
    return success(res, row, 'Transfer order created', 201);
  } catch (e: any) { return error(res, e.message || 'Could not create transfer', 400); }
}

export async function listTransferOrders(req: Request, res: Response) {
  try { return success(res, await prisma.stockTransferOrder.findMany({ where: { ...(companyId(req) ? { companyId: companyId(req) } : {}), ...(req.query.status ? { status: req.query.status as any } : {}) }, include: transferInclude, orderBy: { createdAt: 'desc' } })); }
  catch (e) { return handlePrismaError(res, e); }
}

export async function transferOperation(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    const result = await prisma.$transaction(async tx => {
      const order = await tx.stockTransferOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!order) throw new Error('Transfer order not found');
      if (operation === 'submit') { if (order.status !== 'DRAFT') throw new Error('Only draft transfers can be submitted'); return tx.stockTransferOrder.update({ where: { id: order.id }, data: { status: 'SUBMITTED' } }); }
      if (operation === 'dispatch') {
        if (order.status !== 'SUBMITTED') throw new Error('Only submitted transfers can be dispatched');
        const target = order.crossPlant ? order.transitWarehouseId : order.destinationWarehouseId;
        if (!target) throw new Error('Transit warehouse is required');
        for (const item of order.items) { await postStockTransfer(tx, { productId: item.productId, fromWarehouseId: order.sourceWarehouseId, toWarehouseId: target, quantity: item.quantity, rate: item.valuationRate, voucherType: 'TRANSFER_ORDER', voucherId: order.id, voucherNo: order.transferNo, batchId: item.batchId || undefined, serialNoId: item.serialNoId || undefined, remarks: 'Transfer dispatch' }); await tx.stockTransferOrderItem.update({ where: { id: item.id }, data: { dispatchedQty: item.quantity, ...(!order.crossPlant ? { receivedQty: item.quantity } : {}) } }); }
        return tx.stockTransferOrder.update({ where: { id: order.id }, data: { status: order.crossPlant ? 'IN_TRANSIT' : 'RECEIVED', dispatchedAt: new Date(), ...(!order.crossPlant ? { receivedAt: new Date() } : {}) } });
      }
      if (operation === 'receive') {
        if (!order.crossPlant || !['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(order.status)) throw new Error('Only an in-transit cross-plant transfer can be received');
        const requested = new Map((req.body.items || []).map((i: any) => [i.id || i.transferOrderItemId, i]));
        for (const item of order.items) { const input: any = requested.get(item.id); if (!input) continue; const qty = new D(input.quantity); const open = item.dispatchedQty.minus(item.receivedQty).minus(item.damagedQty).minus(item.lostQty); const damaged = new D(input.damagedQty || 0), lost = new D(input.lostQty || 0); if (qty.plus(damaged).plus(lost).gt(open)) throw new Error('Receipt, damage and loss exceed in-transit quantity'); let transitBatchId: string | undefined; if (item.batchId) { const sourceBatch = await tx.batch.findUnique({ where: { id: item.batchId } }); const transitBatch = sourceBatch ? await tx.batch.findFirst({ where: { companyId: sourceBatch.companyId, productId: item.productId, batchNo: sourceBatch.batchNo, warehouseId: order.transitWarehouseId } }) : null; transitBatchId = transitBatch?.id; } if (qty.gt(0)) await postStockTransfer(tx, { productId: item.productId, fromWarehouseId: order.transitWarehouseId!, toWarehouseId: order.destinationWarehouseId, quantity: qty, rate: item.valuationRate, voucherType: 'TRANSFER_ORDER_RECEIPT', voucherId: order.id, voucherNo: order.transferNo, batchId: transitBatchId, serialNoId: item.serialNoId || undefined, remarks: 'Transfer receipt' }); if (damaged.plus(lost).gt(0)) await postStockLedger(tx, { productId: item.productId, warehouseId: order.transitWarehouseId!, actualQty: damaged.plus(lost).neg(), rate: item.valuationRate, voucherType: 'TRANSFER_VARIANCE', voucherId: order.id, voucherNo: order.transferNo, batchId: transitBatchId, serialNoId: item.serialNoId || undefined, remarks: `Damage ${damaged}; loss ${lost}` }); await tx.stockTransferOrderItem.update({ where: { id: item.id }, data: { receivedQty: { increment: qty }, damagedQty: { increment: damaged }, lostQty: { increment: lost } } }); }
        const refreshed = await tx.stockTransferOrder.findUnique({ where: { id: order.id }, include: { items: true } }); const complete = refreshed!.items.every(i => i.receivedQty.plus(i.damagedQty).plus(i.lostQty).gte(i.dispatchedQty)); return tx.stockTransferOrder.update({ where: { id: order.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', ...(complete ? { receivedAt: new Date() } : {}) } });
      }
      if (operation === 'cancel') { if (order.status === 'RECEIVED') throw new Error('Received transfer must be reversed with stock entries'); if (order.status === 'IN_TRANSIT' || order.status === 'PARTIALLY_RECEIVED') for (const item of order.items) { const remaining = item.dispatchedQty.minus(item.receivedQty).minus(item.damagedQty).minus(item.lostQty); let transitBatchId: string | undefined; if (item.batchId) { const sourceBatch = await tx.batch.findUnique({ where: { id: item.batchId } }); const transitBatch = sourceBatch ? await tx.batch.findFirst({ where: { companyId: sourceBatch.companyId, productId: item.productId, batchNo: sourceBatch.batchNo, warehouseId: order.transitWarehouseId } }) : null; transitBatchId = transitBatch?.id; } if (remaining.gt(0)) await postStockTransfer(tx, { productId: item.productId, fromWarehouseId: order.transitWarehouseId!, toWarehouseId: order.sourceWarehouseId, quantity: remaining, rate: item.valuationRate, voucherType: 'TRANSFER_CANCEL', voucherId: order.id, voucherNo: order.transferNo, batchId: transitBatchId, serialNoId: item.serialNoId || undefined, remarks: 'Cancelled transfer returned to source' }); } return tx.stockTransferOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }); }
      throw new Error('Unsupported transfer operation');
    });
    return success(res, result, `Transfer ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Transfer operation failed', 400); }
}

export async function materialRequestOperation(req: Request, res: Response) {
  try {
    const operation = req.params.operation;
    const result = await prisma.$transaction(async tx => {
      const request = await tx.materialRequest.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
      if (!request) throw new Error('Material request not found');
      if (operation === 'submit') { if (request.status !== 'DRAFT') throw new Error('Only draft requests can be submitted'); return tx.materialRequest.update({ where: { id: request.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } }); }
      if (operation === 'cancel') { if (request.status !== 'SUBMITTED') throw new Error('Only submitted requests can be cancelled'); return tx.materialRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }); }
      const selected = new Map<string, Prisma.Decimal>((req.body.items || []).map((i: any) => [String(i.id || i.materialRequestItemId), new D(i.quantity)] as [string, Prisma.Decimal]));
      if (!selected.size) throw new Error('Select at least one material request item and quantity');
      if (operation === 'issue') {
        const entry = await tx.stockEntry.create({ data: { entryNo: number('STE-MR'), companyId: request.companyId, purpose: 'MATERIAL_ISSUE', status: 'SUBMITTED', postingDate: new Date(), submittedAt: new Date(), sourceDocumentType: 'MATERIAL_REQUEST', sourceDocumentId: request.id, items: { create: [] } } });
        for (const item of request.items) { const qty = selected.get(item.id); if (!qty) continue; const open = item.quantity.minus(item.fulfilledQty); if (qty.gt(open)) throw new Error('Issue quantity exceeds open request quantity'); const warehouseId = req.body.warehouseId || item.warehouseId; if (!warehouseId) throw new Error('Warehouse is required'); await tx.stockEntryItem.create({ data: { stockEntryId: entry.id, productId: item.productId, warehouseId, quantity: qty, valuationRate: item.product.costPrice } }); await postStockLedger(tx, { productId: item.productId, warehouseId, actualQty: qty.neg(), rate: item.product.costPrice, voucherType: 'MATERIAL_REQUEST_ISSUE', voucherId: entry.id, voucherNo: entry.entryNo, remarks: request.requestNo }); await tx.materialRequestItem.update({ where: { id: item.id }, data: { issuedQty: { increment: qty }, fulfilledQty: { increment: qty } } }); }
        return entry;
      }
      if (operation === 'create-po') {
        if (!req.body.supplierId) throw new Error('supplierId is required');
        const lines = request.items.flatMap(item => { const qty = selected.get(item.id); if (!qty) return []; const open = item.quantity.minus(item.fulfilledQty).minus(item.orderedQty); if (qty.gt(open)) throw new Error('PO quantity exceeds open request quantity'); return [{ source: item, qty }]; });
        const po = await tx.purchaseOrder.create({ data: { orderNo: number('PO'), companyId: request.companyId, supplierId: req.body.supplierId, materialRequestId: request.id, expectedDate: request.requiredBy, currency: req.body.currency || 'INR', items: { create: lines.map(({ source, qty }) => ({ productId: source.productId, description: source.description, quantity: Number(qty), unitPrice: Number(req.body.unitPrices?.[source.id] || source.product.costPrice || 0), total: Number(qty.mul(req.body.unitPrices?.[source.id] || source.product.costPrice || 0)), uom: source.uom, stockUom: source.stockUom, conversionFactor: source.conversionFactor })) } } });
        for (const { source, qty } of lines) await tx.materialRequestItem.update({ where: { id: source.id }, data: { orderedQty: { increment: qty } } });
        return po;
      }
      if (operation === 'create-work-order') {
        const plans = []; for (const item of request.items) { const qty = selected.get(item.id); if (!qty) continue; const open = item.quantity.minus(item.fulfilledQty).minus(item.manufacturedQty); if (qty.gt(open)) throw new Error('Work-order quantity exceeds open request quantity'); const work = await tx.inventoryWorkOrder.create({ data: { workOrderNo: number('WO'), companyId: request.companyId, materialRequestId: request.id, productId: item.productId, warehouseId: item.warehouseId, quantity: qty, requiredBy: item.requiredBy || request.requiredBy, sourceDocumentType: 'MATERIAL_REQUEST', sourceDocumentId: request.id } }); await tx.materialRequestItem.update({ where: { id: item.id }, data: { manufacturedQty: { increment: qty }, workOrderId: work.id } }); plans.push(work); } return plans;
      }
      throw new Error('Unsupported material request operation');
    });
    return success(res, result, `Material request ${operation} completed`);
  } catch (e: any) { return error(res, e.message || 'Material request operation failed', 400); }
}

export async function traceability(req: Request, res: Response) {
  try {
    const batch = await prisma.batch.findUnique({ where: { id: req.params.batchId }, include: { product: true, ledgerEntries: { include: { warehouse: true }, orderBy: { postingDate: 'asc' } }, parentLinks: { include: { inputBatch: { include: { product: true } } } }, childLinks: { include: { outputBatch: { include: { product: true } } } } } });
    if (!batch) return error(res, 'Batch not found', 404);
    const voucherIds = batch.ledgerEntries.map(l => l.voucherId).filter(Boolean) as string[];
    const [invoices, receipts] = await Promise.all([prisma.salesInvoice.findMany({ where: { id: { in: voucherIds } }, include: { customer: true } }), prisma.purchaseReceipt.findMany({ where: { id: { in: voucherIds } }, include: { supplier: true } })]);
    return success(res, { batch, backward: { rawMaterialBatches: batch.parentLinks, purchaseReceipts: receipts }, forward: { producedBatches: batch.childLinks, customersAndInvoices: invoices }, movements: batch.ledgerEntries });
  } catch (e) { return handlePrismaError(res, e); }
}

export async function inventoryReport(req: Request, res: Response) {
  try {
    const type = req.params.type;
    if (type === 'reorder') { const levels = await prisma.stockLevel.findMany({ include: { product: { include: { warehouseRules: true } }, warehouse: true } }); return success(res, levels.filter(l => { const rule = l.product.warehouseRules.find(r => r.warehouseId === l.warehouseId); return l.quantity.minus(l.reservedQty).lte(rule?.reorderLevel || l.product.reorderLevel); }).map(l => ({ product: l.product.name, sku: l.product.sku, warehouse: l.warehouse.name, availableQty: l.quantity.minus(l.reservedQty), reorderQty: l.product.warehouseRules.find(r => r.warehouseId === l.warehouseId)?.reorderQty || l.product.reorderQty }))); }
    if (type === 'stock-ageing' || type === 'dead-stock') { const days = Number(req.query.days || (type === 'dead-stock' ? 180 : 90)); const cutoff = new Date(Date.now() - days * 86400000); const levels = await prisma.stockLevel.findMany({ where: { quantity: { gt: 0 } }, include: { product: true, warehouse: true } }); const rows = []; for (const l of levels) { const last = await prisma.stockLedgerEntry.findFirst({ where: { productId: l.productId, warehouseId: l.warehouseId, actualQty: { lt: 0 } }, orderBy: { postingDate: 'desc' } }); if (type === 'stock-ageing' || !last || last.postingDate < cutoff) rows.push({ sku: l.product.sku, product: l.product.name, warehouse: l.warehouse.name, quantity: l.quantity, lastIssueAt: last?.postingDate, ageDays: last ? Math.floor((Date.now() - last.postingDate.getTime()) / 86400000) : null }); } return success(res, rows); }
    if (type === 'batch-expiry') return success(res, await prisma.batch.findMany({ where: { isActive: true, expiryDate: { lte: new Date(Date.now() + Number(req.query.days || 30) * 86400000) } }, include: { product: true, warehouse: true }, orderBy: { expiryDate: 'asc' } }));
    if (type === 'warehouse-bin-balance') return success(res, await prisma.stockLevel.findMany({ include: { product: true, warehouse: { include: { parent: true } } }, orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }] }));
    if (type === 'stock-out-history') return success(res, await prisma.stockLedgerEntry.findMany({ where: { actualQty: { lt: 0 } }, include: { product: true, warehouse: true }, orderBy: { postingDate: 'desc' }, take: 500 }));
    if (type === 'transfers-in-transit') return success(res, await prisma.stockTransferOrder.findMany({ where: { status: { in: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'] } }, include: transferInclude }));
    if (type === 'reconciliation-variance') return success(res, await prisma.stockReconciliation.findMany({ where: { status: { not: 'DRAFT' } }, include: reconciliationInclude, orderBy: { createdAt: 'desc' } }));
    if (type === 'ledger-consistency') { const levels = await prisma.stockLevel.findMany(); const errors = []; for (const level of levels) { const ledger = await prisma.stockLedgerEntry.aggregate({ where: { productId: level.productId, warehouseId: level.warehouseId }, _sum: { actualQty: true } }); const ledgerQty = new D(ledger._sum.actualQty || 0); if (!ledgerQty.eq(level.quantity)) errors.push({ productId: level.productId, warehouseId: level.warehouseId, stockLevelQty: level.quantity, ledgerQty, difference: new D(level.quantity).minus(ledgerQty) }); } const layers = await prisma.inventoryValuationLayer.findMany(); const badLayers = layers.filter(layer => layer.remainingQty.lt(0) || layer.remainingQty.gt(layer.originalQty)); return success(res, { errors, valuationLayerErrors: badLayers, healthy: !errors.length && !badLayers.length }); }
    return error(res, 'Unknown inventory report', 404);
  } catch (e) { return handlePrismaError(res, e); }
}
