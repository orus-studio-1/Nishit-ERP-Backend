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
  salesOrder: { select: { id: true, orderNo: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, type: true } } } },
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
    productId: item.productId,
    itemCode: item.itemCode || item.product?.sku || '',
    description: item.description || item.product?.name,
    quantity: new Prisma.Decimal(item.quantity || item.deliveredQty || 0),
    deliveredQty: new Prisma.Decimal(item.deliveredQty || item.quantity || 0),
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

export const updateDeliveryNoteStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const note = await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
      if (!existing) throw new Error('Delivery note not found');
      if (status === 'SUBMITTED') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft delivery notes can be submitted');
        await postStockOut(tx, existing.items, existing.deliveryNo, 'Stock issued from delivery note', existing.warehouseId || undefined);
        const warehouseId = existing.warehouseId || (await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }))?.id;
        if (existing.salesOrderId && warehouseId) {
          for (const item of existing.items) {
            if (!item.salesOrderItemId) throw new Error('Delivery line is missing its sales-order line reference');
            await fulfillSalesOrderReservation(tx, existing.salesOrderId, item.productId, warehouseId, item.quantity);
            await tx.salesOrderItem.update({
              where: { id: item.salesOrderItemId },
              data: { deliveredQty: { increment: item.quantity } },
            });
          }
          await refreshSalesOrderProgress(tx, existing.salesOrderId);
        }
        const submitted = await tx.deliveryNote.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), postingDate: existing.postingDate || new Date() }, include: deliveryInclude });
        await audit(tx, req, { entityType: 'DELIVERY_NOTE', entityId: submitted.id, deliveryNoteId: submitted.id, action: 'SUBMIT', statusBefore: existing.status, statusAfter: 'SUBMITTED', message: `Submitted ${submitted.deliveryNo}` });
        return submitted;
      }
      if (status === 'CANCELLED') {
        if (existing.status !== 'SUBMITTED') throw new Error('Only submitted delivery notes can be cancelled');
        await postStockOut(tx, existing.items, existing.deliveryNo, 'Stock returned from cancelled delivery note', existing.warehouseId || undefined, true);
        if (existing.salesOrderId) {
          for (const item of existing.items) {
            if (!item.salesOrderItemId) throw new Error('Delivery line is missing its sales-order line reference');
            await tx.salesOrderItem.update({
              where: { id: item.salesOrderItemId },
              data: { deliveredQty: { decrement: item.quantity } },
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
