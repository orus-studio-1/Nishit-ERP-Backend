import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, paginated, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { generateJournalNo } from '../utils/generate';
import { postToLedger, reverseLedgerForVoucher } from '../services/accounting/ledger.service';
import { pickDefined } from '../utils/payload';

function lineTotals(lines: any[] = []) {
  return lines.reduce((acc, line) => ({ debit: acc.debit + Number(line.debit || 0), credit: acc.credit + Number(line.credit || 0) }), { debit: 0, credit: 0 });
}

function validateJournalPayload(lines: any[] = []) {
  if (!Array.isArray(lines) || !lines.length) return 'At least one journal line is required';
  const totals = lineTotals(lines);
  if (Math.abs(totals.debit - totals.credit) > 0.000001) return 'Total debit must equal total credit';
  if (totals.debit <= 0) return 'Journal entry amount must be greater than zero';
  for (const line of lines) {
    if (Number(line.debit || 0) < 0 || Number(line.credit || 0) < 0) return 'Debit and credit cannot be negative';
    if (Number(line.debit || 0) > 0 && !line.debitAccountId) return 'Debit account is required for debit lines';
    if (Number(line.credit || 0) > 0 && !line.creditAccountId) return 'Credit account is required for credit lines';
  }
  return null;
}

// ---- ACCOUNTS ----
export const getAccounts = async (req: Request, res: Response) => {
  try {
    const { type, search } = req.query as any;
    const where: any = {};
    if (type) where.type = type;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const accounts = await prisma.account.findMany({
      where,
      include: { parent: { select: { name: true, code: true } }, children: { select: { id: true, name: true, code: true } } },
      orderBy: { code: 'asc' },
    });
    return success(res, accounts);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getAccount = async (req: Request, res: Response) => {
  try {
    const account = await prisma.account.findUnique({
      where: { id: req.params.id },
      include: { parent: true, children: true },
    });
    if (!account) return error(res, 'Account not found', 404);
    return success(res, account);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createAccount = async (req: Request, res: Response) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const type = String(req.body.type || '').toUpperCase();
    const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
    if (!code || !name || !type) return error(res, 'Code, name and type are required.', 400);
    if (!validTypes.includes(type)) return error(res, 'Select a valid account type.', 400);

    let frozenTillDate: Date | null = null;
    if (req.body.freezeAccount && req.body.frozenTillDate) {
      frozenTillDate = new Date(`${String(req.body.frozenTillDate).slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(frozenTillDate.getTime())) return error(res, 'Frozen Till must be a valid date.', 400);
    }

    const parentId = req.body.parentId ? String(req.body.parentId) : null;
    if (parentId) {
      const parent = await prisma.account.findFirst({ where: { id: parentId } });
      if (!parent) return error(res, 'The selected parent account does not exist.', 400);
      if (!parent.isGroup) return error(res, 'The selected parent must be a group account.', 400);
    }

    const account = await prisma.account.create({
      data: {
        code,
        name,
        type: type as any,
        rootType: type as any,
        subType: req.body.subType ? String(req.body.subType).trim() : null,
        parentId,
        description: req.body.description ? String(req.body.description).trim() : null,
        currency: String(req.body.currency || 'INR').trim().toUpperCase(),
        isGroup: Boolean(req.body.isGroup),
        freezeAccount: Boolean(req.body.freezeAccount),
        frozenTillDate,
        isDefaultCash: Boolean(req.body.isDefaultCash),
        isDefaultBank: Boolean(req.body.isDefaultBank),
        isDefaultReceivable: Boolean(req.body.isDefaultReceivable),
        isDefaultPayable: Boolean(req.body.isDefaultPayable),
        isDefaultTax: Boolean(req.body.isDefaultTax),
        isDefaultRoundOff: Boolean(req.body.isDefaultRoundOff),
        isDefaultRetainedEarnings: Boolean(req.body.isDefaultRetainedEarnings),
      },
    });
    return success(res, account, 'Account created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateAccount = async (req: Request, res: Response) => {
  try {
    const data = pickDefined(req.body, ['code', 'name', 'type', 'subType', 'parentId', 'description', 'rootType', 'isGroup', 'freezeAccount', 'frozenTillDate', 'isDefaultCash', 'isDefaultBank', 'isDefaultReceivable', 'isDefaultPayable', 'isDefaultTax', 'isDefaultRoundOff', 'isDefaultRetainedEarnings', 'isActive', 'currency']);
    const account = await prisma.account.update({ where: { id: req.params.id }, data: data as any });
    return success(res, account, 'Account updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteAccount = async (req: Request, res: Response) => {
  try {
    await prisma.account.delete({ where: { id: req.params.id } });
    return success(res, null, 'Account deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

// ---- JOURNAL ENTRIES ----
export const getJournalEntries = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { status, search } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (search) where.OR = [
      { entryNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];

    const [items, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { debitAccount: true, creditAccount: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.journalEntry.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getJournalEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { debitAccount: true, creditAccount: true } } },
    });
    if (!entry) return error(res, 'Journal entry not found', 404);
    return success(res, entry);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createJournalEntry = async (req: Request, res: Response) => {
  try {
    const { date, description, reference, lines } = req.body;
    const validation = validateJournalPayload(lines);
    if (validation) return error(res, validation, 400);
    const entryNumber = await generateJournalNo();

    const totalDebit = lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);

    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber,
        date: new Date(date),
        description,
        reference,
        referenceType: req.body.referenceType,
        referenceId: req.body.referenceId,
        entryType: req.body.entryType || 'STANDARD',
        totalDebit,
        totalCredit,
        lines: { create: lines },
      },
      include: { lines: { include: { debitAccount: true, creditAccount: true } } },
    });
    return success(res, entry, 'Journal entry created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const postJournalEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.journalEntry.findUnique({ where: { id: req.params.id }, include: { lines: true } });
      if (!existing) throw new Error('Entry not found');
      if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') throw new Error('Only draft entries can be posted');
      const validation = validateJournalPayload(existing.lines);
      if (validation) throw new Error(validation);
      const context = await postToLedger(tx, {
        voucherType: 'JOURNAL_ENTRY',
        voucherId: existing.id,
        voucherNo: existing.entryNumber,
        postingDate: existing.date,
        lines: existing.lines.flatMap((line: any) => {
          const rows = [];
          if (Number(line.debit) > 0) rows.push({ accountId: line.debitAccountId, debit: line.debit, credit: 0, currency: line.currency, exchangeRate: line.exchangeRate, costCenterId: line.costCenterId, voucherLineId: line.id, remarks: line.description || existing.description });
          if (Number(line.credit) > 0) rows.push({ accountId: line.creditAccountId, debit: 0, credit: line.credit, currency: line.currency, exchangeRate: line.exchangeRate, costCenterId: line.costCenterId, voucherLineId: line.id, remarks: line.description || existing.description });
          return rows;
        }),
      });
      return tx.journalEntry.update({
        where: { id: existing.id },
        data: { status: 'POSTED', fiscalYearId: context.fiscalYearId, periodId: context.periodId },
        include: { lines: { include: { debitAccount: true, creditAccount: true } } },
      });
    });
    return success(res, entry, 'Journal entry posted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const cancelJournalEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.journalEntry.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Entry not found');
      if (existing.status !== 'POSTED') throw new Error('Only posted entries can be cancelled');
      await reverseLedgerForVoucher(tx, 'JOURNAL_ENTRY', existing.id, new Date());
      return tx.journalEntry.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
    });
    return success(res, entry, 'Journal entry cancelled');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const deleteJournalEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return error(res, 'Entry not found', 404);
    if (entry.status === 'POSTED') return error(res, 'Cannot delete posted entry', 400);
    await prisma.journalEntry.delete({ where: { id: req.params.id } });
    return success(res, null, 'Journal entry deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

// ---- FISCAL YEARS ----
export const getFiscalYears = async (req: Request, res: Response) => {
  try {
    const years = await prisma.fiscalYear.findMany({ include: { periods: true }, orderBy: { startDate: 'desc' } });
    return success(res, years);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createFiscalYear = async (req: Request, res: Response) => {
  try {
    const { name, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) return error(res, 'name, startDate and endDate are required', 400);
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periods = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const periodStart = new Date(cursor);
      const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      if (periodEnd > end) periodEnd.setTime(end.getTime());
      periods.push({ name: periodStart.toLocaleString('en-US', { month: 'short', year: 'numeric' }), startDate: periodStart, endDate: periodEnd });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
    const year = await prisma.fiscalYear.create({ data: { ...req.body, startDate: start, endDate: end, periods: { create: periods } }, include: { periods: true } });
    return success(res, year, 'Fiscal year created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updatePeriod = async (req: Request, res: Response) => {
  try {
    const period = await prisma.period.update({ where: { id: req.params.id }, data: pickDefined(req.body, ['name', 'startDate', 'endDate', 'fiscalYearId', 'isClosed']) as any });
    return success(res, period, 'Period updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getCostCenters = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.costCenter.findMany({ include: { parent: true, children: true }, orderBy: { code: 'asc' } });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createCostCenter = async (req: Request, res: Response) => {
  try {
    if (!req.body.code || !req.body.name) return error(res, 'code and name are required', 400);
    const item = await prisma.costCenter.create({ data: pickDefined(req.body, ['code', 'name', 'parentId', 'isGroup', 'isActive']) as any });
    return success(res, item, 'Cost center created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBudgets = async (req: Request, res: Response) => {
  try {
    const budgets = await prisma.budget.findMany({
      where: req.query.fiscalYearId ? { fiscalYearId: String(req.query.fiscalYearId) } : {},
      include: { account: true, costCenter: true },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, budgets);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createBudget = async (req: Request, res: Response) => {
  try {
    const { fiscalYearId, accountId, amount } = req.body;
    if (!fiscalYearId || !accountId || amount === undefined) return error(res, 'fiscalYearId, accountId and amount are required', 400);
    const budget = await prisma.budget.create({ data: { ...req.body, amount } });
    return success(res, budget, 'Budget created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getGLEntries = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const { accountId, fromDate, toDate, voucherType, partyType, partyId, costCenterId } = req.query as any;
    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (voucherType) where.voucherType = voucherType;
    if (partyType) where.partyType = partyType;
    if (partyId) where.partyId = partyId;
    if (costCenterId) where.costCenterId = costCenterId;
    if (fromDate || toDate) where.postingDate = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
    const [items, total] = await Promise.all([
      prisma.generalLedgerEntry.findMany({ where, include: { account: true, costCenter: true }, orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.generalLedgerEntry.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

// ---- REPORTS ----
export const getTrialBalance = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, asOf } = req.query as any;
    const dateWhere: any = {};
    if (fromDate || toDate || asOf) dateWhere.postingDate = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...((toDate || asOf) ? { lte: new Date(toDate || asOf) } : {}) };
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      include: {
        ledgerEntries: { where: { ...dateWhere, isCancelled: false }, select: { debitBase: true, creditBase: true } },
      },
      orderBy: { code: 'asc' },
    });

    const report = accounts.map(acc => ({
      id: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      debit: acc.ledgerEntries.reduce((s, l) => s + Number(l.debitBase), 0),
      credit: acc.ledgerEntries.reduce((s, l) => s + Number(l.creditBase), 0),
      totalDebit: acc.ledgerEntries.reduce((s, l) => s + Number(l.debitBase), 0),
      totalCredit: acc.ledgerEntries.reduce((s, l) => s + Number(l.creditBase), 0),
    }));

    return success(res, report);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getProfitAndLoss = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, costCenterId } = req.query as any;
    const where: any = { isCancelled: false, account: { type: { in: ['REVENUE', 'EXPENSE'] } } };
    if (costCenterId) where.costCenterId = costCenterId;
    if (fromDate || toDate) where.postingDate = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
    const rows = await prisma.generalLedgerEntry.findMany({ where, include: { account: true } });
    const byAccount = new Map<string, any>();
    rows.forEach((row: any) => {
      const current = byAccount.get(row.accountId) || { accountCode: row.account.code, accountName: row.account.name, accountType: row.account.type, amount: 0 };
      const signed = row.account.type === 'REVENUE' ? Number(row.creditBase) - Number(row.debitBase) : Number(row.debitBase) - Number(row.creditBase);
      current.amount += signed;
      byAccount.set(row.accountId, current);
    });
    const lines = Array.from(byAccount.values());
    const income = lines.filter((l) => l.accountType === 'REVENUE').reduce((s, l) => s + l.amount, 0);
    const expense = lines.filter((l) => l.accountType === 'EXPENSE').reduce((s, l) => s + l.amount, 0);
    return success(res, { lines, income, expense, netProfit: income - expense });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
  try {
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date();
    const accounts = await prisma.account.findMany({
      where: { type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] }, isActive: true },
      include: { ledgerEntries: { where: { postingDate: { lte: asOf }, isCancelled: false } } },
      orderBy: { code: 'asc' },
    });
    const lines = accounts.map((account: any) => {
      const balance = account.ledgerEntries.reduce((s: number, row: any) => s + Number(row.debitBase) - Number(row.creditBase), 0);
      return { accountCode: account.code, accountName: account.name, accountType: account.type, balance: account.type === 'ASSET' ? balance : -balance };
    });
    return success(res, {
      asOf,
      assets: lines.filter((l) => l.accountType === 'ASSET'),
      liabilities: lines.filter((l) => l.accountType === 'LIABILITY'),
      equity: lines.filter((l) => l.accountType === 'EQUITY'),
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getCashFlow = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as any;
    const where: any = { isCancelled: false, account: { OR: [{ isDefaultCash: true }, { isDefaultBank: true }, { subType: { contains: 'Cash', mode: 'insensitive' } }] } };
    if (fromDate || toDate) where.postingDate = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
    const rows = await prisma.generalLedgerEntry.findMany({ where, include: { account: true } });
    const netCashFlow = rows.reduce((s: number, row: any) => s + Number(row.debitBase) - Number(row.creditBase), 0);
    return success(res, { netCashFlow, lines: rows });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBudgetVsActual = async (req: Request, res: Response) => {
  try {
    const budgets = await prisma.budget.findMany({ where: req.query.fiscalYearId ? { fiscalYearId: String(req.query.fiscalYearId) } : {}, include: { account: true, costCenter: true } });
    const rows = [];
    for (const budget of budgets as any[]) {
      const entries = await prisma.generalLedgerEntry.findMany({ where: { accountId: budget.accountId, costCenterId: budget.costCenterId || undefined, isCancelled: false } });
      const actual = entries.reduce((s: number, row: any) => s + Number(row.debitBase) - Number(row.creditBase), 0);
      rows.push({ account: budget.account, costCenter: budget.costCenter, budget: Number(budget.amount), actual, variance: Number(budget.amount) - actual });
    }
    return success(res, rows);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createBankStatementLine = async (req: Request, res: Response) => {
  try {
    const { accountId, statementDate, description } = req.body;
    if (!accountId || !statementDate || !description) return error(res, 'accountId, statementDate and description are required', 400);
    const line = await prisma.bankStatementLine.create({ data: { ...req.body, statementDate: new Date(statementDate) } });
    return success(res, line, 'Bank statement line created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBankStatementLines = async (req: Request, res: Response) => {
  try {
    const lines = await prisma.bankStatementLine.findMany({ where: req.query.accountId ? { accountId: String(req.query.accountId) } : {}, include: { account: true }, orderBy: { statementDate: 'desc' } });
    return success(res, lines);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const reconcileBankLine = async (req: Request, res: Response) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const line = await tx.bankStatementLine.update({ where: { id: req.params.id }, data: { matchedLedgerEntryId: req.body.ledgerEntryId, isReconciled: true } });
      await tx.generalLedgerEntry.update({ where: { id: req.body.ledgerEntryId }, data: { reconciliationStatus: 'RECONCILED', bankStatementLineId: line.id } });
      return line;
    });
    return success(res, result, 'Bank line reconciled');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBankReconciliation = async (req: Request, res: Response) => {
  try {
    const accountId = String(req.query.accountId || '');
    if (!accountId) return error(res, 'accountId is required', 400);
    const [gl, bank] = await Promise.all([
      prisma.generalLedgerEntry.findMany({ where: { accountId, isCancelled: false }, include: { account: true } }),
      prisma.bankStatementLine.findMany({ where: { accountId } }),
    ]);
    const bookBalance = gl.reduce((s: number, row: any) => s + Number(row.debitBase) - Number(row.creditBase), 0);
    const bankBalance = bank.reduce((s: number, row: any) => s + Number(row.debit) - Number(row.credit), 0);
    return success(res, { bookBalance, bankBalance, difference: bankBalance - bookBalance, unreconciledGL: gl.filter((row: any) => row.reconciliationStatus !== 'RECONCILED'), unreconciledBank: bank.filter((row: any) => !row.isReconciled) });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getArApLedger = async (req: Request, res: Response) => {
  try {
    const partyType = (req.query.partyType as any) || 'CUSTOMER';
    const rows = await prisma.generalLedgerEntry.findMany({ where: { partyType, isCancelled: false }, include: { account: true }, orderBy: { postingDate: 'desc' } });
    const grouped = new Map<string, any>();
    rows.forEach((row: any) => {
      const key = row.partyId || row.customerId || 'UNKNOWN';
      const current = grouped.get(key) || { partyId: key, debit: 0, credit: 0, outstanding: 0, entries: [] };
      current.debit += Number(row.debitBase);
      current.credit += Number(row.creditBase);
      current.outstanding = current.debit - current.credit;
      current.entries.push(row);
      grouped.set(key, current);
    });
    return success(res, Array.from(grouped.values()));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getTaxLedger = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as any;
    const where: any = { isCancelled: false, OR: [{ taxType: { not: null } }, { account: { isDefaultTax: true } }] };
    if (fromDate || toDate) where.postingDate = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
    const rows = await prisma.generalLedgerEntry.findMany({ where, include: { account: true }, orderBy: { postingDate: 'desc' } });
    return success(res, { rows, totalTaxDebit: rows.reduce((s, r: any) => s + Number(r.debitBase), 0), totalTaxCredit: rows.reduce((s, r: any) => s + Number(r.creditBase), 0) });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPeriodClosingVoucher = async (req: Request, res: Response) => {
  try {
    const { fiscalYearId, retainedEarningsAccountId, postingDate, remarks } = req.body;
    if (!fiscalYearId || !retainedEarningsAccountId) return error(res, 'fiscalYearId and retainedEarningsAccountId are required', 400);
    const count = await prisma.periodClosingVoucher.count();
    const voucher = await prisma.periodClosingVoucher.create({ data: { closingNo: `PCV-${String(count + 1).padStart(5, '0')}`, fiscalYearId, retainedEarningsAccountId, postingDate: postingDate ? new Date(postingDate) : new Date(), remarks } });
    return success(res, voucher, 'Period closing voucher created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const submitPeriodClosingVoucher = async (req: Request, res: Response) => {
  try {
    const voucher = await prisma.$transaction(async (tx) => {
      const existing = await tx.periodClosingVoucher.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Closing voucher not found');
      if (existing.status !== 'DRAFT') throw new Error('Only draft closing vouchers can be submitted');
      const entries = await tx.generalLedgerEntry.findMany({ where: { fiscalYearId: existing.fiscalYearId, isCancelled: false, account: { type: { in: ['REVENUE', 'EXPENSE'] } } }, include: { account: true } });
      const lines = entries.reduce((acc: any[], row: any) => {
        const net = new Prisma.Decimal(row.debitBase).minus(row.creditBase);
        if (net.eq(0)) return acc;
        acc.push({ accountId: row.accountId, debit: net.lt(0) ? net.abs() : 0, credit: net.gt(0) ? net : 0, remarks: 'Year-end close' });
        return acc;
      }, []);
      const netIncome = lines.reduce((s: Prisma.Decimal, l: any) => s.plus(l.credit || 0).minus(l.debit || 0), new Prisma.Decimal(0));
      if (!netIncome.eq(0)) lines.push({ accountId: existing.retainedEarningsAccountId, debit: netIncome.gt(0) ? 0 : netIncome.abs(), credit: netIncome.gt(0) ? netIncome : 0, remarks: 'Retained earnings close' });
      if (lines.length) await postToLedger(tx, { voucherType: 'PERIOD_CLOSING', voucherId: existing.id, voucherNo: existing.closingNo, postingDate: existing.postingDate, lines });
      await tx.fiscalYear.update({ where: { id: existing.fiscalYearId }, data: { isClosed: true } });
      return tx.periodClosingVoucher.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    });
    return success(res, voucher, 'Period closing voucher submitted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const getJournalTemplates = async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.journalEntryTemplate.findMany({ include: { lines: true, recurringEntries: true }, orderBy: { createdAt: 'desc' } });
    return success(res, templates);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createJournalTemplate = async (req: Request, res: Response) => {
  try {
    const { name, lines = [] } = req.body;
    if (!name || !lines.length) return error(res, 'name and lines are required', 400);
    const template = await prisma.journalEntryTemplate.create({ data: { name, description: req.body.description, lines: { create: lines } }, include: { lines: true } });
    return success(res, template, 'Journal template created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createRecurringJournal = async (req: Request, res: Response) => {
  try {
    const { templateId, frequency, nextRunDate } = req.body;
    if (!templateId || !frequency || !nextRunDate) return error(res, 'templateId, frequency and nextRunDate are required', 400);
    const recurring = await prisma.recurringJournalEntry.create({ data: { templateId, frequency, nextRunDate: new Date(nextRunDate), endDate: req.body.endDate ? new Date(req.body.endDate) : undefined } });
    return success(res, recurring, 'Recurring journal created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getFixedAssets = async (_req: Request, res: Response) => {
  try {
    const assets = await prisma.fixedAsset.findMany({ include: { account: true }, orderBy: { createdAt: 'desc' } });
    return success(res, assets);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createFixedAsset = async (req: Request, res: Response) => {
  try {
    const { assetNo, name, accountId, acquisitionDate, cost, usefulLifeMonths } = req.body;
    if (!assetNo || !name || !accountId || !acquisitionDate || !cost || !usefulLifeMonths) return error(res, 'assetNo, name, accountId, acquisitionDate, cost and usefulLifeMonths are required', 400);
    const asset = await prisma.fixedAsset.create({ data: { ...req.body, acquisitionDate: new Date(acquisitionDate), cost, salvageValue: req.body.salvageValue || 0 } });
    return success(res, asset, 'Fixed asset created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const postAssetDepreciation = async (req: Request, res: Response) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({ where: { id: req.params.id } });
      if (!asset) throw new Error('Fixed asset not found');
      const accumulated = asset.accumulatedDepreciationAccountId ? await tx.account.findUnique({ where: { id: asset.accumulatedDepreciationAccountId } }) : await tx.account.findFirst({ where: { code: '1210' } });
      const expense = asset.depreciationExpenseAccountId ? await tx.account.findUnique({ where: { id: asset.depreciationExpenseAccountId } }) : await tx.account.findFirst({ where: { code: '5200' } });
      const acc = accumulated || await tx.account.create({ data: { code: '1210', name: 'Accumulated Depreciation', type: 'ASSET', rootType: 'ASSET' } });
      const dep = expense || await tx.account.create({ data: { code: '5200', name: 'Depreciation Expense', type: 'EXPENSE', rootType: 'EXPENSE' } });
      const monthly = new Prisma.Decimal(asset.cost).minus(asset.salvageValue).div(asset.usefulLifeMonths);
      await postToLedger(tx, { voucherType: 'ASSET_DEPRECIATION', voucherId: asset.id, voucherNo: asset.assetNo, postingDate: req.body.postingDate ? new Date(req.body.postingDate) : new Date(), lines: [{ accountId: dep.id, debit: monthly, credit: 0, remarks: `Depreciation ${asset.assetNo}` }, { accountId: acc.id, debit: 0, credit: monthly, remarks: `Accumulated depreciation ${asset.assetNo}` }] });
      return asset;
    });
    return success(res, result, 'Depreciation posted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
