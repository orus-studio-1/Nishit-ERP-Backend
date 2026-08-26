import prisma from '../../lib/prisma';
import { AuthRequest } from '../../middleware/auth';

export async function crmScopeWhere(req: AuthRequest, entity: 'LEAD' | 'OPPORTUNITY' | 'ACTIVITY') {
  const companyId = req.user?.companyId || '__missing_company__';
  if (req.access?.isSuperAdmin) return { companyId };
  const rule = await prisma.crmScopeRule.findUnique({ where: { companyId_userId_entity: { companyId, userId: req.user!.id, entity } } });
  const scope = rule?.isActive ? rule.scope : 'OWN';
  if (scope === 'ALL') return { companyId };
  if (scope === 'BRANCH') return { companyId, branchId: rule?.branchId || req.user?.branchId || '__missing_branch__' };
  if (scope === 'TEAM') {
    const manager = await prisma.employee.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!manager) return { companyId, ...(entity === 'ACTIVITY' ? { userId: req.user!.id } : entity === 'OPPORTUNITY' ? { ownerId: req.user!.id } : { assignedToId: req.user!.id }) };
    const all = [manager.id]; let frontier = [manager.id];
    while (frontier.length) {
      const rows = await prisma.employee.findMany({ where: { managerId: { in: frontier } }, select: { id: true } });
      frontier = rows.map((row) => row.id).filter((id) => !all.includes(id)); all.push(...frontier);
    }
    const users = await prisma.employee.findMany({ where: { id: { in: all } }, select: { userId: true } });
    return { companyId, ...(entity === 'ACTIVITY' ? { userId: { in: users.map((u) => u.userId) } } : entity === 'OPPORTUNITY' ? { ownerId: { in: users.map((u) => u.userId) } } : { assignedToId: { in: users.map((u) => u.userId) } }) };
  }
  return { companyId, ...(entity === 'ACTIVITY' ? { userId: req.user!.id } : entity === 'OPPORTUNITY' ? { ownerId: req.user!.id } : { assignedToId: req.user!.id }) };
}
