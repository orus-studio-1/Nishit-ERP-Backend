import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { audit, postStockOut, resolveAndSnapshotInvoiceTaxes } from '../../utils/erp';
import { invoiceInclude, invoiceResponse, postInvoiceLedger } from './shared';
import { markSalesOrderBilled, refreshSalesOrderProgress } from '../../services/sales/salesOrder.service';

export const updateInvoiceStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const invoiceId = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { product: { select: { id: true, type: true } } } } },
      });
      if (!existing) throw new Error('Invoice not found');
      if (status === 'SUBMITTED' || status === 'SENT') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft invoices can be submitted');
        const claimed = await tx.salesInvoice.updateMany({
          where: { id: existing.id, status: 'DRAFT' },
          data: { status: 'SUBMITTED', submittedAt: new Date(), outstandingAmount: existing.grandTotal.minus(existing.amountPaid), paymentStatus: 'UNPAID' },
        });
        if (claimed.count !== 1) throw new Error('Invoice is already being submitted or is no longer a draft');
        await resolveAndSnapshotInvoiceTaxes(tx, existing.id, existing);
        if (!existing.deliveryNoteId) await postStockOut(tx, existing.items, existing.invoiceNo, 'Stock issued from submitted sales invoice');
        if (existing.salesOrderId) await markSalesOrderBilled(tx, existing.salesOrderId, existing.items);
        await postInvoiceLedger(tx, existing);
        await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: existing.id, invoiceId: existing.id, action: 'SUBMIT', statusBefore: existing.status, statusAfter: 'SUBMITTED', message: `Submitted ${existing.invoiceNo}` });
        return existing.id;
      }
      if (status === 'CANCELLED') {
        if (existing.status === 'DRAFT') throw new Error('Delete draft invoices instead of cancelling');
        if (existing.status === 'CANCELLED') throw new Error('Invoice is already cancelled');
        const [legacyPayments, submittedAllocations] = await Promise.all([
          tx.payment.count({ where: { invoiceId: existing.id } }),
          tx.paymentEntryAllocation.count({ where: { invoiceId: existing.id, paymentEntry: { status: 'SUBMITTED' } } }),
        ]);
        if (legacyPayments || submittedAllocations || existing.amountPaid.gt(0)) throw new Error('Reverse or cancel all payments allocated to this invoice before cancelling it');
        const claimed = await tx.salesInvoice.updateMany({ where: { id: existing.id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledAt: new Date(), paymentStatus: 'UNPAID' } });
        if (claimed.count !== 1) throw new Error('Invoice is already being cancelled or its status changed');
        await postInvoiceLedger(tx, existing, true);
        if (!existing.deliveryNoteId) await postStockOut(tx, existing.items, existing.invoiceNo, 'Stock returned from cancelled sales invoice', undefined, true);
        if (existing.salesOrderId) {
          for (const item of existing.items) {
            await tx.salesOrderItem.updateMany({ where: { salesOrderId: existing.salesOrderId, productId: item.productId }, data: { billedQty: { decrement: item.quantity } } });
          }
          await refreshSalesOrderProgress(tx, existing.salesOrderId);
        }
        await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: existing.id, invoiceId: existing.id, action: 'CANCEL', statusBefore: existing.status, statusAfter: 'CANCELLED', message: `Cancelled ${existing.invoiceNo}` });
        return existing.id;
      }
      throw new Error('Unsupported invoice status transition');
    });
    const invoice = await prisma.salesInvoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude });
    return success(res, invoiceResponse(invoice), 'Invoice status updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Invoice not found');
      if (existing.status !== 'DRAFT') throw new Error('Submitted invoices cannot be deleted. Cancel the invoice instead.');
      await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: existing.id, invoiceId: existing.id, action: 'DELETE', statusBefore: existing.status, message: `Deleted draft ${existing.invoiceNo}` });
      await tx.salesInvoice.delete({ where: { id: existing.id } });
    });
    return success(res, null, 'Invoice deleted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const amendInvoice = async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!existing) throw new Error('Invoice not found');
      if (existing.status !== 'CANCELLED') throw new Error('Only cancelled invoices can be amended');
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `invoice-amend:${existing.id}`);
      const amendmentCount = await tx.salesInvoice.count({ where: { amendedFromId: existing.id } });
      let suffix = amendmentCount + 1;
      let invoiceNo = `${existing.invoiceNo}-${suffix}`;
      while (await tx.salesInvoice.findFirst({ where: { invoiceNo } })) {
        suffix += 1;
        invoiceNo = `${existing.invoiceNo}-${suffix}`;
      }
      const amended = await tx.salesInvoice.create({
        data: {
          invoiceNo,
          amendedFromId: existing.id,
          customerId: existing.customerId,
          salesOrderId: existing.salesOrderId,
          date: new Date(),
          dueDate: existing.dueDate,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          subtotal: existing.subtotal,
          taxAmount: existing.taxAmount,
          discount: existing.discount,
          total: existing.grandTotal,
          grandTotal: existing.grandTotal,
          outstandingAmount: existing.grandTotal,
          amountPaid: new Prisma.Decimal(0),
          currency: existing.currency,
          notes: existing.notes,
          terms: existing.terms,
          items: {
            create: existing.items.map((item: any) => ({
              productId: item.productId,
              itemCode: item.itemCode,
              description: item.description,
              quantity: item.quantity,
              rate: item.rate,
              unitPrice: item.rate,
              discount: item.discount,
              taxRate: item.taxRate,
              netAmount: item.netAmount,
              taxAmount: item.taxAmount,
              total: item.total,
              taxTemplateId: item.taxTemplateId,
            })),
          },
        },
        include: invoiceInclude,
      });
      await audit(tx, req, { entityType: 'SALES_INVOICE', entityId: amended.id, invoiceId: amended.id, action: 'AMEND', statusAfter: 'DRAFT', message: `Amended from ${existing.invoiceNo}` });
      return amended;
    });
    return success(res, invoiceResponse(invoice), 'Invoice amended', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
