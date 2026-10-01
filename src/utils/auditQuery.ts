import { Request } from 'express';
import prisma from '../lib/prisma';

export function auditPageParams(req: Request, defaultLimit = 25, maxLimit = 100) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit };
}

export function auditDateRangeWhere(req: Request) {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(`${String(req.query.to).slice(0, 10)}T23:59:59.999Z`) : undefined;
  if (!from && !to) return undefined;
  return {
    ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
  };
}

export async function buildActorMap(companyId?: string | null) {
  const users = await prisma.user.findMany({
    where: { companyId: companyId || undefined },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, employee: { select: { employeeId: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return { users, actors: new Map(users.map((user) => [user.id, user])) };
}
