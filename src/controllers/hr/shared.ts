import prisma from '../../lib/prisma';

export function companyEmployeeWhere(companyId?: string | null) {
  return companyId ? { user: { companyId } } : { id: '__missing_company__' };
}

export async function getCompanyEmployee(employeeId: string, companyId?: string | null) {
  if (!employeeId || !companyId) return null;
  return prisma.employee.findFirst({ where: { id: employeeId, user: { companyId } }, include: employeeInclude });
}

export const dayStart = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const daysBetweenInclusive = (start: Date, end: Date) => {
  const ms = dayStart(end).getTime() - dayStart(start).getTime();
  return Math.max(1, Math.floor(ms / 86400000) + 1);
};

export const employeeInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true, role: true } },
  department: true,
  position: true,
  manager: { include: { user: { select: { firstName: true, lastName: true } } } },
};

export async function getEmployeeForUser(userId?: string) {
  if (!userId) return null;
  return prisma.employee.findUnique({ where: { userId }, include: employeeInclude });
}
