import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { serializeMoney } from '../../utils/invoice';
import { nextDocumentNo, postPaymentLedger, recalculateInvoicePayment } from './shared';

export const getPayments = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { customerId, invoiceId, method, fromDate, toDate } = req.query as any;
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (invoiceId) where.invoiceId = invoiceId;
    if (method) where.method = method;
    if (fromDate || toDate) where.date = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);
    return paginated(res, items.map((payment: any) => ({ ...payment, amount: serializeMoney(payment.amount) })), total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getPayment = async (req: Request, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: { customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } } },
    });
    if (!payment) return error(res, 'Payment not found', 404);
    return success(res, { ...payment, amount: serializeMoney(payment.amount) });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPayment = async (req: Request, res: Response) => {
  try {
    const { type = 'RECEIVED', customerId, invoiceId, date, amount, currency, method = 'BANK_TRANSFER', reference, notes } = req.body;
    const payment = await prisma.$transaction(async (tx) => {
      const invoice = invoiceId ? await tx.salesInvoice.findUnique({ where: { id: invoiceId } }) : null;
      if (invoiceId && !invoice) throw new Error('Invoice not found');
      if (invoice && invoice.status !== 'SUBMITTED') throw new Error('Payments can only be recorded against submitted invoices');
      const paymentAmount = new Prisma.Decimal(amount);
      if (paymentAmount.lte(0)) throw new Error('Payment amount must be greater than zero');
      if (!customerId && !invoice) throw new Error('customerId is required for an unallocated payment');
      if (invoice && customerId && invoice.customerId !== customerId) throw new Error(`Invoice ${invoice.invoiceNo} belongs to a different customer`);
      if (invoice && paymentAmount.gt(invoice.outstandingAmount)) throw new Error('Payment cannot exceed outstanding amount');
      const paymentNo = await nextDocumentNo(tx, 'PAYMENT_ENTRY');
      const created = await tx.payment.create({
        data: {
          paymentNo,
          type,
          customerId: customerId || invoice?.customerId,
          invoiceId,
          date: date ? new Date(date) : new Date(),
          amount: paymentAmount,
          currency: currency || invoice?.currency || 'INR',
          method,
          reference,
          notes,
        },
        include: { customer: true, invoice: true },
      });
      if (invoiceId) {
        await recalculateInvoicePayment(tx, invoiceId);
        await postPaymentLedger(tx, created, invoice);
      }
      return created;
    });
    return success(res, { ...payment, amount: serializeMoney(payment.amount) }, 'Payment recorded', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const deletePayment = async (req: Request, res: Response) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw new Error('Payment not found');
      await tx.payment.delete({ where: { id: payment.id } });
      if (payment.invoiceId) await recalculateInvoicePayment(tx, payment.invoiceId);
    });
    return success(res, null, 'Payment reversed');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
