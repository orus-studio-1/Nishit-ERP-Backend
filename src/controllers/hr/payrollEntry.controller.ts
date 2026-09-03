import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { employeeInclude, getEmployeeForUser } from './shared';

async function nextPayrollNumber(tx: any, prefix: string) {
  const count = await tx.payrollEntry.count();
  return `${prefix}-${String(count + 1).padStart(5, '0')}`;
}

async function nextSlipNumber(tx: any, month: number, year: number, index: number) {
  const count = await tx.salarySlip.count();
  return `SAL-${year}-${String(month).padStart(2, '0')}-${String(count + index + 1).padStart(5, '0')}`;
}

function payrollPeriod(month: number, year: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end, days: end.getDate() };
}

function evaluateFormula(formula: string | null | undefined, ctx: Record<string, number>) {
  if (!formula) return null;
  const expression = formula
    .replace(/\bbase\b/g, String(ctx.base || 0))
    .replace(/\bgross\b/g, String(ctx.gross || 0))
    .replace(/\bdaysWorked\b/g, String(ctx.daysWorked || 0))
    .replace(/\bmonthDays\b/g, String(ctx.monthDays || 0));
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) throw new Error(`Unsupported salary formula: ${formula}`);
  return Function(`"use strict"; return (${expression});`)();
}

function componentAmount(componentRow: any, ctx: Record<string, number>) {
  const formula = componentRow.formula || componentRow.salaryComponent?.formula;
  const evaluated = evaluateFormula(formula, ctx);
  if (evaluated !== null && evaluated !== undefined && Number.isFinite(Number(evaluated))) return Number(evaluated);
  const configured = Number(componentRow.amount || 0);
  if (configured !== 0) return configured;
  const defaultAmount = Number(componentRow.salaryComponent?.defaultAmount || 0);
  if (defaultAmount !== 0) return defaultAmount;
  return componentRow.salaryComponent?.type === 'EARNING' ? Number(ctx.base || 0) : 0;
}

export const getPayrollEntries = async (req: Request, res: Response) => {
  try {
    const where: any = {};
    if (req.query.month) where.month = Number(req.query.month);
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.status) where.status = req.query.status;
    const items = await prisma.payrollEntry.findMany({
      where,
      include: { salarySlips: { include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const generatePayrollEntry = async (req: Request, res: Response) => {
  try {
    const { month, year, notes } = req.body;
    const numericMonth = Number(month);
    const numericYear = Number(year);
    if (!numericMonth || !numericYear || numericMonth < 1 || numericMonth > 12) return error(res, 'Valid month and year are required', 400);
    const period = payrollPeriod(numericMonth, numericYear);
    const existing = await prisma.payrollEntry.findFirst({
      where: { month: numericMonth, year: numericYear },
      include: { salarySlips: { include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, items: true } } },
    });
    if (existing) return success(res, existing, 'Payroll entry already exists');

    const employees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'PROBATION'] }, user: { companyId: (req as any).user?.companyId || '__missing_company__' } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        salaryAssignments: {
          where: {
            fromDate: { lte: period.end },
            OR: [{ toDate: null }, { toDate: { gte: period.start } }],
          },
          include: { salaryStructure: { include: { components: { include: { salaryComponent: true }, orderBy: { idx: 'asc' } } } } },
          orderBy: { fromDate: 'desc' },
          take: 1,
        },
        attendance: { where: { date: { gte: period.start, lte: period.end } } },
      },
    });

    const entry = await prisma.$transaction(async (tx) => {
      const payrollEntry = await tx.payrollEntry.create({
        data: { payrollNo: await nextPayrollNumber(tx, `PAY-${numericYear}`), month: numericMonth, year: numericYear, postingDate: period.end, notes },
      });
      let totalGross = new Prisma.Decimal(0);
      let totalDeduction = new Prisma.Decimal(0);
      let totalNet = new Prisma.Decimal(0);
      const skipped: string[] = [];

      for (let i = 0; i < employees.length; i += 1) {
        const emp: any = employees[i];
        const assignment = emp.salaryAssignments[0];
        if (!assignment?.salaryStructure?.components?.length) {
          skipped.push(`${emp.employeeId} has no active salary structure`);
          continue;
        }
        const base = Number(assignment?.baseSalary || emp.salary || 0);
        const presentDays = emp.attendance.filter((row: any) => ['PRESENT', 'LATE', 'ON_LEAVE'].includes(row.status)).length;
        const halfDays = emp.attendance.filter((row: any) => row.status === 'HALF_DAY').length;
        const daysWorked = presentDays + halfDays * 0.5;
        let runningGross = 0;
        const lines = assignment.salaryStructure.components.map((c: any, idx: number) => {
          const amount = componentAmount(c, { base, gross: runningGross, daysWorked: daysWorked || period.days, monthDays: period.days });
          if (['EARNING', 'BENEFIT'].includes(c.salaryComponent?.type)) runningGross += amount;
          return {
            salaryComponentId: c.salaryComponent?.id || undefined,
            type: c.salaryComponent?.type || 'EARNING',
            name: c.salaryComponent?.name || 'Basic Salary',
            amount,
            idx,
          };
        });
        const gross = lines.filter((l: any) => ['EARNING', 'BENEFIT'].includes(l.type)).reduce((sum: number, l: any) => sum + l.amount, 0);
        const deductions = lines.filter((l: any) => ['DEDUCTION', 'TAX'].includes(l.type)).reduce((sum: number, l: any) => sum + l.amount, 0);
        const net = gross - deductions;
        if (net < 0) throw new Error(`Net salary cannot be negative for ${emp.employeeId}`);
        totalGross = totalGross.plus(gross);
        totalDeduction = totalDeduction.plus(deductions);
        totalNet = totalNet.plus(net);

        await tx.salarySlip.create({
          data: {
            slipNo: await nextSlipNumber(tx, numericMonth, numericYear, i),
            payrollEntryId: payrollEntry.id,
            employeeId: emp.id,
            month: numericMonth,
            year: numericYear,
            currency: assignment?.salaryStructure?.currency || 'INR',
            grossPay: gross,
            totalDeduction: deductions,
            netPay: net,
            items: { create: lines },
          },
        });
      }

      return tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: { totalGross, totalDeduction, totalNet, notes: [notes, skipped.length ? `Skipped: ${skipped.join('; ')}` : ''].filter(Boolean).join('\n') || undefined },
        include: { salarySlips: { include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, items: true } } },
      });
    });
    return success(res, entry, 'Payroll entry generated', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updatePayrollEntryStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollEntry.findUnique({ where: { id: req.params.id }, include: { salarySlips: true } });
      if (!existing) throw new Error('Payroll entry not found');
      if (existing.status === 'CANCELLED') throw new Error('Cancelled payroll entries cannot be changed');
      if (status === 'SUBMITTED' && existing.status !== 'DRAFT') throw new Error('Only draft payroll entries can be submitted');
      if (status === 'PAID' && existing.status !== 'SUBMITTED') throw new Error('Only submitted payroll entries can be marked paid');
      if (status === 'CANCELLED' && existing.status === 'PAID') throw new Error('Paid payroll entries cannot be cancelled');
      if (!['SUBMITTED', 'PAID', 'CANCELLED'].includes(status)) throw new Error('Invalid payroll status');
      const data: any = { status };
      const slipData: any = { status };
      if (status === 'PAID') {
        slipData.paymentDate = new Date();
      }
      await tx.salarySlip.updateMany({ where: { payrollEntryId: existing.id }, data: slipData });
      return tx.payrollEntry.update({ where: { id: existing.id }, data, include: { salarySlips: true } });
    });
    return success(res, entry, 'Payroll entry status updated');
  } catch (err: any) {
    return error(res, err.message || 'Unable to update payroll entry', 400);
  }
};

export const getSalarySlips = async (req: any, res: Response) => {
  try {
    const where: any = { employee: { user: { companyId: req.user?.companyId || '__missing_company__' } } };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.month) where.month = Number(req.query.month);
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.mine === 'true') {
      const employee = await getEmployeeForUser(req.user?.id);
      if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
      where.employeeId = employee.id;
    }
    const items = await prisma.salarySlip.findMany({
      where,
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, items: true, payrollEntry: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getMySalarySlips = async (req: any, res: Response) => {
  req.query.mine = 'true';
  return getSalarySlips(req, res);
};

export const getSalarySlip = async (req: any, res: Response) => {
  try {
    const item = await prisma.salarySlip.findFirst({
      where: { id: req.params.id, employee: { user: { companyId: req.user?.companyId || '__missing_company__' } } },
      include: { employee: { include: employeeInclude }, items: true, payrollEntry: true },
    });
    if (!item) return error(res, 'Salary slip not found', 404);
    if (req.user?.role === 'EMPLOYEE' && item.employee.userId !== req.user.id) return error(res, 'Insufficient permissions', 403);
    return success(res, item);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
