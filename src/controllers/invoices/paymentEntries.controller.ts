import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { audit, recalculateInvoiceAllocations } from '../../utils/erp';
import { nextDocumentNo, postPaymentEntryLedger, serializePaymentEntry } from './shared';
import { closeSalesOrderWhenSettled } from '../../services/sales/salesOrder.service';
import { paginateQuery } from '../../utils/pagination';

export const getPaymentEntries = async (req: Request, res: Response) => {
  try {
    const { customerId, status } = req.query as any;
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    const { items, total, page, limit } = await paginateQuery(prisma.paymentEntry, req, { where, include: { customer: { select: { name: true } }, allocations: { include: { invoice: { select: { invoiceNo: true, grandTotal: true, outstandingAmount: true } }, creditNote: { select: { creditNoteNo: true } } } } } });
    return paginated(res, items.map(serializePaymentEntry), total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getPaymentEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.paymentEntry.findUnique({
      where: { id: req.params.id },
      include: { customer: true, allocations: { include: { invoice: { select: { invoiceNo: true, grandTotal: true, outstandingAmount: true } }, creditNote: { select: { creditNoteNo: true } } } }, ledgerEntries: true },
    });
    if (!entry) return error(res, 'Payment entry not found', 404);
    return success(res, serializePaymentEntry(entry));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPaymentEntry = async (req: Request, res: Response) => {
  try {
    const { type = 'RECEIVED', customerId, date, paidAmount, currency = 'INR', method = 'BANK_TRANSFER', reference, notes, allocations = [] } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    if (!paidAmount || Number(paidAmount) <= 0) return error(res, 'paidAmount must be greater than zero', 400);
    const entry = await prisma.$transaction(async (tx) => {
      const paymentNo = await nextDocumentNo(tx, 'PAYMENT_ENTRY');
      for (const row of allocations) {
        const amount = new Prisma.Decimal(row.allocatedAmount || 0);
        if (amount.lte(0)) throw new Error('Allocation amount must be greater than zero');
        if (row.invoiceId) {
          const invoice = await tx.salesInvoice.findUnique({ where: { id: row.invoiceId } });
          if (!invoice || invoice.status !== 'SUBMITTED') throw new Error('Allocations require submitted invoices');
          if (invoice.customerId !== customerId) throw new Error(`Invoice ${invoice.invoiceNo} belongs to a different customer`);
          if (amount.gt(invoice.outstandingAmount)) throw new Error(`Allocation exceeds outstanding for ${invoice.invoiceNo}`);
        }
        if (row.creditNoteId) {
          const creditNote = await tx.creditNote.findUnique({ where: { id: row.creditNoteId } });
          if (!creditNote || creditNote.status !== 'SUBMITTED') throw new Error('Credit note allocations require submitted credit notes');
          if (creditNote.customerId !== customerId) throw new Error(`Credit note ${creditNote.creditNoteNo} belongs to a different customer`);
        }
      }
      const allocatedAmount = allocations.reduce((sum: Prisma.Decimal, row: any) => sum.plus(row.allocatedAmount || 0), new Prisma.Decimal(0));
      const paid = new Prisma.Decimal(paidAmount);
      if (allocatedAmount.gt(paid)) throw new Error('Allocated amount cannot exceed paid amount');
      const created = await tx.paymentEntry.create({
        data: {
          paymentNo,
          type,
          customerId,
          date: date ? new Date(date) : new Date(),
          paidAmount: paid,
          allocatedAmount,
          unallocatedAmount: paid.minus(allocatedAmount),
          currency,
          method,
          reference,
          notes,
          allocations: {
            create: allocations.map((row: any) => ({
              allocationType: row.allocationType || (row.creditNoteId ? 'CREDIT_NOTE' : row.invoiceId ? 'INVOICE' : 'ADVANCE'),
              invoiceId: row.invoiceId,
              creditNoteId: row.creditNoteId,
              allocatedAmount: new Prisma.Decimal(row.allocatedAmount || 0),
            })),
          },
        },
        include: { customer: true, allocations: { include: { invoice: true, creditNote: true } } },
      });
      await audit(tx, req, { entityType: 'PAYMENT_ENTRY', entityId: created.id, action: 'CREATE', statusAfter: 'DRAFT', message: `Created ${created.paymentNo}` });
      return created;
    });
    return success(res, serializePaymentEntry(entry), 'Payment entry created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const updatePaymentEntryStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentEntry.findUnique({ where: { id: req.params.id }, include: { allocations: true } });
      if (!existing) throw new Error('Payment entry not found');
      if (status === 'SUBMITTED') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft payment entries can be submitted');
        for (const allocation of existing.allocations) {
          if (allocation.invoiceId) {
            const invoice = await tx.salesInvoice.findUnique({ where: { id: allocation.invoiceId } });
            if (!invoice || invoice.status !== 'SUBMITTED') throw new Error('Payment allocations require submitted invoices');
            if (new Prisma.Decimal(allocation.allocatedAmount).gt(invoice.outstandingAmount)) throw new Error(`Allocation exceeds outstanding for ${invoice.invoiceNo}`);
          }
        }
        const submitted = await tx.paymentEntry.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date() }, include: { allocations: true, customer: true } });
        await postPaymentEntryLedger(tx, submitted);
        for (const allocation of submitted.allocations) {
          if (allocation.invoiceId) {
            await recalculateInvoiceAllocations(tx, allocation.invoiceId);
            const invoice = await tx.salesInvoice.findUnique({ where: { id: allocation.invoiceId }, select: { salesOrderId: true } });
            if (invoice?.salesOrderId) await closeSalesOrderWhenSettled(tx, invoice.salesOrderId);
          }
        }
        await audit(tx, req, { entityType: 'PAYMENT_ENTRY', entityId: submitted.id, action: 'SUBMIT', statusBefore: existing.status, statusAfter: 'SUBMITTED', message: `Submitted ${submitted.paymentNo}` });
        return tx.paymentEntry.findUnique({ where: { id: submitted.id }, include: { customer: true, allocations: { include: { invoice: true, creditNote: true } }, ledgerEntries: true } });
      }
      if (status === 'CANCELLED') {
        if (existing.status !== 'SUBMITTED') throw new Error('Only submitted payment entries can be cancelled');
        const cancelled = await tx.paymentEntry.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include: { allocations: true, customer: true } });
        await postPaymentEntryLedger(tx, cancelled, true);
        for (const allocation of cancelled.allocations) {
          if (allocation.invoiceId) await recalculateInvoiceAllocations(tx, allocation.invoiceId);
        }
        await audit(tx, req, { entityType: 'PAYMENT_ENTRY', entityId: cancelled.id, action: 'CANCEL', statusBefore: existing.status, statusAfter: 'CANCELLED', message: `Cancelled ${cancelled.paymentNo}` });
        return cancelled;
      }
      throw new Error('Unsupported payment entry transition');
    });
    return success(res, serializePaymentEntry(entry), 'Payment entry updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
