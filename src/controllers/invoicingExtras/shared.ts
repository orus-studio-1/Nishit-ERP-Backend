import { Prisma } from '@prisma/client';
import { serializeMoney } from '../../utils/invoice';
import { ensureAccount } from '../../utils/erp';

const D = Prisma.Decimal;

export async function nextNo(tx: any, documentType: 'CREDIT_NOTE' | 'SALES_INVOICE') {
  const prefix = documentType === 'CREDIT_NOTE' ? 'CN' : 'INV';
  let series = await tx.numberingSeries.findFirst({ where: { documentType, isDefault: true, isActive: true } });
  if (!series) {
    series = await tx.numberingSeries.create({
      data: { documentType, name: `${prefix}-DEFAULT`, pattern: `${prefix}-${new Date().getFullYear()}-#####`, prefix, digits: 5, isDefault: true },
    });
  }
  const updated = await tx.numberingSeries.update({ where: { id: series.id }, data: { current: { increment: 1 } } });
  return updated.pattern.replace('#'.repeat(updated.digits), String(updated.current).padStart(updated.digits, '0'));
}

export function serializeCreditNote(note: any) {
  return {
    ...note,
    subtotal: serializeMoney(note.subtotal),
    taxAmount: serializeMoney(note.taxAmount),
    grandTotal: serializeMoney(note.grandTotal),
    items: note.items?.map((item: any) => ({
      ...item,
      quantity: serializeMoney(item.quantity),
      rate: serializeMoney(item.rate),
      discount: serializeMoney(item.discount),
      netAmount: serializeMoney(item.netAmount),
      taxAmount: serializeMoney(item.taxAmount),
      total: serializeMoney(item.total),
    })),
  };
}

export async function postCreditNoteLedger(tx: any, note: any, isReversal = false) {
  const ar = await ensureAccount(tx, '1100', 'Accounts Receivable', 'ASSET');
  const salesReturns = await ensureAccount(tx, '4010', 'Sales Returns / Credits', 'REVENUE');
  const tax = await ensureAccount(tx, '2100', 'Tax Payable', 'LIABILITY');
  const factor = isReversal ? -1 : 1;
  const rows: any[] = [
    {
      accountId: salesReturns.id,
      customerId: note.customerId,
      voucherType: isReversal ? 'CANCELLATION' : 'CREDIT_NOTE',
      voucherId: note.id,
      creditNoteId: note.id,
      debit: note.subtotal.mul(factor),
      credit: new D(0),
      currency: note.currency,
      remarks: `${isReversal ? 'Reverse ' : ''}${note.creditNoteNo} sales credit`,
      isReversal,
    },
    {
      accountId: ar.id,
      customerId: note.customerId,
      voucherType: isReversal ? 'CANCELLATION' : 'CREDIT_NOTE',
      voucherId: note.id,
      creditNoteId: note.id,
      debit: new D(0),
      credit: note.grandTotal.mul(factor),
      currency: note.currency,
      remarks: `${isReversal ? 'Reverse ' : ''}${note.creditNoteNo} receivable reduction`,
      isReversal,
    },
  ];
  if (note.taxAmount.gt(0)) {
    rows.push({
      accountId: tax.id,
      customerId: note.customerId,
      voucherType: isReversal ? 'CANCELLATION' : 'CREDIT_NOTE',
      voucherId: note.id,
      creditNoteId: note.id,
      debit: note.taxAmount.mul(factor),
      credit: new D(0),
      currency: note.currency,
      remarks: `${isReversal ? 'Reverse ' : ''}${note.creditNoteNo} tax credit`,
      isReversal,
    });
  }
  await tx.generalLedgerEntry.createMany({ data: rows });
}
