import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { companyEmployeeWhere, getCompanyEmployee } from './shared';

function attendanceTime(date: string, value?: string) {
  if (!value) return undefined;
  const parsed = /^\d{2}:\d{2}(:\d{2})?$/.test(value) ? new Date(`${date}T${value.length === 5 ? `${value}:00` : value}`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Check-in and check-out must be valid times');
  return parsed;
}

export const getAttendance = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const { employeeId, date, month, year } = req.query as any;
    const companyId = (req as any).user?.companyId;
    const where: any = { employee: companyEmployeeWhere(companyId) };
    if (employeeId) where.employeeId = employeeId;
    if (date) where.date = { gte: new Date(date), lt: new Date(new Date(date).getTime() + 86400000) };
    if (month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 1);
      where.date = { gte: start, lt: end };
    }

    const [items, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendance.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const markAttendance = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, checkIn, checkOut, status, notes } = req.body;
    if (!employeeId || !date || !status) return error(res, 'employeeId, date and status are required', 400);
    const employee = await getCompanyEmployee(employeeId, (req as any).user?.companyId);
    if (!employee) return error(res, 'Employee not found in your company', 404);
    const workDate = new Date(`${date}T00:00:00.000Z`);
    const checkInAt = attendanceTime(date, checkIn);
    const checkOutAt = attendanceTime(date, checkOut);
    if (Number.isNaN(workDate.getTime())) return error(res, 'A valid attendance date is required', 400);
    if (checkInAt && checkOutAt && checkOutAt < checkInAt) return error(res, 'Check-out cannot be before check-in', 400);
    const hoursWorked = checkInAt && checkOutAt
      ? (checkOutAt.getTime() - checkInAt.getTime()) / 3600000
      : undefined;

    const attendance = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: workDate } },
      update: { checkIn: checkInAt, checkOut: checkOutAt, status, notes, hoursWorked },
      create: { employeeId, date: workDate, checkIn: checkInAt, checkOut: checkOutAt, status, notes, hoursWorked },
    });
    return success(res, attendance, 'Attendance recorded');
  } catch (err: any) {
    if (err.message?.includes('valid time')) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};
