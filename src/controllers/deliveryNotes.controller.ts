import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, paginated, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { audit, postStockOut } from '../utils/erp';
import { serializeMoney } from '../utils/invoice';
import { fulfillSalesOrderReservation } from '../services/inventory/reservation.service';
import { refreshSalesOrderProgress } from '../services/sales/salesOrder.service';

async function nextDeliveryNo(tx: any) {
  let series = await tx.numberingSeries.findFirst({ where: { documentType: 'DELIVERY_NOTE', isActive: true, isDefault: true } });
  if (!series) {
    series = await tx.numberingSeries.create({
      data: { documentType: 'DELIVERY_NOTE', name: 'DN-DEFAULT', pattern: `DN-${new Date().getFullYear()}-#####`, prefix: 'DN', digits: 5, isDefault: true },
    });
  }
  const updated = await tx.numberingSeries.update({ where: { id: series.id }, data: { current: { increment: 1 } } });
  return updated.pattern.replace('#'.repeat(updated.digits), String(updated.current).padStart(updated.digits, '0'));
}

const deliveryInclude = {
  customer: { select: { id: true, name: true, email: true } },
  salesOrder: { select: { id: true, orderNo: true, status: true, deliveryDate: true, items: { include: { product: { select: { id: true, sku: true, name: true } } } } } },
  warehouse: { select: { id: true, name: true, code: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, type: true } }, warehouse: { select: { id: true, name: true, code: true } } } },
  invoices: { select: { id: true, invoiceNo: true, status: true, paymentStatus: true, grandTotal: true } },
  auditLogs: { orderBy: { createdAt: 'desc' as const }, take: 30 },
};

function serializeDelivery(note: any) {
  return {
    ...note,
    items: note.items?.map((item: any) => ({
      ...item,
      quantity: serializeMoney(item.quantity),
      deliveredQty: serializeMoney(item.deliveredQty),
    })),
    invoices: note.invoices?.map((invoice: any) => ({ ...invoice, grandTotal: serializeMoney(invoice.grandTotal) })),
  };
}

function normalizeItems(items: any[]) {
  return items.map((item) => ({
    salesOrderItemId: item.salesOrderItemId || item.id || undefined,
    warehouseId: item.warehouseId || undefined,
    productId: item.productId,
    itemCode: item.itemCode || item.product?.sku || '',
    description: item.description || item.product?.name,
    quantity: new Prisma.Decimal(item.quantity || item.deliveredQty || 0),
    deliveredQty: new Prisma.Decimal(item.deliveredQty || 0),
  }));
}

function validateDeliveryItems(items: any[]) {
  if (!items.length) return 'At least one delivery item is required';
  for (const item of items) {
    if (!item.productId) return 'Every delivery row must have a product';
    if (Number(item.quantity || item.deliveredQty || 0) <= 0) return 'Delivery quantity must be greater than zero';
  }
  return null;
}

export const getDeliveryNotes = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { status, customerId, salesOrderId } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (salesOrderId) where.salesOrderId = salesOrderId;
    const [items, total] = await Promise.all([
      prisma.deliveryNote.findMany({ where, include: deliveryInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.deliveryNote.count({ where }),
    ]);
    return paginated(res, items.map(serializeDelivery), total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getDeliveryNote = async (req: Request, res: Response) => {
  try {
    const note = await prisma.deliveryNote.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
    if (!note) return error(res, 'Delivery note not found', 404);
    return success(res, serializeDelivery(note));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getDeliveryWorkspace = async (req: Request, res: Response) => {
  try {
    const selected = await prisma.deliveryNote.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
    if (!selected) return error(res, 'Delivery note not found', 404);
    if (!selected.salesOrderId) return success(res, { selected: serializeDelivery(selected), order: null, deliveries: [serializeDelivery(selected)], lines: selected.items.map(item => ({ salesOrderItemId: null, productId: item.productId, product: item.product, orderedQty: item.quantity, dispatchedQty: item.quantity, deliveredQty: item.deliveredQty, returnedQty: item.returnedQty, remainingToDispatch: 0, remainingToDeliver: Prisma.Decimal.max(0, item.quantity.minus(item.deliveredQty)), movements: [{ deliveryNoteId: selected.id, deliveryNo: selected.deliveryNo, quantity: item.quantity, deliveredQty: item.deliveredQty, returnedQty: item.returnedQty, shipmentStatus: selected.shipmentStatus, dispatchedAt: selected.dispatchedAt }] })) });
    const order = await prisma.salesOrder.findUnique({ where: { id: selected.salesOrderId }, include: { customer: true, quotation: { include: { enquirySource: true } }, items: { include: { product: true, stockReservations: { include: { warehouse: true } } } }, deliveryNotes: { where: { status: { not: 'CANCELLED' } }, include: deliveryInclude, orderBy: { createdAt: 'asc' } } } });
    if (!order) return error(res, 'Linked sales order not found', 404);
    const deliveries = order.deliveryNotes.map(serializeDelivery);
    const lines = order.items.map(item => {
      const movements = order.deliveryNotes.flatMap(note => note.items.filter(line => line.salesOrderItemId === item.id).map(line => ({ deliveryNoteId: note.id, deliveryNo: note.deliveryNo, quantity: line.quantity, deliveredQty: line.deliveredQty, returnedQty: line.returnedQty, warehouse: line.warehouse, shipmentStatus: note.shipmentStatus, dispatchedAt: note.dispatchedAt, expectedDeliveryAt: note.expectedDeliveryAt, deliveredAt: note.deliveredAt, trackingNo: note.trackingNo })));
      const remainingToDispatch = Prisma.Decimal.max(0, item.quantity.minus(item.dispatchedQty).minus(item.shortClosedQty));
      const remainingToDeliver = Prisma.Decimal.max(0, item.quantity.minus(item.deliveredQty).minus(item.shortClosedQty));
      return { salesOrderItemId: item.id, productId: item.productId, product: item.product, orderedQty: item.quantity, reservedQty: item.stockReservations.filter(row => ['ACTIVE','PARTIAL'].includes(row.status)).reduce((sum, row) => sum.plus(row.reservedQty.minus(row.fulfilledQty)), new Prisma.Decimal(0)), readyQty: item.readyQty, pickedQty: item.pickedQty, dispatchedQty: item.dispatchedQty, deliveredQty: item.deliveredQty, returnedQty: item.returnedQty, shortClosedQty: item.shortClosedQty, remainingToDispatch, remainingToDeliver, supplyStatus: item.supplyStatus, promisedDate: item.committedDeliveryDate || order.deliveryDate, movements };
    });
    return success(res, { selected: serializeDelivery(selected), order: { id: order.id, orderNo: order.orderNo, status: order.status, customer: order.customer, salesCaseId: order.quotation?.enquirySource?.id, deliveryDate: order.deliveryDate }, deliveries, lines, totals: lines.reduce((totals, line) => ({ orderedQty: totals.orderedQty.plus(line.orderedQty), reservedQty: totals.reservedQty.plus(line.reservedQty), dispatchedQty: totals.dispatchedQty.plus(line.dispatchedQty), deliveredQty: totals.deliveredQty.plus(line.deliveredQty), returnedQty: totals.returnedQty.plus(line.returnedQty), remainingToDispatch: totals.remainingToDispatch.plus(line.remainingToDispatch), remainingToDeliver: totals.remainingToDeliver.plus(line.remainingToDeliver) }), { orderedQty: new Prisma.Decimal(0), reservedQty: new Prisma.Decimal(0), dispatchedQty: new Prisma.Decimal(0), deliveredQty: new Prisma.Decimal(0), returnedQty: new Prisma.Decimal(0), remainingToDispatch: new Prisma.Decimal(0), remainingToDeliver: new Prisma.Decimal(0) }) });
  } catch (err) { return handlePrismaError(res, err); }
};

export const createDeliveryNote = async (req: Request, res: Response) => {
  try {
    const { customerId, salesOrderId, warehouseId, date, postingDate, notes, items = [] } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    const itemError = validateDeliveryItems(items);
    if (itemError) return error(res, itemError, 400);
    const note = await prisma.$transaction(async (tx) => {
      const deliveryNo = await nextDeliveryNo(tx);
      const created = await tx.deliveryNote.create({
        data: {
          deliveryNo,
          customerId,
          salesOrderId,
          warehouseId,
          date: date ? new Date(date) : new Date(),
          postingDate: postingDate ? new Date(postingDate) : undefined,
          notes,
          items: { create: normalizeItems(items) },
        },
        include: deliveryInclude,
      });
      await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: created.id, deliveryNoteId: created.id, action: 'CREATE', statusAfter: 'DRAFT', message: `Created ${created.deliveryNo}` });
      return created;
    });
    return success(res, serializeDelivery(note), 'Delivery note created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const createDeliveryNoteFromSalesOrder = async (req: Request, res: Response) => {
  try {
    const note = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.salesOrderId }, include: { items: { include: { product: true } } } });
      if (!order) throw new Error('Sales order not found');
      if (order.status === 'DRAFT' || order.status === 'CANCELLED') throw new Error('Only confirmed sales orders can be delivered');
      const requested = new Map((req.body.items || []).map((i: any) => [i.salesOrderItemId || i.id, new Prisma.Decimal(i.quantity)]));
      const sourceItems = order.items.map((item: any) => {
        const remaining = new Prisma.Decimal(item.quantity).minus(item.deliveredQty);
        const quantity = requested.size ? requested.get(item.id) : remaining;
        if (quantity && new Prisma.Decimal(quantity as any).gt(remaining)) throw new Error(`Delivery quantity for ${item.product.sku} exceeds remaining quantity ${remaining}`);
        return { ...item, quantity };
      }).filter((item: any) => item.quantity && new Prisma.Decimal(item.quantity).gt(0));
      if (!sourceItems.length) throw new Error('No quantities remain to be delivered');
      const deliveryNo = await nextDeliveryNo(tx);
      const created = await tx.deliveryNote.create({
        data: {
          deliveryNo,
          customerId: order.customerId,
          salesOrderId: order.id,
          date: new Date(),
          notes: order.notes,
          warehouseId: req.body.warehouseId || order.sourceWarehouseId,
          items: { create: normalizeItems(sourceItems) },
        },
        include: deliveryInclude,
      });
      await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: created.id, deliveryNoteId: created.id, action: 'CREATE_FROM_SALES_ORDER', statusAfter: 'DRAFT', message: `Created ${created.deliveryNo} from ${order.orderNo}` });
      return created;
    });
    return success(res, serializeDelivery(note), 'Delivery note created from sales order', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const createAndDispatchFromSalesOrder = async (req: Request, res: Response) => {
  try {
    const dispatched = await prisma.$transaction(async tx => {
      const order = await tx.salesOrder.findUnique({ where: { id: req.params.salesOrderId }, include: { customer: true, items: { include: { product: true } } } });
      if (!order) throw new Error('Sales order not found');
      if (!['CONFIRMED', 'AWAITING_STOCK', 'PARTIALLY_READY', 'READY_TO_DISPATCH', 'PARTIALLY_DISPATCHED', 'PARTIALLY_DELIVERED', 'PROCESSING'].includes(order.status)) throw new Error('Only an active confirmed sales order can be dispatched');
      const requestedRows = Array.isArray(req.body.items) ? req.body.items : [];
      if (!requestedRows.length) throw new Error('Select at least one product quantity to dispatch');
      const ids = requestedRows.map((row: any) => String(row.salesOrderItemId || row.id));
      if (new Set(ids).size !== ids.length) throw new Error('A sales-order line can appear only once in a dispatch');
      const lines: any[] = [];
      for (const requested of requestedRows) {
        const item = order.items.find(row => row.id === String(requested.salesOrderItemId || requested.id));
        if (!item) throw new Error('A selected sales-order line was not found');
        const quantity = new Prisma.Decimal(requested.quantity || 0);
        const remaining = item.quantity.minus(item.dispatchedQty).minus(item.shortClosedQty);
        if (quantity.lte(0)) continue;
        if (quantity.gt(remaining)) throw new Error(`Dispatch quantity for ${item.product.sku} cannot exceed ${remaining}`);
        const warehouseId = String(requested.warehouseId || '');
        if (!warehouseId) throw new Error(`Select a warehouse for ${item.product.sku}`);
        const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, isActive: true } });
        if (!warehouse) throw new Error(`Selected warehouse for ${item.product.sku} is unavailable`);
        if (item.product.type === 'PRODUCT' && item.product.maintainStock !== false && !item.product.allowNegativeStock) {
          const [level, ownReservations] = await Promise.all([tx.stockLevel.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId } } }), tx.stockReservation.aggregate({ where: { salesOrderId: order.id, salesOrderItemId: item.id, warehouseId, status: { in: ['ACTIVE', 'PARTIAL'] } }, _sum: { reservedQty: true, fulfilledQty: true } })]);
          const ownReserved = new Prisma.Decimal(ownReservations._sum.reservedQty || 0).minus(ownReservations._sum.fulfilledQty || 0);
          const usable = new Prisma.Decimal(level?.quantity || 0).minus(level?.reservedQty || 0).plus(ownReserved);
          if (quantity.gt(usable)) throw new Error(`${item.product.sku} has only ${Prisma.Decimal.max(0, usable)} dispatchable in ${warehouse.name}`);
        }
        lines.push({ salesOrderItemId: item.id, productId: item.productId, product: item.product, itemCode: item.product.sku, description: item.description || item.product.name, quantity, deliveredQty: new Prisma.Decimal(0), warehouseId });
      }
      if (!lines.length) throw new Error('Enter a dispatch quantity greater than zero');
      const deliveryNo = await nextDeliveryNo(tx);
      const uniqueWarehouses = [...new Set(lines.map(line => line.warehouseId))];
      const created = await tx.deliveryNote.create({ data: { deliveryNo, companyId: order.companyId, customerId: order.customerId, salesOrderId: order.id, warehouseId: uniqueWarehouses.length === 1 ? uniqueWarehouses[0] : null, date: new Date(), postingDate: new Date(), status: 'SUBMITTED', submittedAt: new Date(), shipmentStatus: 'DISPATCHED', dispatchedAt: new Date(), transporter: req.body.transporter, trackingNo: req.body.trackingNo, expectedDeliveryAt: req.body.expectedDeliveryAt ? new Date(req.body.expectedDeliveryAt) : undefined, notes: req.body.notes || order.notes, items: { create: lines.map(line => ({ salesOrderItemId: line.salesOrderItemId, productId: line.productId, warehouseId: line.warehouseId, itemCode: line.itemCode, description: line.description, quantity: line.quantity })) } }, include: deliveryInclude });
      for (const line of lines) {
        await postStockOut(tx, [{ ...line, deliveryNoteId: created.id }], deliveryNo, `Partial dispatch for ${order.orderNo}`, line.warehouseId);
        await fulfillSalesOrderReservation(tx, order.id, line.productId, line.warehouseId, line.quantity);
        const source = order.items.find(item => item.id === line.salesOrderItemId)!;
        const totalDispatched = source.dispatchedQty.plus(line.quantity);
        await tx.salesOrderItem.update({ where: { id: source.id }, data: { dispatchedQty: totalDispatched, pickedQty: Prisma.Decimal.max(0, source.pickedQty.minus(line.quantity)), supplyStatus: totalDispatched.plus(source.shortClosedQty).gte(source.quantity) ? 'FULLY_DISPATCHED' : 'PARTIALLY_DISPATCHED' } });
      }
      await refreshSalesOrderProgress(tx, order.id);
      await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: created.id, deliveryNoteId: created.id, action: 'CREATE_AND_DISPATCH', statusAfter: 'SUBMITTED', message: `Created and dispatched ${created.deliveryNo} from ${order.orderNo}`, diff: { lines: lines.map(line => ({ salesOrderItemId: line.salesOrderItemId, warehouseId: line.warehouseId, quantity: line.quantity.toString() })) } });
      const user = (req as any).user || {};
      await tx.platformAuditLog.create({ data: { tenantId: user.tenantId, companyId: order.companyId, userId: user.id, entityType: 'SHIPMENT', entityId: created.id, action: 'CREATE_AND_DISPATCH', after: JSON.parse(JSON.stringify(created)), diff: { salesOrderId: order.id, lines: lines.map(line => ({ salesOrderItemId: line.salesOrderItemId, warehouseId: line.warehouseId, quantity: line.quantity.toString() })) }, ip: req.ip, userAgent: req.get('user-agent') } });
      if (req.body.sendEmailApproved) {
        const recipient = String(req.body.recipientEmail || order.customer.email || '').trim();
        if (!recipient) throw new Error('Enter the customer email before approving dispatch email');
        const pending = order.items.map(item => { const sentNow = lines.find(line => line.salesOrderItemId === item.id)?.quantity || new Prisma.Decimal(0); return `${item.product.name}: dispatched ${sentNow}, remaining ${Prisma.Decimal.max(0, item.quantity.minus(item.dispatchedQty).minus(sentNow).minus(item.shortClosedQty))}`; }).join('\n');
        const communication = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'DISPATCH', recipient, subject: `Dispatch ${deliveryNo} for ${order.orderNo}`, message: `Your order has been partially dispatched.\nDelivery note: ${deliveryNo}\nTransporter: ${req.body.transporter || 'To be updated'}\nTracking: ${req.body.trackingNo || 'To be updated'}\nExpected delivery: ${req.body.expectedDeliveryAt || 'To be confirmed'}\n\n${pending}`, status: 'QUEUED', createdById: user.id } });
        await tx.backgroundJob.create({ data: { tenantId: user.tenantId, type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } });
      }
      return created;
    });
    return success(res, serializeDelivery(dispatched), 'Products dispatched and stock posted', 201);
  } catch (err: any) { return error(res, err.message || 'Could not dispatch products', err.message?.includes('not found') ? 404 : 400); }
};

export const updateDeliveryNoteStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const note = await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
      if (!existing) throw new Error('Delivery note not found');
      if (status === 'SUBMITTED') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft delivery notes can be submitted');
        for (const item of existing.items) await postStockOut(tx, [item], existing.deliveryNo, 'Stock issued from delivery note', item.warehouseId || existing.warehouseId || undefined);
        const warehouseId = existing.warehouseId || (await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }))?.id;
        if (existing.salesOrderId && warehouseId) {
          for (const item of existing.items) {
            if (!item.salesOrderItemId) throw new Error('Delivery line is missing its sales-order line reference');
            await fulfillSalesOrderReservation(tx, existing.salesOrderId, item.productId, warehouseId, item.quantity);
            await tx.salesOrderItem.update({
              where: { id: item.salesOrderItemId },
              data: { dispatchedQty: { increment: item.quantity }, supplyStatus: 'FULLY_DISPATCHED' },
            });
          }
          await refreshSalesOrderProgress(tx, existing.salesOrderId);
        }
        const submitted = await tx.deliveryNote.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), postingDate: existing.postingDate || new Date(), shipmentStatus: 'DISPATCHED', dispatchedAt: new Date(), transporter: req.body.transporter, trackingNo: req.body.trackingNo, expectedDeliveryAt: req.body.expectedDeliveryAt ? new Date(req.body.expectedDeliveryAt) : undefined }, include: deliveryInclude });
        await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: submitted.id, deliveryNoteId: submitted.id, action: 'SUBMIT', statusBefore: existing.status, statusAfter: 'SUBMITTED', message: `Submitted ${submitted.deliveryNo}` });
        return submitted;
      }
      if (status === 'CANCELLED') {
        if (existing.status !== 'SUBMITTED') throw new Error('Only submitted delivery notes can be cancelled');
        for (const item of existing.items) await postStockOut(tx, [item], existing.deliveryNo, 'Stock returned from cancelled delivery note', item.warehouseId || existing.warehouseId || undefined, true);
        if (existing.salesOrderId) {
          for (const item of existing.items) {
            if (!item.salesOrderItemId) throw new Error('Delivery line is missing its sales-order line reference');
            await tx.salesOrderItem.update({
              where: { id: item.salesOrderItemId },
              data: { dispatchedQty: { decrement: item.quantity }, ...(item.deliveredQty.gt(0) ? { deliveredQty: { decrement: item.deliveredQty } } : {}) },
            });
          }
          await refreshSalesOrderProgress(tx, existing.salesOrderId);
        }
        const cancelled = await tx.deliveryNote.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include: deliveryInclude });
        await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: cancelled.id, deliveryNoteId: cancelled.id, action: 'CANCEL', statusBefore: existing.status, statusAfter: 'CANCELLED', message: `Cancelled ${cancelled.deliveryNo}` });
        return cancelled;
      }
      throw new Error('Unsupported delivery note transition');
    });
    return success(res, serializeDelivery(note), 'Delivery note updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const updateShipmentStatus = async (req: Request, res: Response) => {
  try {
    const shipmentStatus = String(req.body.shipmentStatus || '').toUpperCase();
    if (!['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED'].includes(shipmentStatus)) return error(res, 'Invalid shipment status', 400);
    const existing = await prisma.deliveryNote.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) return error(res, 'Delivery note not found', 404);
    if (existing.status !== 'SUBMITTED') return error(res, 'Submit the delivery note before tracking shipment', 400);
    if (existing.shipmentStatus === 'DELIVERED' && shipmentStatus !== 'RETURNED') return error(res, 'A delivered shipment can only be marked returned', 400);
    const note = await prisma.$transaction(async tx => {
      if (shipmentStatus === 'DELIVERED' && existing.salesOrderId) {
        for (const item of existing.items) {
          if (!item.salesOrderItemId) throw new Error('Delivery line is missing its sales-order line reference');
          const netDeliverable = item.quantity.minus(item.returnedQty); const delta = netDeliverable.minus(item.deliveredQty);
          if (delta.gt(0)) { await tx.deliveryNoteItem.update({ where: { id: item.id }, data: { deliveredQty: { increment: delta } } }); await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { deliveredQty: { increment: delta }, supplyStatus: 'DELIVERED' } }); }
        }
        await refreshSalesOrderProgress(tx, existing.salesOrderId);
      }
      if (shipmentStatus === 'RETURNED') {
        for (const item of existing.items) {
          const returnQty = item.deliveredQty.minus(item.returnedQty); if (returnQty.lte(0)) continue;
          await postStockOut(tx, [{ ...item, quantity: returnQty }], existing.deliveryNo, 'Customer return from delivery', item.warehouseId || existing.warehouseId || undefined, true);
          await tx.deliveryNoteItem.update({ where: { id: item.id }, data: { returnedQty: { increment: returnQty } } });
          if (item.salesOrderItemId) await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { deliveredQty: { decrement: returnQty }, returnedQty: { increment: returnQty }, supplyStatus: 'RETURNED' } });
        }
        if (existing.salesOrderId) await refreshSalesOrderProgress(tx, existing.salesOrderId);
      }
      if (shipmentStatus === 'FAILED' && !String(req.body.failedDeliveryReason || '').trim()) throw new Error('Failed-delivery reason is required');
      const updated = await tx.deliveryNote.update({ where: { id: existing.id }, data: { shipmentStatus, transporter: req.body.transporter ?? existing.transporter, trackingNo: req.body.trackingNo ?? existing.trackingNo, expectedDeliveryAt: req.body.expectedDeliveryAt ? new Date(req.body.expectedDeliveryAt) : existing.expectedDeliveryAt, ...(shipmentStatus === 'DISPATCHED' ? { dispatchedAt: existing.dispatchedAt || new Date() } : {}), ...(shipmentStatus === 'FAILED' ? { failedDeliveryReason: String(req.body.failedDeliveryReason).trim() } : {}), ...(shipmentStatus === 'DELIVERED' ? { deliveredAt: req.body.deliveredAt ? new Date(req.body.deliveredAt) : new Date(), proofOfDelivery: req.body.proofOfDelivery, failedDeliveryReason: null } : {}) }, include: deliveryInclude });
      const user = (req as any).user || {}; await tx.platformAuditLog.create({ data: { tenantId: user.tenantId, companyId: user.companyId, userId: user.id, entityType: 'SHIPMENT', entityId: existing.id, action: `MARK_${shipmentStatus}`, before: JSON.parse(JSON.stringify(existing)), after: JSON.parse(JSON.stringify(updated)), ip: req.ip, userAgent: req.get('user-agent') } });
      if (shipmentStatus === 'DELIVERED' && req.body.sendEmailApproved && existing.salesOrderId) {
        const order = await tx.salesOrder.findUnique({ where: { id: existing.salesOrderId }, include: { customer: true } });
        if (order) { const recipient = String(req.body.recipientEmail || order.customer.email || '').trim(); if (!recipient) throw new Error('Enter the customer email before approving delivery email'); const communication = await tx.salesCommunication.create({ data: { companyId: order.companyId, entityType: 'ORDER', entityId: order.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'DELIVERY_CONFIRMATION', recipient, subject: `Delivery confirmed: ${existing.deliveryNo}`, message: `Delivery ${existing.deliveryNo} for order ${order.orderNo} was confirmed on ${updated.deliveredAt?.toLocaleString()}. Proof of delivery: ${updated.proofOfDelivery || 'Recorded in ERP'}.`, status: 'QUEUED', createdById: user.id } }); await tx.backgroundJob.create({ data: { tenantId: user.tenantId, type: 'SALES_COMMUNICATION_SEND', payload: { communicationId: communication.id } } }); }
      }
      return updated;
    });
    return success(res, serializeDelivery(note), `Shipment marked ${shipmentStatus.toLowerCase()}`);
  } catch (err: any) { return error(res, err.message || 'Could not update shipment', 400); }
};
