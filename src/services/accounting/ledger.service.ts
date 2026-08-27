import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Tx = any;

export type LedgerLineInput = {
  accountId: string;
  debit?: Prisma.Decimal.Value;
  credit?: Prisma.Decimal.Value;
  currency?: string;
  exchangeRate?: Prisma.Decimal.Value;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE';
  partyId?: string;
  customerId?: string;
  costCenterId?: string;
  voucherLineId?: string;
  invoiceId?: string;
  paymentEntryId?: string;
  creditNoteId?: string;
  taxType?: string;
  remarks?: string;
};

async function fiscalContext(tx: Tx, postingDate: Date) {
  let fiscalYear = await tx.fiscalYear.findFirst({
    where: { startDate: { lte: postingDate }, endDate: { gte: postingDate }, isActive: true },
    include: { periods: true },
  });
  if (!fiscalYear) {
    // A standalone ERP must be usable before the accounting settings page is
    // visited. Serialize first-use setup so concurrent inventory postings do
    // not create duplicate fiscal years.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `fiscal-year:${postingDate.getFullYear()}`);
    fiscalYear = await tx.fiscalYear.findFirst({
      where: { startDate: { lte: postingDate }, endDate: { gte: postingDate }, isActive: true },
      include: { periods: true },
    });
    if (!fiscalYear) {
      const startYear = postingDate.getMonth() >= 3 ? postingDate.getFullYear() : postingDate.getFullYear() - 1;
      const startDate = new Date(startYear, 3, 1, 0, 0, 0, 0);
      const endDate = new Date(startYear + 1, 2, 31, 23, 59, 59, 999);
      const periods = Array.from({ length: 12 }, (_, index) => {
        const periodStart = new Date(startYear, 3 + index, 1);
        const periodEnd = new Date(startYear, 4 + index, 0, 23, 59, 59, 999);
        return { name: periodStart.toLocaleString('en-IN', { month: 'short', year: 'numeric' }), startDate: periodStart, endDate: periodEnd };
      });
      fiscalYear = await tx.fiscalYear.create({
        data: { name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`, startDate, endDate, isActive: true, isClosed: false, periods: { create: periods } },
        include: { periods: true },
      });
    }
  }
  if (fiscalYear.isClosed) throw new Error(`Fiscal year ${fiscalYear.name} is closed`);
  const period = fiscalYear.periods.find((p: any) => p.startDate <= postingDate && p.endDate >= postingDate);
  if (!period) throw new Error(`No accounting period exists for ${postingDate.toISOString().slice(0, 10)} in fiscal year ${fiscalYear.name}`);
  if (period?.isClosed) throw new Error(`Accounting period ${period.name} is closed`);
  return { fiscalYearId: fiscalYear.id, periodId: period.id };
}

export async function ensureLedgerAccount(tx: Tx, code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY', flags: any = {}) {
  const existing = await tx.account.findFirst({ where: { code } });
  if (existing) {
    return tx.account.update({ where: { id: existing.id }, data: { ...flags, isGroup: false, isActive: true } });
  }
  return tx.account.create({ data: { code, name, type, rootType: type, currency: 'USD', isGroup: false, ...flags } });
}

async function validateAccounts(tx: Tx, lines: LedgerLineInput[], postingDate: Date) {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: ids } } });
  const map = new Map<string, any>(accounts.map((account: any) => [account.id, account]));
  for (const line of lines) {
    const account = map.get(line.accountId);
    if (!account) throw new Error('Ledger account not found');
    if (!account.isActive) throw new Error(`Account ${account.name} is inactive`);
    if (account.isGroup) throw new Error(`Cannot post to group account ${account.name}`);
    if (account.freezeAccount && account.frozenTillDate && postingDate <= account.frozenTillDate) {
      throw new Error(`Account ${account.name} is frozen until ${account.frozenTillDate.toISOString().slice(0, 10)}`);
    }
  }
}

export async function recomputeAccountBalances(tx: Tx, accountIds: string[]) {
  for (const accountId of [...new Set(accountIds)]) {
    const rows = await tx.generalLedgerEntry.findMany({ where: { accountId, isCancelled: false } });
    const balance = rows.reduce((sum: Prisma.Decimal, row: any) => sum.plus(row.debitBase || row.debit || 0).minus(row.creditBase || row.credit || 0), new D(0));
    await tx.account.update({ where: { id: accountId }, data: { balance } });
  }
}

export async function postToLedger(tx: Tx, input: {
  voucherType: any;
  voucherId: string;
  voucherNo?: string;
  postingDate?: Date;
  createdById?: string;
  isReversal?: boolean;
  reversalOfId?: string;
  lines: LedgerLineInput[];
}): Promise<{ fiscalYearId: string; periodId: string | null }> {
  const postingDate = input.postingDate || new Date();
  if (!input.lines.length) throw new Error('At least one ledger line is required');
  const totalDebit = input.lines.reduce((sum, line) => sum.plus(line.debit || 0), new D(0));
  const totalCredit = input.lines.reduce((sum, line) => sum.plus(line.credit || 0), new D(0));
  if (!totalDebit.eq(totalCredit)) throw new Error(`Ledger posting is not balanced: debit ${totalDebit.toString()} credit ${totalCredit.toString()}`);
  await validateAccounts(tx, input.lines, postingDate);
  const context = await fiscalContext(tx, postingDate);

  const data = input.lines.map((line) => {
    const exchangeRate = new D(line.exchangeRate || 1);
    const debit = new D(line.debit || 0);
    const credit = new D(line.credit || 0);
    return {
      postingDate,
      fiscalYearId: context.fiscalYearId,
      periodId: context.periodId,
      accountId: line.accountId,
      customerId: line.customerId || (line.partyType === 'CUSTOMER' ? line.partyId : undefined),
      partyType: line.partyType,
      partyId: line.partyId,
      costCenterId: line.costCenterId,
      voucherType: input.voucherType,
      voucherId: input.voucherId,
      voucherLineId: line.voucherLineId,
      invoiceId: line.invoiceId,
      paymentEntryId: line.paymentEntryId,
      creditNoteId: line.creditNoteId,
      debit,
      credit,
      currency: line.currency || 'USD',
      exchangeRate,
      debitBase: debit.mul(exchangeRate),
      creditBase: credit.mul(exchangeRate),
      taxType: line.taxType,
      remarks: line.remarks || input.voucherNo,
      isReversal: input.isReversal || false,
      reversalOfId: input.reversalOfId,
      createdById: input.createdById,
    };
  });
  await tx.generalLedgerEntry.createMany({ data });
  await recomputeAccountBalances(tx, data.map((line) => line.accountId));
  return context;
}

export async function reverseLedgerForVoucher(tx: Tx, voucherType: any, voucherId: string, postingDate = new Date(), createdById?: string) {
  const existing = await tx.generalLedgerEntry.findMany({ where: { voucherType, voucherId, isCancelled: false } });
  if (!existing.length) return;
  await postToLedger(tx, {
    voucherType: 'CANCELLATION',
    voucherId,
    postingDate,
    createdById,
    isReversal: true,
    lines: existing.map((row: any) => ({
      accountId: row.accountId,
      debit: row.credit,
      credit: row.debit,
      currency: row.currency,
      exchangeRate: row.exchangeRate,
      partyType: row.partyType,
      partyId: row.partyId,
      customerId: row.customerId,
      costCenterId: row.costCenterId,
      invoiceId: row.invoiceId,
      paymentEntryId: row.paymentEntryId,
      creditNoteId: row.creditNoteId,
      taxType: row.taxType,
      remarks: `Reversal of ${row.voucherType} ${row.voucherId}`,
    })),
  });
  await tx.generalLedgerEntry.updateMany({ where: { voucherType, voucherId, isCancelled: false }, data: { isCancelled: true } });
  await recomputeAccountBalances(tx, existing.map((line: any) => line.accountId));
}
