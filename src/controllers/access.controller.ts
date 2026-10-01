import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { error, success } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { ensureCompanyDefaultRoles, ensureSystemPermissions, permissionCatalog } from '../utils/accessControl';
import { passwordValidationMessage } from '../utils/password';
import { setAuditContext } from '../middleware/platform';

function companyId(req: Request) {
  return (req as AuthRequest).user?.companyId || null;
}

// Does not write to the database itself -- it hands business context to the mutationAudit
// middleware, which writes the single audit row for this request.
function audit(req: Request, input: any) {
  setAuditContext(req, {
    entityType: 'ACCESS',
    entityId: input.targetUserId || input.targetRoleId,
    ...input,
  });
}

export const getAccessCatalog = async (_req: Request, res: Response) => {
  try {
    await ensureSystemPermissions();
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });
    return success(res, permissions);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getAccessSummary = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    const [users, roles, permissions, auditLogs] = await Promise.all([
      prisma.user.count({ where: id ? { companyId: id } : undefined }),
      prisma.accessRole.count({ where: id ? { companyId: id } : undefined }),
      prisma.permission.count(),
      prisma.platformAuditLog.findMany({ where: { entityType: 'ACCESS', ...(id ? { companyId: id } : {}) }, take: 10, orderBy: { createdAt: 'desc' } }),
    ]);
    return success(res, { users, roles, permissions, recentAudit: auditLogs });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getAccessRoles = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    if (id) await ensureCompanyDefaultRoles(id);
    const roles = await prisma.accessRole.findMany({
      where: id ? { companyId: id } : undefined,
      include: {
        permissions: { include: { permission: true }, orderBy: { permission: { module: 'asc' } } },
        _count: { select: { users: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return success(res, roles);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createAccessRole = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    if (!id) return error(res, 'Company is required before creating roles', 400);
    const { name, title, description, permissionIds = [], deniedPermissionIds = [] } = req.body;
    if (!String(name || '').trim() || !String(title || '').trim()) return error(res, 'Role name and title are required', 400);
    const requestedPermissionIds = Array.from(new Set<string>([...permissionIds, ...deniedPermissionIds].filter(Boolean)));
    const validPermissionCount = requestedPermissionIds.length ? await prisma.permission.count({ where: { id: { in: requestedPermissionIds } } }) : 0;
    if (validPermissionCount !== requestedPermissionIds.length) return error(res, 'One or more permissions are invalid', 400);
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.accessRole.create({
        data: { companyId: id, name: String(name).trim().toUpperCase().replace(/\s+/g, '_'), title, description },
      });
      const allowedIds = Array.from(new Set<string>(permissionIds.filter(Boolean)));
      const deniedIds = Array.from(new Set<string>(deniedPermissionIds.filter(Boolean)));
      const rows = [
        ...allowedIds.map((permissionId) => ({ roleId: created.id, permissionId, effect: 'ALLOW' as const })),
        ...deniedIds.map((permissionId) => ({ roleId: created.id, permissionId, effect: 'DENY' as const })),
      ];
      if (rows.length) await tx.rolePermission.createMany({ data: rows, skipDuplicates: true });
      setAuditContext(req, { companyId: id, entityType: 'ACCESS', entityId: created.id, targetRoleId: created.id, action: 'ROLE_CREATE', after: req.body });
      return tx.accessRole.findUnique({ where: { id: created.id }, include: { permissions: { include: { permission: true } } } });
    });
    return success(res, role, 'Role created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateAccessRole = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    const { title, description, isActive, permissionIds = [], deniedPermissionIds = [] } = req.body;
    const role = await prisma.accessRole.findFirst({ where: { id: req.params.id, ...(id ? { companyId: id } : {}) } });
    if (!role) return error(res, 'Role not found', 404);
    if (role.isSuperAdmin && deniedPermissionIds.length) return error(res, 'Super Admin role cannot receive deny permissions', 400);
    const requestedPermissionIds = Array.from(new Set<string>([...permissionIds, ...deniedPermissionIds].filter(Boolean)));
    const validPermissionCount = requestedPermissionIds.length ? await prisma.permission.count({ where: { id: { in: requestedPermissionIds } } }) : 0;
    if (validPermissionCount !== requestedPermissionIds.length) return error(res, 'One or more permissions are invalid', 400);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.accessRole.update({ where: { id: role.id }, data: { title, description, isActive } });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      const allowedIds = Array.from(new Set<string>(permissionIds.filter(Boolean)));
      const deniedIds = Array.from(new Set<string>(deniedPermissionIds.filter(Boolean)));
      const rows = [
        ...allowedIds.map((permissionId) => ({ roleId: role.id, permissionId, effect: 'ALLOW' as const })),
        ...deniedIds.map((permissionId) => ({ roleId: role.id, permissionId, effect: 'DENY' as const })),
      ];
      if (rows.length) await tx.rolePermission.createMany({ data: rows, skipDuplicates: true });
      setAuditContext(req, { companyId: id || undefined, entityType: 'ACCESS', entityId: role.id, targetRoleId: role.id, action: 'ROLE_UPDATE', before: role, after: req.body });
      return tx.accessRole.findUnique({ where: { id: role.id }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
    });
    return success(res, updated, 'Role updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getAccessUsers = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    const users = await prisma.user.findMany({
      where: id ? { companyId: id } : undefined,
      include: {
        employee: { include: { department: true, position: true } },
        accessRoles: { include: { role: true } },
        permissionOverrides: { include: { permission: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, users.map(({ password, ...user }) => user));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateUserAccess = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    const { roleIds = [], permissionOverrides = [], isActive } = req.body;
    const user = await prisma.user.findFirst({ where: { id: req.params.id, ...(id ? { companyId: id } : {}) } });
    if (!user) return error(res, 'User not found', 404);
    if (user.id === (req as AuthRequest).user?.id && isActive === false) return error(res, 'You cannot disable your own account', 400);
    if (!id) return error(res, 'Company context is required', 403);
    if (user.id === (req as AuthRequest).user?.id && (roleIds.length || permissionOverrides.length)) return error(res, 'You cannot change your own roles or permission overrides', 403);

    const uniqueRoleIds = Array.from(new Set<string>(roleIds.filter(Boolean)));
    const selectedRoles = await prisma.accessRole.findMany({ where: { id: { in: uniqueRoleIds }, companyId: id, isActive: true } });
    if (selectedRoles.length !== uniqueRoleIds.length) return error(res, 'One or more roles are invalid for this company', 400);
    if (selectedRoles.some((role) => role.isSuperAdmin) && !(req as AuthRequest).access?.isSuperAdmin) return error(res, 'Only a Super Admin can assign the Super Admin role', 403);
    const overrideIds = Array.from(new Set<string>(permissionOverrides.map((item: any) => item?.permissionId).filter(Boolean)));
    const validPermissionCount = overrideIds.length ? await prisma.permission.count({ where: { id: { in: overrideIds } } }) : 0;
    if (validPermissionCount !== overrideIds.length) return error(res, 'One or more permission overrides are invalid', 400);
    if (permissionOverrides.some((item: any) => !['ALLOW', 'DENY'].includes(item?.effect))) return error(res, 'Permission override effect must be ALLOW or DENY', 400);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isActive, tokenVersion: { increment: 1 } } });
      await tx.userAccessRole.deleteMany({ where: { userId: user.id } });
      for (const roleId of uniqueRoleIds) {
        await tx.userAccessRole.create({ data: { userId: user.id, roleId, assignedById: (req as AuthRequest).user?.id } });
      }
      await tx.userPermissionOverride.deleteMany({ where: { userId: user.id } });
      for (const item of permissionOverrides.filter((override: any) => override?.permissionId && override?.effect)) {
        await tx.userPermissionOverride.create({
          data: {
            companyId: id || undefined,
            userId: user.id,
            permissionId: item.permissionId,
            effect: item.effect,
            reason: item.reason,
            expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
          },
        });
      }
      setAuditContext(req, { companyId: id || undefined, entityType: 'ACCESS', entityId: user.id, targetUserId: user.id, action: 'USER_ACCESS_UPDATE', before: user, after: req.body });
      return tx.user.findUnique({
        where: { id: user.id },
        include: { accessRoles: { include: { role: true } }, permissionOverrides: { include: { permission: true } }, employee: true },
      });
    });
    if (!updated) return error(res, 'Unable to update user', 500);
    const { password: _, ...safeUser } = updated;
    return success(res, safeUser, 'User access updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const issueUserPassword = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    const { password, confirmPassword, activate = true } = req.body;
    const passwordError = passwordValidationMessage(password);
    if (passwordError) return error(res, passwordError, 400);
    if (confirmPassword !== undefined && password !== confirmPassword) return error(res, 'Password confirmation does not match', 400);

    const user = await prisma.user.findFirst({
      where: { id: req.params.id, ...(id ? { companyId: id } : {}) },
      include: { employee: true },
    });
    if (!user) return error(res, 'User not found', 404);
    if (user.id === (req as AuthRequest).user?.id) return error(res, 'Use Settings to change your own password', 400);

    const hashed = await bcrypt.hash(password, 10);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { password: hashed, isActive: activate ? true : user.isActive, tokenVersion: { increment: 1 } } });
      setAuditContext(req, {
        companyId: id || undefined,
        entityType: 'ACCESS',
        entityId: user.id,
        targetUserId: user.id,
        action: 'USER_PASSWORD_ISSUED',
        message: `${activate ? 'Issued password and activated login' : 'Issued password'} for ${user.email}`,
      });
      return tx.user.findUnique({
        where: { id: user.id },
        include: { accessRoles: { include: { role: true } }, permissionOverrides: { include: { permission: true } }, employee: true },
      });
    });
    if (!updated) return error(res, 'Unable to issue password', 500);
    const { password: _, ...safeUser } = updated;
    return success(res, safeUser, activate ? 'Password issued and login activated' : 'Password issued');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const bootstrapAccess = async (req: Request, res: Response) => {
  try {
    const id = companyId(req);
    await ensureSystemPermissions();
    if (id) await ensureCompanyDefaultRoles(id);
    await audit(req, { action: 'ACCESS_BOOTSTRAP', message: 'Synchronized permission catalog and default roles' });
    return success(res, { permissions: permissionCatalog().length }, 'Access system bootstrapped');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
