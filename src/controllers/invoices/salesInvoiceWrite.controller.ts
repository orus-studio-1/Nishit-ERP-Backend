import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { calculateInvoiceTotals } from '../../utils/invoice';
import { audit } from '../../utils/erp';
import { invoiceInclude, invoiceResponse, nextDocumentNo, normalizeInvoiceItems } from './shared';

export const createInvoice = async (req: Request, res: Response) => {
  try {
    const { customerId, salesOrderId, date, dueDate, items = [], notes, terms, currency, discount, assignedToId, tags = [] } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    if (!items.length) return error(res, 'At least one invoice item is required', 400);
    const userId = (req as any).user?.id;

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextDocumentNo(tx, 'SALES_INVOICE');
      const normalizedItems = await normalizeInvoiceItems(tx, items);
      const totals = calculateInvoiceTotals(normalizedItems, discount);
      const created = await tx.salesInvoice.create({
        data: {
          invoiceNo,
          customerId,
          salesOrderId,
          date: date ? new Date(date) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : undefined,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discount: totals.discount,
          total: totals.grandTotal,
          grandTotal: totals.grandTotal,
          outstandingAmount: totals.grandTotal,
          amountPaid: new Prisma.Decimal(0),
          currency: currency || 'INR',
          notes,
          terms,
          createdById: userId,
          assignedToId: assignedToId || userId,
          tags: Array.isArray(tags) ? tags : [],
          items: { create: totals.lines },
        },
        include: invoiceInclude,
      });
      await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: created.id, invoiceId: created.id, action: 'CREATE', statusAfter: 'DRAFT', message: `Created ${created.invoiceNo}` });
      return created;
    });
    return success(res, invoiceResponse(invoice), 'Invoice created', 201);
  } catch (err: any) {
    if (!err.code && err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const createInvoiceFromSalesOrder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const invoice = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: req.params.salesOrderId },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new Error('Sales order not found');
      if (order.status === 'DRAFT' || order.status === 'CANCELLED') throw new Error('Only confirmed sales orders can be invoiced');

      const invoiceNo = await nextDocumentNo(tx, 'SALES_INVOICE');
      const requested = new Map((req.body.items || []).map((i: any) => [i.salesOrderItemId || i.id, new Prisma.Decimal(i.quantity)]));
      const sourceItems = order.items.map((item: any) => ({
        salesOrderItemId: item.id,
        productId: item.productId,
        itemCode: item.product?.sku || '',
        description: item.description,
        quantity: requested.size ? requested.get(item.id) : new Prisma.Decimal(item.quantity).minus(item.billedQty),
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        discount: item.discount,
        taxTemplateId: item.product?.defaultTaxTemplateId,
      })).filter((item: any) => item.quantity && new Prisma.Decimal(item.quantity).gt(0));
      for (const item of sourceItems) {
        const orderItem = order.items.find((row: any) => row.id === item.salesOrderItemId)!;
        const remaining = new Prisma.Decimal(orderItem.quantity).minus(orderItem.billedQty);
        if (new Prisma.Decimal(item.quantity as any).gt(remaining)) throw new Error(`Invoice quantity for ${orderItem.product.sku} exceeds remaining quantity ${remaining}`);
      }
      if (!sourceItems.length) throw new Error('No quantities remain to be invoiced');
      const normalizedItems = await normalizeInvoiceItems(tx, sourceItems);
      const totals = calculateInvoiceTotals(normalizedItems, order.discount);
      const created = await tx.salesInvoice.create({
        data: {
          invoiceNo,
          customerId: order.customerId,
          salesOrderId: order.id,
          date: new Date(),
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discount: totals.discount,
          total: totals.grandTotal,
          grandTotal: totals.grandTotal,
          outstandingAmount: totals.grandTotal,
          amountPaid: new Prisma.Decimal(0),
          currency: order.currency,
          notes: order.notes,
          terms: order.terms,
          createdById: userId,
          assignedToId: userId,
          items: { create: totals.lines },
        },
        include: invoiceInclude,
      });
      return created;
    });
    return success(res, invoiceResponse(invoice), 'Invoice created from sales order', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const createInvoiceFromDeliveryNote = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const invoice = await prisma.$transaction(async (tx) => {
      const note = await tx.deliveryNote.findUnique({
        where: { id: req.params.deliveryNoteId },
        include: { items: { include: { product: true } }, salesOrder: true },
      });
      if (!note) throw new Error('Delivery note not found');
      if (note.status !== 'SUBMITTED') throw new Error('Only submitted delivery notes can be invoiced');
      const invoiceNo = await nextDocumentNo(tx, 'SALES_INVOICE');
      const sourceItems = note.items.map((item: any) => ({
        salesOrderItemId: item.salesOrderItemId,
        productId: item.productId,
        itemCode: item.itemCode || item.product?.sku || '',
        description: item.description || item.product?.name,
        quantity: item.quantity,
        unitPrice: item.product?.salePrice || 0,
        taxRate: item.product?.taxRate || 0,
        discount: 0,
        taxTemplateId: item.product?.defaultTaxTemplateId,
      }));
      const normalizedItems = await normalizeInvoiceItems(tx, sourceItems);
      const totals = calculateInvoiceTotals(normalizedItems);
      const created = await tx.salesInvoice.create({
        data: {
          invoiceNo,
          customerId: note.customerId,
          salesOrderId: note.salesOrderId,
          deliveryNoteId: note.id,
          date: new Date(),
          dueDate: note.salesOrder?.deliveryDate,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discount: totals.discount,
          total: totals.grandTotal,
          grandTotal: totals.grandTotal,
          outstandingAmount: totals.grandTotal,
          amountPaid: new Prisma.Decimal(0),
          currency: note.salesOrder?.currency || 'INR',
          notes: note.notes,
          terms: note.salesOrder?.terms,
          createdById: userId,
          assignedToId: userId,
          items: { create: totals.lines },
        },
        include: invoiceInclude,
      });
      await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: created.id, invoiceId: created.id, action: 'CREATE_FROM_DELIVERY_NOTE', statusAfter: 'DRAFT', message: `Created ${created.invoiceNo} from ${note.deliveryNo}` });
      return created;
    });
    return success(res, invoiceResponse(invoice), 'Invoice created from delivery note', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const updateInvoice = async (req: Request, res: Response) => {
  try {
    const { items, discount, date, dueDate, tags, ...data } = req.body;
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Invoice not found');
      if (existing.status !== 'DRAFT') throw new Error('Only draft invoices can be edited');

      const normalizedItems = items ? await normalizeInvoiceItems(tx, items) : null;
      const totals = normalizedItems ? calculateInvoiceTotals(normalizedItems, discount) : null;
      if (items) await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: existing.id } });

      const updated = await tx.salesInvoice.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(Array.isArray(tags) ? { tags } : {}),
          ...(date ? { date: new Date(date) } : {}),
          ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
          ...(totals ? {
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discount: totals.discount,
            total: totals.grandTotal,
            grandTotal: totals.grandTotal,
            outstandingAmount: totals.grandTotal,
            items: { create: totals.lines },
          } : {}),
        },
        include: invoiceInclude,
      });
      await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: updated.id, invoiceId: updated.id, action: 'UPDATE', statusBefore: existing.status, statusAfter: updated.status, message: `Updated ${updated.invoiceNo}` });
      return updated;
    });
    return success(res, invoiceResponse(invoice), 'Invoice updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
