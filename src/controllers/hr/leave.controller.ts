import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { dayStart, daysBetweenInclusive, getEmployeeForUser } from './shared';

export const getLeaveTypes = async (req: Request, res: Response) => {
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return success(res, types);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLeaveType = async (req: Request, res: Response) => {
  try {
    const { name, daysAllowed, isPaid, description } = req.body;
    if (!name) return error(res, 'Leave type name is required', 400);
    const lt = await prisma.leaveType.create({ data: { name, daysAllowed: Number(daysAllowed || 0), isPaid: isPaid === undefined ? true : Boolean(isPaid), description } });
    return success(res, lt, 'Leave type created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLeaveBalances = async (req: Request, res: Response) => {
  try {
    const { employeeId, date } = req.query as any;
    if (!employeeId) return error(res, 'employeeId is required', 400);
    const asOf = date ? new Date(date) : new Date();
    const allocations = await prisma.leaveAllocation.findMany({
      where: {
        employeeId,
        employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } },
        fromDate: { lte: asOf },
        toDate: { gte: asOf },
      },
      include: { leaveType: true, leavePeriod: true },
      orderBy: [{ leaveType: { name: 'asc' } }, { createdAt: 'desc' }],
    });
    return success(res, allocations.map((allocation: any) => ({
      allocationId: allocation.id,
      leaveTypeId: allocation.leaveTypeId,
      leaveType: allocation.leaveType,
      leavePeriod: allocation.leavePeriod,
      allocated: Number(allocation.allocated || 0),
      used: Number(allocation.used || 0),
      balance: Number(allocation.balance || 0),
      fromDate: allocation.fromDate,
      toDate: allocation.toDate,
    })));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

// ---- LEAVE REQUESTS ----
export const getLeaveRequests = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { employeeId, status } = req.query as any;
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if ((req as any).user?.role === 'EMPLOYEE') {
      const employee = await getEmployeeForUser((req as any).user.id);
      if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
      where.employeeId = employee.id;
    }

    const [items, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: { include: { user: { select: { firstName: true, lastName: true } } } },
          leaveType: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.leaveRequest.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLeaveRequest = async (req: Request, res: Response) => {
  try {
    const body = { ...req.body };
    if (!body.employeeId && (req as any).user?.id) {
      const employee = await getEmployeeForUser((req as any).user.id);
      if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
      body.employeeId = employee.id;
    }
    if (!body.employeeId || !body.leaveTypeId || !body.startDate || !body.endDate) return error(res, 'employeeId, leaveTypeId, startDate and endDate are required', 400);
    const startDate = dayStart(new Date(body.startDate));
    const endDate = dayStart(new Date(body.endDate));
    if (endDate < startDate) return error(res, 'End date cannot be before start date', 400);
    body.days = Number(body.days || daysBetweenInclusive(startDate, endDate));
    const [employee, leaveType, overlap, allocation] = await Promise.all([
      prisma.employee.findFirst({ where: { id: body.employeeId, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } }),
      prisma.leaveType.findUnique({ where: { id: body.leaveTypeId } }),
      prisma.leaveRequest.findFirst({
        where: {
          employeeId: body.employeeId,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      prisma.leaveAllocation.findFirst({
      where: {
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        fromDate: { lte: startDate },
        toDate: { gte: endDate },
      },
      orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!employee) return error(res, 'Employee not found', 404);
    if (!leaveType || !leaveType.isActive) return error(res, 'Active leave type not found', 404);
    if (overlap) return error(res, 'Employee already has a pending or approved leave request in this date range', 400);
    if (!allocation) return error(res, 'No leave allocation exists for this employee, leave type, and date range. Allocate leave first from Leave Ledger.', 400);
    if (allocation && Number(allocation.balance) < body.days) {
      return error(res, `Insufficient leave balance. Available: ${allocation.balance}`, 400);
    }
    const lr = await prisma.leaveRequest.create({
      data: { ...body, startDate, endDate },
      include: { leaveType: true, employee: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    return success(res, lr, 'Leave request submitted', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const approveLeaveRequest = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) return error(res, 'status must be APPROVED or REJECTED', 400);
    const lr = await prisma.$transaction(async (tx) => {
      const existing = await tx.leaveRequest.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Leave request not found');
      if (existing.status !== 'PENDING') throw new Error('Only pending leave requests can be approved or rejected');
      const updated = await tx.leaveRequest.update({
        where: { id: req.params.id },
        data: { status, approvedBy: (req as any).user?.id, approvedAt: new Date() },
      });
      if (status === 'APPROVED') {
        const allocation = await tx.leaveAllocation.findFirst({
          where: {
            employeeId: existing.employeeId,
            leaveTypeId: existing.leaveTypeId,
            fromDate: { lte: existing.startDate },
            toDate: { gte: existing.endDate },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (allocation) {
          const used = Number(allocation.used) + existing.days;
          const balance = Number(allocation.balance) - existing.days;
          if (balance < 0) throw new Error('Insufficient leave balance');
          await tx.leaveAllocation.update({ where: { id: allocation.id }, data: { used, balance } });
          await tx.leaveLedgerEntry.create({
            data: {
              employeeId: existing.employeeId,
              leaveTypeId: existing.leaveTypeId,
              leaveRequestId: existing.id,
              entryType: 'APPLICATION',
              leaves: -existing.days,
              balanceAfter: balance,
              notes: 'Leave request approved',
            },
          });
        }
        for (let cursor = dayStart(existing.startDate); cursor <= dayStart(existing.endDate); cursor = new Date(cursor.getTime() + 86400000)) {
          await tx.attendance.upsert({
            where: { employeeId_date: { employeeId: existing.employeeId, date: cursor } },
            update: { status: 'ON_LEAVE' },
            create: { employeeId: existing.employeeId, date: cursor, status: 'ON_LEAVE' },
          });
        }
      }
      return updated;
    });
    return success(res, lr, `Leave request ${status.toLowerCase()}`);
  } catch (err: any) {
    return error(res, err.message || 'Unable to update leave request', 400);
  }
};
