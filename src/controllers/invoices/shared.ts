import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { calculateInvoiceTotals, serializeInvoice, serializeMoney } from '../../utils/invoice';
import { recalculateInvoiceAllocations } from '../../utils/erp';
import { ensureLedgerAccount, postToLedger, reverseLedgerForVoucher } from '../../services/accounting/ledger.service';

export async function nextDocumentNo(tx: any, documentType: 'SALES_INVOICE' | 'PAYMENT_ENTRY' | 'CREDIT_NOTE') {
  let series = await tx.numberingSeries.findFirst({
    where: { documentType, isActive: true, isDefault: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!series) {
    const prefix = documentType === 'SALES_INVOICE' ? 'INV' : documentType === 'PAYMENT_ENTRY' ? 'PAY' : 'CN';
    series = await tx.numberingSeries.create({
      data: {
        documentType,
        name: `${prefix}-DEFAULT`,
        pattern: `${prefix}-${new Date().getFullYear()}-#####`,
        prefix,
        digits: 5,
        isDefault: true,
      },
    });
  }

  const updated = await tx.numberingSeries.update({
    where: { id: series.id },
    data: { current: { increment: 1 } },
  });

  const digits = '#'.repeat(updated.digits);
  const padded = String(updated.current).padStart(updated.digits, '0');
  return updated.pattern.replace(digits, padded);
}

export function apiStatusToWhere(status?: string) {
  if (!status) return {};
  if (status === 'DRAFT' || status === 'CANCELLED') return { status };
  if (status === 'SENT') return { status: 'SUBMITTED', paymentStatus: 'UNPAID' };
  return { status: 'SUBMITTED', paymentStatus: status };
}

export function invoiceResponse(invoice: any) {
  const serialized = serializeInvoice(invoice);
  if (serialized.status === 'SUBMITTED') {
    serialized.status = serialized.paymentStatus === 'UNPAID' ? 'SENT' : serialized.paymentStatus;
  }
  return serialized;
}

export async function normalizeInvoiceItems(tx: any, items: any[]) {
  const normalized = [];

  for (const item of items) {
    const itemCode = String(item.itemCode || '').trim();
    let product = item.productId ? await tx.product.findUnique({ where: { id: item.productId } }) : null;

    if (!product && itemCode) {
      product = await tx.product.findFirst({
        where: { sku: itemCode },
      });
    }

    if (!product) {
      const fallbackSku = itemCode || `MISC-${Date.now()}-${normalized.length + 1}`;
      const fallbackName = item.description || itemCode || 'Miscellaneous item';
      product = await tx.product.create({
        data: {
          sku: fallbackSku,
          name: fallbackName,
          description: item.description,
          type: 'SERVICE',
          salePrice: new Prisma.Decimal(item.unitPrice ?? item.rate ?? 0),
          taxRate: new Prisma.Decimal(item.taxRate ?? 0),
          isActive: true,
        },
      });
    }

    let taxTemplate = item.taxTemplateId ? await tx.taxTemplate.findFirst({
      where: { id: item.taxTemplateId, isActive: true },
      include: { lines: { orderBy: { rowOrder: 'asc' } } },
    }) : null;
    if (item.taxTemplateId && !taxTemplate) throw new Error('Selected tax template is inactive or not found');
    const templateRate = taxTemplate?.lines?.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line.rate || 0), new Prisma.Decimal(0));

    normalized.push({
      ...item,
      productId: product.id,
      itemCode: itemCode || product.sku,
      description: item.description || product.description || product.name,
      unitPrice: item.unitPrice ?? item.rate ?? product.salePrice,
      taxRate: templateRate ?? item.taxRate ?? product.taxRate ?? 0,
      taxTemplateId: taxTemplate?.id || item.taxTemplateId || undefined,
    });
  }

  return normalized;
}

export async function recalculateInvoicePayment(tx: any, invoiceId: string) {
  await recalculateInvoiceAllocations(tx, invoiceId);
  return tx.salesInvoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude });
}

export const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true, currency: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  salesOrder: { select: { id: true, orderNo: true } },
  deliveryNote: { select: { id: true, deliveryNo: true, status: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, type: true } }, taxTemplate: { select: { id: true, name: true, code: true } }, taxes: true } },
  taxes: true,
  payments: { orderBy: { date: 'desc' as const } },
  paymentAllocations: { include: { paymentEntry: { select: { id: true, paymentNo: true, date: true, method: true, reference: true } } } },
  auditLogs: { orderBy: { createdAt: 'desc' as const }, take: 30 },
};

export async function postInvoiceLedger(tx: any, invoice: any, isReversal = false) {
  if (isReversal) return reverseLedgerForVoucher(tx, 'SALES_INVOICE', invoice.id, new Date());
  const ar = await ensureLedgerAccount(tx, '1100', 'Accounts Receivable', 'ASSET', { isDefaultReceivable: true });
  const sales = await ensureLedgerAccount(tx, '4000', 'Sales Revenue', 'REVENUE');
  const tax = await ensureLedgerAccount(tx, '2100', 'Tax Payable', 'LIABILITY', { isDefaultTax: true });
  const lines: any[] = [
    {
      accountId: ar.id,
      partyType: 'CUSTOMER',
      partyId: invoice.customerId,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      debit: invoice.grandTotal,
      credit: new Prisma.Decimal(0),
      currency: invoice.currency,
      remarks: `${invoice.invoiceNo} receivable`,
    },
    {
      accountId: sales.id,
      partyType: 'CUSTOMER',
      partyId: invoice.customerId,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      debit: new Prisma.Decimal(0),
      credit: invoice.subtotal,
      currency: invoice.currency,
      remarks: `${invoice.invoiceNo} revenue`,
    },
  ];
  if (invoice.taxAmount.gt(0)) {
    lines.push({
      accountId: tax.id,
      partyType: 'CUSTOMER',
      partyId: invoice.customerId,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      debit: new Prisma.Decimal(0),
      credit: invoice.taxAmount,
      currency: invoice.currency,
      taxType: 'OUTPUT',
      remarks: `${invoice.invoiceNo} tax`,
    });
  }
  await postToLedger(tx, { voucherType: 'SALES_INVOICE', voucherId: invoice.id, voucherNo: invoice.invoiceNo, postingDate: invoice.date || new Date(), lines });
}

export async function postPaymentLedger(tx: any, payment: any, invoice: any) {
  const bank = await ensureLedgerAccount(tx, '1000', 'Bank / Cash', 'ASSET', { isDefaultBank: true });
  const ar = await ensureLedgerAccount(tx, '1100', 'Accounts Receivable', 'ASSET', { isDefaultReceivable: true });
  await postToLedger(tx, {
    voucherType: 'PAYMENT_ENTRY',
    voucherId: payment.id,
    voucherNo: payment.paymentNo || payment.reference || payment.id,
    postingDate: payment.date || new Date(),
    lines: [
      {
        accountId: bank.id,
        partyType: 'CUSTOMER',
        partyId: payment.customerId,
        customerId: payment.customerId,
        invoiceId: invoice?.id,
        debit: payment.amount,
        credit: new Prisma.Decimal(0),
        currency: payment.currency,
        remarks: `${payment.paymentNo} received`,
      },
      {
        accountId: ar.id,
        partyType: 'CUSTOMER',
        partyId: payment.customerId,
        customerId: payment.customerId,
        invoiceId: invoice?.id,
        debit: new Prisma.Decimal(0),
        credit: payment.amount,
        currency: payment.currency,
        remarks: `${payment.paymentNo} receivable settlement`,
      },
    ],
  });
}

export async function postPaymentEntryLedger(tx: any, entry: any, isReversal = false) {
  if (isReversal) return reverseLedgerForVoucher(tx, 'PAYMENT_ENTRY', entry.id, new Date());
  const bank = await ensureLedgerAccount(tx, '1000', 'Bank / Cash', 'ASSET', { isDefaultBank: true });
  const ar = await ensureLedgerAccount(tx, '1100', 'Accounts Receivable', 'ASSET', { isDefaultReceivable: true });
  await postToLedger(tx, {
    voucherType: 'PAYMENT_ENTRY',
    voucherId: entry.id,
    voucherNo: entry.paymentNo,
    postingDate: entry.date || new Date(),
    lines: [
      {
        accountId: bank.id,
        partyType: 'CUSTOMER',
        partyId: entry.customerId,
        customerId: entry.customerId,
        paymentEntryId: entry.id,
        debit: entry.paidAmount,
        credit: new Prisma.Decimal(0),
        currency: entry.currency,
        remarks: `${entry.paymentNo} bank receipt`,
      },
      {
        accountId: ar.id,
        partyType: 'CUSTOMER',
        partyId: entry.customerId,
        customerId: entry.customerId,
        paymentEntryId: entry.id,
        debit: new Prisma.Decimal(0),
        credit: entry.paidAmount,
        currency: entry.currency,
        remarks: `${entry.paymentNo} receivable settlement`,
      },
    ],
  });
}

export function serializePaymentEntry(entry: any) {
  return {
    ...entry,
    paidAmount: serializeMoney(entry.paidAmount),
    allocatedAmount: serializeMoney(entry.allocatedAmount),
    unallocatedAmount: serializeMoney(entry.unallocatedAmount),
    allocations: entry.allocations?.map((allocation: any) => ({
      ...allocation,
      allocatedAmount: serializeMoney(allocation.allocatedAmount),
    })),
  };
}
