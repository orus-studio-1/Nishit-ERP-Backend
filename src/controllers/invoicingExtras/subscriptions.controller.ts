import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { calculateInvoiceTotals, serializeInvoice } from '../../utils/invoice';
import { addMonths, resolveAndSnapshotInvoiceTaxes } from '../../utils/erp';
import { nextNo } from './shared';
import { normalizeInvoiceItems, postInvoiceLedger } from '../invoices/shared';
import { runWithTenant } from '../../utils/tenant';

const D = Prisma.Decimal;

const subscriptionInclude = {
  customer: { select: { id: true, name: true, email: true, currency: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, salePrice: true, taxRate: true } },
      taxTemplate: { select: { id: true, code: true, name: true } },
    },
  },
  generatedInvoices: {
    include: { invoice: { select: { id: true, invoiceNo: true, status: true, paymentStatus: true, grandTotal: true, currency: true } } },
    orderBy: { createdAt: 'desc' as const },
    take: 8,
  },
};

function serializeSubscription(subscription: any) {
  return {
    ...subscription,
    items: subscription.items?.map((item: any) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      rate: Number(item.rate || 0),
      discount: Number(item.discount || 0),
    })),
    generatedInvoices: subscription.generatedInvoices?.map((run: any) => ({
      ...run,
      invoice: run.invoice ? { ...run.invoice, grandTotal: Number(run.invoice.grandTotal || 0) } : run.invoice,
    })),
  };
}

function sourceItems(subscription: any) {
  return subscription.items.map((item: any) => ({
    productId: item.productId,
    itemCode: item.itemCode || item.product?.sku || '',
    description: item.description || item.product?.name,
    quantity: item.quantity,
    unitPrice: item.rate,
    discount: item.discount,
    taxRate: item.product?.taxRate || 0,
    taxTemplateId: item.taxTemplateId,
  }));
}

async function generateInvoiceForSubscription(tx: any, subscription: any) {
  const invoiceNo = await nextNo(tx, 'SALES_INVOICE');
  const normalizedItems = await normalizeInvoiceItems(tx, sourceItems(subscription));
  const totals = calculateInvoiceTotals(normalizedItems);
  const invoice = await tx.salesInvoice.create({
    data: {
      invoiceNo,
      customerId: subscription.customerId,
      date: subscription.nextRunDate,
      dueDate: addMonths(subscription.nextRunDate, 'MONTHLY'),
      status: subscription.autoSubmit ? 'SUBMITTED' : 'DRAFT',
      submittedAt: subscription.autoSubmit ? new Date() : undefined,
      paymentStatus: 'UNPAID',
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discount: totals.discount,
      total: totals.grandTotal,
      grandTotal: totals.grandTotal,
      outstandingAmount: totals.grandTotal,
      amountPaid: new D(0),
      currency: subscription.currency,
      notes: subscription.notes,
      terms: subscription.terms,
      items: { create: totals.lines },
      subscriptionRuns: { create: { subscriptionTemplateId: subscription.id, runDate: subscription.nextRunDate } },
    },
    include: { items: true },
  });
  if (subscription.autoSubmit) {
    await resolveAndSnapshotInvoiceTaxes(tx, invoice.id, invoice);
    await postInvoiceLedger(tx, invoice);
  }
  const nextRunDate = addMonths(subscription.nextRunDate, subscription.frequency);
  await tx.subscriptionTemplate.update({
    where: { id: subscription.id },
    data: { nextRunDate, isActive: subscription.endDate ? nextRunDate <= subscription.endDate : subscription.isActive },
  });
  return invoice;
}

export const getSubscriptions = async (req: Request, res: Response) => {
  try {
    const { isActive, customerId } = req.query as any;
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (customerId) where.customerId = customerId;
    const subscriptions = await prisma.subscriptionTemplate.findMany({
      where,
      include: subscriptionInclude,
      orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
    });
    return success(res, subscriptions.map(serializeSubscription));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createSubscription = async (req: Request, res: Response) => {
  try {
    const { items = [], ...data } = req.body;
    if (!data.name || !data.customerId || !data.startDate || !data.frequency) return error(res, 'Name, customer, frequency, and start date are required', 400);
    if (!items.length) return error(res, 'At least one subscription item is required', 400);

    const subscription = await prisma.$transaction(async (tx) => {
      const normalized = await normalizeInvoiceItems(tx, items);
      return tx.subscriptionTemplate.create({
        data: {
          name: data.name,
          customerId: data.customerId,
          frequency: data.frequency,
          autoSubmit: !!data.autoSubmit,
          isActive: data.isActive ?? true,
          taxInclusive: !!data.taxInclusive,
          currency: data.currency || 'INR',
          notes: data.notes,
          terms: data.terms,
          startDate: new Date(data.startDate),
          endDate: data.endDate ? new Date(data.endDate) : undefined,
          nextRunDate: new Date(data.nextRunDate || data.startDate),
          items: {
            create: normalized.map((item: any) => ({
              productId: item.productId,
              itemCode: item.itemCode || '',
              description: item.description,
              quantity: new D(item.quantity || 1),
              rate: new D(item.rate || item.unitPrice || 0),
              discount: new D(item.discount || 0),
              taxTemplateId: item.taxTemplateId,
            })),
          },
        },
        include: subscriptionInclude,
      });
    });
    return success(res, serializeSubscription(subscription), 'Subscription created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.subscriptionTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return error(res, 'Subscription not found', 404);
    const subscription = await prisma.subscriptionTemplate.update({
      where: { id: existing.id },
      data: {
        name: req.body.name ?? existing.name,
        frequency: req.body.frequency ?? existing.frequency,
        startDate: req.body.startDate ? new Date(req.body.startDate) : existing.startDate,
        endDate: req.body.endDate === '' ? null : req.body.endDate ? new Date(req.body.endDate) : existing.endDate,
        nextRunDate: req.body.nextRunDate ? new Date(req.body.nextRunDate) : existing.nextRunDate,
        autoSubmit: req.body.autoSubmit ?? existing.autoSubmit,
        isActive: req.body.isActive ?? existing.isActive,
        currency: req.body.currency ?? existing.currency,
        notes: req.body.notes ?? existing.notes,
        terms: req.body.terms ?? existing.terms,
      },
      include: subscriptionInclude,
    });
    return success(res, serializeSubscription(subscription), 'Subscription updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const runDueSubscriptions = async (_req: Request, res: Response) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const due = await tx.subscriptionTemplate.findMany({
        where: { isActive: true, nextRunDate: { lte: new Date() }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        include: { items: { include: { product: true } } },
      });
      const generated = [];
      for (const subscription of due) generated.push(await generateInvoiceForSubscription(tx, subscription));
      return generated;
    });
    return success(res, result.map(serializeInvoice), `Generated ${result.length} recurring invoices`);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export async function runDueSubscriptionsJob() {
  const tenants = await prisma.subscriptionTemplate.findMany({ where: { companyId: { not: null } }, distinct: ['companyId'], select: { companyId: true } });
  for (const tenant of tenants) {
    if (!tenant.companyId) continue;
    await runWithTenant(tenant.companyId, () => prisma.$transaction(async (tx) => {
      const lockRows = await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', `subscription-job:${tenant.companyId}`) as Array<{ locked: boolean }>;
      if (!lockRows[0]?.locked) return;
      const due = await tx.subscriptionTemplate.findMany({
        where: { isActive: true, nextRunDate: { lte: new Date() }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        include: { items: { include: { product: true } } },
      });
      for (const subscription of due) await generateInvoiceForSubscription(tx, subscription);
    }));
  }
}
