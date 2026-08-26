import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

export const getLeavePeriods = async (_req: Request, res: Response) => {
  try { return success(res, await prisma.leavePeriod.findMany({ orderBy: { fromDate: 'desc' } })); }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const createLeavePeriod = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name || !req.body.fromDate || !req.body.toDate) return error(res, 'Name, from date and to date are required', 400);
    const fromDate = new Date(req.body.fromDate), toDate = new Date(req.body.toDate);
    if (toDate < fromDate) return error(res, 'To date cannot be before from date', 400);
    return success(res, await prisma.leavePeriod.create({ data: { name, fromDate, toDate } }), 'Leave period created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getLeaveAllocations = async (req: Request, res: Response) => {
  try {
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const items = await prisma.leaveAllocation.findMany({
      where,
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, leaveType: true, leavePeriod: true },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLeaveAllocation = async (req: Request, res: Response) => {
  try {
    const { employeeId, leaveTypeId, leavePeriodId, allocated, fromDate, toDate, notes } = req.body;
    const amount = Number(allocated || 0);
    if (!employeeId || !leaveTypeId || !leavePeriodId || !fromDate || !toDate) return error(res, 'Employee, leave type, leave period, from date and to date are required', 400);
    if (amount <= 0) return error(res, 'Allocated leave must be greater than zero', 400);
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } });
    if (!employee) return error(res, 'Employee not found in your company', 404);
    const item = await prisma.$transaction(async (tx) => {
      const allocation = await tx.leaveAllocation.create({
        data: {
          employeeId, leaveTypeId, leavePeriodId,
          allocated: amount, used: 0, balance: amount,
          fromDate: new Date(fromDate), toDate: new Date(toDate),
        },
      });
      await tx.leaveLedgerEntry.create({
        data: {
          employeeId, leaveTypeId, entryType: 'ALLOCATION',
          leaves: amount, balanceAfter: amount, notes: notes || 'Manual leave allocation',
        },
      });
      return allocation;
    });
    return success(res, item, 'Leave allocated', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLeaveLedger = async (req: Request, res: Response) => {
  try {
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.leaveTypeId) where.leaveTypeId = req.query.leaveTypeId;
    const items = await prisma.leaveLedgerEntry.findMany({
      where,
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, leaveType: true },
      orderBy: { transactionDate: 'desc' },
      take: 200,
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLeavePolicy = async (req: Request, res: Response) => {
  try {
    const { name, description, details = [] } = req.body;
    const policy = await prisma.leavePolicy.create({
      data: {
        name, description,
        details: { create: details.map((d: any) => ({ leaveTypeId: d.leaveTypeId, annualAllocation: Number(d.annualAllocation || 0) })) },
      },
      include: { details: { include: { leaveType: true } } },
    });
    return success(res, policy, 'Leave policy created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLeavePolicies = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.leavePolicy.findMany({ include: { details: { include: { leaveType: true } } }, orderBy: { name: 'asc' } });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
