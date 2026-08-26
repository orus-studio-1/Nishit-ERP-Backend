import { Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { dayStart, employeeInclude, getEmployeeForUser } from './shared';

export const getMyHrProfile = async (req: any, res: Response) => {
  try {
    const employee = await getEmployeeForUser(req.user?.id);
    if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
    return success(res, employee);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateMyHrProfile = async (req: any, res: Response) => {
  try {
    const employee = await getEmployeeForUser(req.user?.id);
    if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
    const { phone, address, city, country, emergencyName, emergencyPhone, bankAccount, bankName, personalEmail } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      if (phone) await tx.user.update({ where: { id: employee.userId }, data: { phone } });
      return tx.employee.update({
        where: { id: employee.id },
        data: { address, city, country, emergencyName, emergencyPhone, bankAccount, bankName, personalEmail },
        include: employeeInclude,
      });
    });
    return success(res, updated, 'Profile updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getMyAttendance = async (req: any, res: Response) => {
  try {
    const employee = await getEmployeeForUser(req.user?.id);
    if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
    const records = await prisma.attendance.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' },
      take: 60,
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    return success(res, records);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createEmployeeCheckin = async (req: any, res: Response) => {
  try {
    const employee = await getEmployeeForUser(req.user?.id);
    if (!employee) return error(res, 'Employee profile is not linked to this user', 404);
    const { logType, time, deviceId, location, notes } = req.body;
    if (!['IN', 'OUT'].includes(logType)) return error(res, 'logType must be IN or OUT', 400);
    const stamp = time ? new Date(time) : new Date();
    const workDate = dayStart(stamp);

    const result = await prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: workDate } },
        update: logType === 'IN'
          ? { checkIn: stamp, status: 'PRESENT' }
          : { checkOut: stamp, status: 'PRESENT' },
        create: {
          employeeId: employee.id,
          date: workDate,
          checkIn: logType === 'IN' ? stamp : undefined,
          checkOut: logType === 'OUT' ? stamp : undefined,
          status: 'PRESENT',
        },
      });
      const latest = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: workDate } } });
      const hoursWorked = latest?.checkIn && latest?.checkOut
        ? (latest.checkOut.getTime() - latest.checkIn.getTime()) / 3600000
        : undefined;
      const updatedAttendance = hoursWorked
        ? await tx.attendance.update({ where: { id: attendance.id }, data: { hoursWorked } })
        : attendance;
      const checkin = await tx.employeeCheckin.create({
        data: { employeeId: employee.id, logType, time: stamp, deviceId, location, notes, attendanceId: updatedAttendance.id },
      });
      return { checkin, attendance: updatedAttendance };
    });
    return success(res, result, `${logType === 'IN' ? 'Checked in' : 'Checked out'} successfully`, 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
