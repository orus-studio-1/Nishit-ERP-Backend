import { Prisma } from '@prisma/client';
import { postStockLedger } from '../services/inventory/stockLedger.service';
import { fulfillSalesOrderReservation } from '../services/inventory/reservation.service';
import { setAuditContext } from '../middleware/platform';

const D = Prisma.Decimal;

// Does not write to the database itself -- it hands the business context (message,
// statusBefore/After, entityType/Id, diff) to the mutationAudit middleware, which writes
// the single audit row for this request when the response is sent. `tx` is accepted only
// for call-site compatibility and is unused; every audit write goes through the middleware.
export async function audit(tx: any, req: any, input: {
  entityType: any;
  entityId: string;
  action: string;
  statusBefore?: string;
  statusAfter?: string;
  message?: string;
  diff?: any;
  invoiceId?: string;
  deliveryNoteId?: string;
  creditNoteId?: string;
}) {
  // invoiceId/deliveryNoteId/creditNoteId are dropped here -- every caller already
  // passes the same value as entityId, so nothing is lost by not storing them again.
  const { invoiceId, deliveryNoteId, creditNoteId, entityType, ...rest } = input;
  setAuditContext(req, {
    entityType: String(entityType),
    ...rest,
  });
}

export async function ensureAccount(tx: any, code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY') {
  const existing = await tx.account.findFirst({ where: { code } });
  if (existing) return existing;
  return tx.account.create({ data: { code, name, type, rootType: type, currency: 'INR' } });
}

export async function defaultWarehouse(tx: any, warehouseId?: string) {
  if (warehouseId) return tx.warehouse.findUnique({ where: { id: warehouseId } });
  const existing = await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return tx.warehouse.create({ data: { name: 'Main Warehouse', code: 'MAIN', isActive: true } });
}

export async function postStockOut(tx: any, items: any[], reference: string, notes: string, warehouseId?: string, isReversal = false) {
  const warehouse = await defaultWarehouse(tx, warehouseId);
  const multiplier = isReversal ? 1 : -1;
  for (const item of items) {
    const product = item.product || await tx.product.findUnique({ where: { id: item.productId } });
    if (!product || product.type !== 'PRODUCT' || product.maintainStock === false) continue;
    const qty = Number(item.quantity || 0);
    if (!qty) continue;
    const actualQty = new D(qty * multiplier);
    await postStockLedger(tx, {
      productId: item.productId,
      warehouseId: warehouse.id,
      actualQty,
      rate: item.valuationRate || product.costPrice || 0,
      voucherType: 'DELIVERY_NOTE',
      voucherId: item.deliveryNoteId,
      voucherNo: reference,
      remarks: notes,
      batchId: item.batchId,
      serialNoId: item.serialNoId,
    });
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        warehouseId: warehouse.id,
        type: isReversal ? 'RETURN' : 'OUT',
        quantity: qty,
        reference,
        notes,
      },
    });
    if (!isReversal && item.deliveryNote?.salesOrderId) {
      await fulfillSalesOrderReservation(tx, item.deliveryNote.salesOrderId, item.productId, warehouse.id, qty);
    }
  }
}

export async function resolveAndSnapshotInvoiceTaxes(tx: any, invoiceId: string, invoiceInput?: any) {
  const invoice = invoiceInput || await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });
  if (!invoice) return;

  await tx.salesInvoiceTax.deleteMany({ where: { salesInvoiceId: invoiceId } });
  await tx.salesInvoiceItemTax.deleteMany({ where: { salesInvoiceItem: { salesInvoiceId: invoiceId } } });

  const invoiceTaxTotals = new Map<string, any>();
  for (const item of invoice.items) {
    const templateLines = item.taxTemplateId ? await tx.taxTemplateLine.findMany({
      where: { taxTemplateId: item.taxTemplateId },
      orderBy: { rowOrder: 'asc' },
    }) : [];
    const lines = templateLines.length ? templateLines : [{
      id: null,
      label: item.taxRate.gt(0) ? `Manual Tax ${item.taxRate.toString()}%` : 'Zero Rated',
      rate: item.taxRate,
      rowOrder: 0,
      accountId: null,
      chargeType: 'ON_NET_TOTAL',
    }];

    let previousTax = new D(0);
    for (const line of lines) {
      const rate = new D(line.rate || 0);
      const taxableAmount = line.chargeType === 'ON_PREVIOUS_ROW_AMOUNT' || line.chargeType === 'ON_PREVIOUS_ROW_TOTAL'
        ? item.netAmount.plus(previousTax)
        : item.netAmount;
      const taxAmount = taxableAmount.mul(rate.div(100));
      previousTax = previousTax.plus(taxAmount);
      const snapshot = { label: line.label, rate: rate.toString(), chargeType: line.chargeType, taxTemplateId: item.taxTemplateId || null };

      await tx.salesInvoiceItemTax.create({
        data: {
          salesInvoiceItemId: item.id,
          taxTemplateLineId: line.id,
          label: line.label,
          rate,
          taxableAmount,
          taxAmount,
          rowOrder: line.rowOrder || 0,
          snapshot,
        },
      });

      const key = `${line.label}:${line.accountId || ''}:${rate.toString()}`;
      const existing = invoiceTaxTotals.get(key) || {
        taxTemplateLineId: line.id,
        accountId: line.accountId,
        label: line.label,
        rate,
        taxableAmount: new D(0),
        taxAmount: new D(0),
        rowOrder: line.rowOrder || 0,
        snapshot,
      };
      existing.taxableAmount = existing.taxableAmount.plus(taxableAmount);
      existing.taxAmount = existing.taxAmount.plus(taxAmount);
      invoiceTaxTotals.set(key, existing);
    }
  }

  if (invoiceTaxTotals.size) {
    await tx.salesInvoiceTax.createMany({
      data: Array.from(invoiceTaxTotals.values()).map((tax) => ({
        salesInvoiceId: invoiceId,
        ...tax,
      })),
    });
  }
}

export async function recalculateInvoiceAllocations(tx: any, invoiceId: string) {
  const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;
  const directPayments = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  const allocations = await tx.paymentEntryAllocation.aggregate({ where: { invoiceId }, _sum: { allocatedAmount: true } });
  const amountPaid = (directPayments._sum.amount || new D(0)).plus(allocations._sum.allocatedAmount || new D(0));
  const outstandingAmount = invoice.grandTotal.minus(amountPaid);
  const paymentStatus = outstandingAmount.lte(0) ? 'PAID' : amountPaid.gt(0) ? 'PARTIAL' : invoice.dueDate && invoice.dueDate.getTime() < Date.now() ? 'OVERDUE' : 'UNPAID';
  return tx.salesInvoice.update({ where: { id: invoiceId }, data: { amountPaid, outstandingAmount, paymentStatus } });
}

export function addMonths(date: Date, frequency: string) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + (frequency === 'ANNUALLY' ? 12 : frequency === 'QUARTERLY' ? 3 : 1));
  return next;
}
