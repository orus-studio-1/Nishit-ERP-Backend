import { Prisma } from '@prisma/client';

export type InvoiceLineInput = {
  salesOrderItemId?: string;
  productId?: string;
  itemCode?: string;
  description?: string;
  quantity: any;
  unitPrice?: number | string;
  rate?: any;
  discount?: any;
  taxRate?: any;
  taxTemplateId?: string;
};

const D = Prisma.Decimal;

export function decimal(value: any, fallback = 0) {
  if (value === undefined || value === null || value === '') return new D(fallback);
  return new D(value);
}

export function calculateInvoiceLines(items: InvoiceLineInput[]) {
  let subtotal = new D(0);
  let taxAmount = new D(0);

  const lines = items.map((item) => {
    const quantity = decimal(item.quantity, 0);
    const rate = decimal(item.unitPrice ?? item.rate, 0);
    const discount = decimal(item.discount, 0);
    const taxRate = decimal(item.taxRate, 0);
    const gross = quantity.mul(rate);
    const netAmount = gross.mul(new D(1).minus(discount.div(100)));
    const lineTaxAmount = netAmount.mul(taxRate.div(100));
    const total = netAmount.plus(lineTaxAmount);

    subtotal = subtotal.plus(netAmount);
    taxAmount = taxAmount.plus(lineTaxAmount);

    return {
      salesOrderItemId: item.salesOrderItemId,
      productId: item.productId,
      itemCode: item.itemCode || '',
      description: item.description,
      quantity,
      unitPrice: rate,
      rate,
      discount,
      taxRate,
      netAmount,
      taxAmount: lineTaxAmount,
      total,
      taxTemplateId: item.taxTemplateId,
    };
  });

  return { lines, subtotal, taxAmount };
}

export function calculateInvoiceTotals(items: InvoiceLineInput[], discountInput?: any) {
  const { lines, subtotal, taxAmount } = calculateInvoiceLines(items);
  const discount = decimal(discountInput, 0);
  const grandTotal = subtotal.plus(taxAmount).minus(discount);
  return { lines, subtotal, taxAmount, discount, grandTotal };
}

export function deriveInvoicePaymentStatus(status: string, dueDate: Date | null | undefined, grandTotal: Prisma.Decimal, amountPaid: Prisma.Decimal) {
  if (status === 'DRAFT' || status === 'CANCELLED') return 'UNPAID';
  const outstanding = grandTotal.minus(amountPaid);
  if (outstanding.lte(0)) return 'PAID';
  if (dueDate && dueDate.getTime() < Date.now()) return 'OVERDUE';
  if (amountPaid.gt(0)) return 'PARTIAL';
  return 'UNPAID';
}

export function serializeMoney(value: any) {
  return value && typeof value.toNumber === 'function' ? value.toNumber() : Number(value || 0);
}

export function serializeInvoice(invoice: any) {
  if (!invoice) return invoice;
  const grandTotal = serializeMoney(invoice.grandTotal ?? invoice.total);
  const amountPaid = serializeMoney(invoice.amountPaid);
  return {
    ...invoice,
    subtotal: serializeMoney(invoice.subtotal),
    taxAmount: serializeMoney(invoice.taxAmount),
    discount: serializeMoney(invoice.discount),
    roundingAdjustment: serializeMoney(invoice.roundingAdjustment),
    grandTotal,
    total: grandTotal,
    amountPaid,
    outstandingAmount: serializeMoney(invoice.outstandingAmount ?? grandTotal - amountPaid),
    items: invoice.items?.map((item: any) => ({
      ...item,
      quantity: serializeMoney(item.quantity),
      rate: serializeMoney(item.rate),
      unitPrice: serializeMoney(item.rate),
      discount: serializeMoney(item.discount),
      taxRate: serializeMoney(item.taxRate),
      netAmount: serializeMoney(item.netAmount),
      taxAmount: serializeMoney(item.taxAmount),
      total: serializeMoney(item.total),
    })),
    payments: invoice.payments?.map((payment: any) => ({
      ...payment,
      amount: serializeMoney(payment.amount),
    })),
  };
}
