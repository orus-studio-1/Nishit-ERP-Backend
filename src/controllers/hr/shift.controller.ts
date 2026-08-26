import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayEnd(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function combineDateTime(date: Date, time: string, addDay = false) {
  const [hours, minutes] = String(time || '00:00').split(':').map(Number);
  const stamp = dayStart(date);
  stamp.setHours(hours || 0, minutes || 0, 0, 0);
  if (addDay) stamp.setDate(stamp.getDate() + 1);
  return stamp;
}

function shiftWindow(date: Date, shift: any) {
  const endNextDay = shift.isNightShift || shift.endTime < shift.startTime;
  const start = combineDateTime(date, shift.startTime);
  const end = combineDateTime(date, shift.endTime, endNextDay);
  return { start, end };
}

function assignmentWhereForDate(date: Date) {
  const workDate = dayStart(date);
  return {
    status: 'ACTIVE',
    startDate: { lte: workDate },
    OR: [{ endDate: null }, { endDate: { gte: workDate } }],
  } satisfies Prisma.ShiftAssignmentWhereInput;
}

const assignmentInclude = {
  employee: { include: { user: { select: { firstName: true, lastName: true, email: true } }, department: true, position: true } },
  shiftType: true,
};

export const getShiftTypes = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.shiftType.findMany({
      include: { _count: { select: { assignments: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createShiftType = async (req: Request, res: Response) => {
  try {
    const { name, startTime, endTime, graceMinutes, isNightShift, isActive } = req.body;
    if (!name || !startTime || !endTime) return error(res, 'name, startTime and endTime are required', 400);
    const item = await prisma.shiftType.create({
      data: {
        name,
        startTime,
        endTime,
        graceMinutes: Number(graceMinutes || 0),
        isNightShift: Boolean(isNightShift || endTime < startTime),
        isActive: isActive === undefined ? true : Boolean(isActive),
      },
    });
    return success(res, item, 'Shift type created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateShiftType = async (req: Request, res: Response) => {
  try {
    const { name, startTime, endTime, graceMinutes, isNightShift, isActive } = req.body;
    const item = await prisma.shiftType.update({
      where: { id: req.params.id },
      data: {
        name,
        startTime,
        endTime,
        graceMinutes: graceMinutes === undefined ? undefined : Number(graceMinutes),
        isNightShift,
        isActive,
      },
    });
    return success(res, item, 'Shift type updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getShiftAssignments = async (req: Request, res: Response) => {
  try {
    const { employeeId, shiftTypeId, status, date } = req.query as any;
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (employeeId) where.employeeId = employeeId;
    if (shiftTypeId) where.shiftTypeId = shiftTypeId;
    if (status) where.status = status;
    if (date) Object.assign(where, assignmentWhereForDate(new Date(date)));
    const items = await prisma.shiftAssignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 500,
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const assignShift = async (req: Request, res: Response) => {
  try {
    const { employeeId, shiftTypeId, startDate, endDate } = req.body;
    if (!employeeId || !shiftTypeId || !startDate) return error(res, 'employeeId, shiftTypeId and startDate are required', 400);
    const start = dayStart(new Date(startDate));
    const end = endDate ? dayStart(new Date(endDate)) : null;
    if (end && end < start) return error(res, 'End date cannot be before start date', 400);

    const item = await prisma.$transaction(async (tx) => {
      const [employee, shiftType] = await Promise.all([
        tx.employee.findFirst({ where: { id: employeeId, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } }),
        tx.shiftType.findUnique({ where: { id: shiftTypeId } }),
      ]);
      if (!employee) throw new Error('Employee not found');
      if (!shiftType || !shiftType.isActive) throw new Error('Active shift type not found');
      const overlap = await tx.shiftAssignment.findFirst({
        where: {
          employeeId,
          status: 'ACTIVE',
          startDate: { lte: end || start },
          OR: [{ endDate: null }, { endDate: { gte: start } }],
        },
      });
      if (overlap) throw new Error('Employee already has an active shift assignment in this date range');
      return tx.shiftAssignment.create({
        data: { employeeId, shiftTypeId, startDate: start, endDate: end || undefined },
        include: assignmentInclude,
      });
    });
    return success(res, item, 'Shift assigned', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const updateShiftAssignment = async (req: Request, res: Response) => {
  try {
    const { status, endDate } = req.body;
    const item = await prisma.shiftAssignment.update({
      where: { id: req.params.id },
      data: { status, endDate: endDate ? dayStart(new Date(endDate)) : undefined },
      include: assignmentInclude,
    });
    return success(res, item, 'Shift assignment updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getShiftRoster = async (req: Request, res: Response) => {
  try {
    const workDate = req.query.date ? new Date(String(req.query.date)) : new Date();
    const date = dayStart(workDate);
    const assignments = await prisma.shiftAssignment.findMany({
      where: { ...assignmentWhereForDate(date), employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } },
      include: assignmentInclude,
      orderBy: [{ shiftType: { startTime: 'asc' } }, { employee: { employeeId: 'asc' } }],
    });
    const attendance = await prisma.attendance.findMany({
      where: { date, employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } },
      include: { employee: true },
    });
    const attendanceByEmployee = new Map(attendance.map((item: any) => [item.employeeId, item]));
    return success(res, assignments.map((assignment: any) => {
      const { start, end } = shiftWindow(date, assignment.shiftType);
      const att: any = attendanceByEmployee.get(assignment.employeeId);
      return {
        assignmentId: assignment.id,
        employee: assignment.employee,
        shiftType: assignment.shiftType,
        scheduledStart: start,
        scheduledEnd: end,
        attendance: att || null,
        status: att?.status || 'NOT_MARKED',
      };
    }));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const markShiftAutoAttendance = async (req: Request, res: Response) => {
  try {
    const date = dayStart(req.body.date ? new Date(req.body.date) : new Date());
    const shiftTypeId = req.body.shiftTypeId;
    const where: any = assignmentWhereForDate(date);
    where.employee = { user: { companyId: (req as any).user?.companyId || '__missing_company__' } };
    if (shiftTypeId) where.shiftTypeId = shiftTypeId;

    const result = await prisma.$transaction(async (tx) => {
      const assignments = await tx.shiftAssignment.findMany({ where, include: assignmentInclude });
      let present = 0;
      let late = 0;
      let halfDay = 0;
      let absent = 0;
      for (const assignment of assignments as any[]) {
        const { start, end } = shiftWindow(date, assignment.shiftType);
        const checkins = await tx.employeeCheckin.findMany({
          where: { employeeId: assignment.employeeId, time: { gte: start, lte: end } },
          orderBy: { time: 'asc' },
        });
        const inLog = checkins.find((log: any) => log.logType === 'IN') || checkins[0];
        const outLog = [...checkins].reverse().find((log: any) => log.logType === 'OUT') || checkins[checkins.length - 1];
        const scheduledHours = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
        const hoursWorked = inLog && outLog && outLog.time > inLog.time ? (outLog.time.getTime() - inLog.time.getTime()) / 3600000 : undefined;
        let status: any = 'ABSENT';
        if (inLog) {
          const lateAfter = new Date(start.getTime() + Number(assignment.shiftType.graceMinutes || 0) * 60000);
          status = inLog.time > lateAfter ? 'LATE' : 'PRESENT';
          if (hoursWorked !== undefined && scheduledHours && hoursWorked < scheduledHours / 2) status = 'HALF_DAY';
        }
        if (status === 'PRESENT') present += 1;
        if (status === 'LATE') late += 1;
        if (status === 'HALF_DAY') halfDay += 1;
        if (status === 'ABSENT') absent += 1;
        await tx.attendance.upsert({
          where: { employeeId_date: { employeeId: assignment.employeeId, date } },
          update: { checkIn: inLog?.time, checkOut: outLog?.time, hoursWorked, status, notes: `Auto attendance from ${assignment.shiftType.name}` },
          create: { employeeId: assignment.employeeId, date, checkIn: inLog?.time, checkOut: outLog?.time, hoursWorked, status, notes: `Auto attendance from ${assignment.shiftType.name}` },
        });
      }
      return { processed: assignments.length, present, late, halfDay, absent };
    });
    return success(res, result, 'Auto attendance processed');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
