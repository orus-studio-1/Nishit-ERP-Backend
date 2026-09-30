import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { calculateInvoiceTotals } from '../../utils/invoice';
import { audit, recalculateInvoiceAllocations } from '../../utils/erp';
import { nextNo, postCreditNoteLedger, serializeCreditNote } from './shared';
import { paginateQuery } from '../../utils/pagination';

const D = Prisma.Decimal;

export const getCreditNotes = async (req: Request, res: Response) => {
  try {
    const { status, customerId, originalInvoiceId } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (originalInvoiceId) where.originalInvoiceId = originalInvoiceId;
    const { items, total, page, limit } = await paginateQuery(prisma.creditNote, req, { where, include: { customer: { select: { name: true } }, originalInvoice: { select: { invoiceNo: true } }, items: true } });
    return paginated(res, items.map(serializeCreditNote), total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getCreditNote = async (req: Request, res: Response) => {
  try {
    const note = await prisma.creditNote.findUnique({
      where: { id: req.params.id },
      include: { customer: true, originalInvoice: true, items: { include: { product: true } }, ledgerEntries: true },
    });
    if (!note) return error(res, 'Credit note not found', 404);
    return success(res, serializeCreditNote(note));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createCreditNote = async (req: Request, res: Response) => {
  try {
    const { originalInvoiceId, reason = 'OTHER', date, notes, items } = req.body;
    if (!originalInvoiceId) return error(res, 'originalInvoiceId is required', 400);
    const note = await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({ where: { id: originalInvoiceId }, include: { items: { include: { product: true } } } });
      if (!invoice) throw new Error('Invoice not found');
      if (invoice.status !== 'SUBMITTED') throw new Error('Credit notes can only be created for submitted invoices');
      const creditNoteNo = await nextNo(tx, 'CREDIT_NOTE');
      const sourceItems = (items?.length ? items : invoice.items).map((item: any) => ({
        productId: item.productId,
        itemCode: item.itemCode || item.product?.sku || '',
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.rate || item.unitPrice,
        taxRate: item.taxRate || 0,
        discount: item.discount || 0,
      }));
      if (!sourceItems.length) throw new Error('At least one credit note item is required');
      for (const item of sourceItems) {
        if (!item.productId) throw new Error('Every credit note row must have a product');
        if (Number(item.quantity || 0) <= 0) throw new Error('Credit quantity must be greater than zero');
        if (Number(item.unitPrice || 0) < 0) throw new Error('Credit rate cannot be negative');
      }
      const totals = calculateInvoiceTotals(sourceItems);
      const created = await tx.creditNote.create({
        data: {
          creditNoteNo,
          customerId: invoice.customerId,
          originalInvoiceId: invoice.id,
          reason,
          date: date ? new Date(date) : new Date(),
          currency: invoice.currency,
          notes,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          items: {
            create: totals.lines.map((line) => ({
              productId: line.productId,
              itemCode: line.itemCode,
              description: line.description,
              quantity: line.quantity,
              rate: line.rate,
              discount: line.discount,
              netAmount: line.netAmount,
              taxAmount: line.taxAmount,
              total: line.total,
            })),
          },
        },
        include: { customer: true, originalInvoice: true, items: true },
      });
      await audit(tx, req, { entityType: 'CREDIT_NOTE', entityId: created.id, creditNoteId: created.id, action: 'CREATE', statusAfter: 'DRAFT', message: `Created ${created.creditNoteNo}` });
      return created;
    });
    return success(res, serializeCreditNote(note), 'Credit note created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const createCreditNoteFromInvoice = async (req: Request, res: Response) => {
  req.body.originalInvoiceId = req.params.invoiceId;
  return createCreditNote(req, res);
};

export const updateCreditNoteStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const note = await prisma.$transaction(async (tx) => {
      const existing = await tx.creditNote.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Credit note not found');
      if (status === 'SUBMITTED') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft credit notes can be submitted');
        const invoice = await tx.salesInvoice.findUnique({ where: { id: existing.originalInvoiceId } });
        if (invoice) {
          await tx.paymentEntryAllocation.create({
            data: {
              paymentEntryId: (await tx.paymentEntry.create({
                data: {
                  paymentNo: `ADV-${existing.creditNoteNo}`,
                  status: 'SUBMITTED',
                  type: 'RECEIVED',
                  customerId: existing.customerId,
                  paidAmount: existing.grandTotal,
                  allocatedAmount: existing.grandTotal,
                  unallocatedAmount: new D(0),
                  currency: existing.currency,
                  method: 'ONLINE',
                  reference: existing.creditNoteNo,
                },
              })).id,
              allocationType: 'CREDIT_NOTE',
              invoiceId: invoice.id,
              creditNoteId: existing.id,
              allocatedAmount: existing.grandTotal,
            },
          });
          await recalculateInvoiceAllocations(tx, invoice.id);
        }
        const submitted = await tx.creditNote.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date() }, include: { customer: true, originalInvoice: true, items: true } });
        await postCreditNoteLedger(tx, submitted);
        await audit(tx, req, { entityType: 'CREDIT_NOTE', entityId: submitted.id, creditNoteId: submitted.id, action: 'SUBMIT', statusBefore: existing.status, statusAfter: 'SUBMITTED', message: `Submitted ${submitted.creditNoteNo}` });
        return submitted;
      }
      if (status === 'CANCELLED') {
        if (existing.status !== 'SUBMITTED') throw new Error('Only submitted credit notes can be cancelled');
        await postCreditNoteLedger(tx, existing, true);
        await tx.paymentEntryAllocation.deleteMany({ where: { creditNoteId: existing.id } });
        await recalculateInvoiceAllocations(tx, existing.originalInvoiceId);
        const cancelled = await tx.creditNote.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include: { customer: true, originalInvoice: true, items: true } });
        await audit(tx, req, { entityType: 'CREDIT_NOTE', entityId: cancelled.id, creditNoteId: cancelled.id, action: 'CANCEL', statusBefore: existing.status, statusAfter: 'CANCELLED', message: `Cancelled ${cancelled.creditNoteNo}` });
        return cancelled;
      }
      throw new Error('Unsupported credit note transition');
    });
    return success(res, serializeCreditNote(note), 'Credit note updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
