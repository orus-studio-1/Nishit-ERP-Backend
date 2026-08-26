import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateEmployeeId } from '../../utils/generate';
import { ensureCompanyDefaultRoles } from '../../utils/accessControl';
import { AuthRequest } from '../../middleware/auth';

// ---- EMPLOYEES ----
export const getEmployees = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { departmentId, status, search } = req.query as any;
    const where: any = {};
    if ((req as any).user?.companyId) where.user = { companyId: (req as any).user.companyId };
    if (departmentId) where.departmentId = departmentId;
    if (status) where.status = status;
    if (search) where.OR = [
      { user: { firstName: { contains: search, mode: 'insensitive' } } },
      { user: { lastName: { contains: search, mode: 'insensitive' } } },
      { employeeId: { contains: search, mode: 'insensitive' } },
    ];

    const [items, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
          department: true,
          position: true,
          manager: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.employee.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getEmployee = async (req: Request, res: Response) => {
  try {
    const emp = await prisma.employee.findFirst({
      where: { id: req.params.id, user: { companyId: (req as any).user?.companyId || '__missing_company__' } },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true, avatar: true } },
        department: true,
        position: true,
        manager: { include: { user: { select: { firstName: true, lastName: true } } } },
        attendance: { take: 30, orderBy: { date: 'desc' } },
        leaveRequests: { include: { leaveType: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!emp) return error(res, 'Employee not found', 404);
    return success(res, emp);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createEmployee = async (req: Request, res: Response) => {
  try {
    const {
      password, firstName, lastName, phone, departmentId, positionId, managerId,
      hireDate, salary, salaryType, address, city, country, emergencyName, emergencyPhone,
      roleIds = [], employmentType, branch, grade, gender, dateOfBirth, maritalStatus,
      workLocation, personalEmail, companyEmail, noticePeriodDays, bankAccount, bankName, taxId,
    } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return error(res, 'Email is required', 400);
    if (!firstName || !lastName) return error(res, 'First name and last name are required', 400);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return error(res, 'This email is already registered. Use a different email, or edit the existing user access instead of creating a new employee.', 400);

    const companyId = (req as any).user?.companyId;
    if (!companyId) return error(res, 'A company-scoped administrator is required', 403);
    const requestedRoleIds = Array.isArray(roleIds) ? roleIds : [];
    const uniqueRequestedRoleIds = Array.from(new Set<string>(requestedRoleIds.filter(Boolean)));
    if (uniqueRequestedRoleIds.length) {
      const validRoles = await prisma.accessRole.findMany({ where: { id: { in: uniqueRequestedRoleIds }, companyId, isActive: true } });
      if (validRoles.length !== uniqueRequestedRoleIds.length) return error(res, 'One or more selected access roles are invalid for this company', 400);
      if (validRoles.some((accessRole) => accessRole.isSuperAdmin) && !(req as AuthRequest).access?.isSuperAdmin) return error(res, 'Only a Super Admin can assign the Super Admin role', 403);
    }
    const hashed = await bcrypt.hash(password || crypto.randomBytes(32).toString('hex'), 10);
    const employeeId = await generateEmployeeId();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, password: hashed, firstName, lastName, phone, role: 'EMPLOYEE', companyId, isActive: Boolean(password) },
      });
      let uniqueRoleIds = uniqueRequestedRoleIds;
      if (!uniqueRoleIds.length && companyId) {
        const roles = await ensureCompanyDefaultRoles(companyId, tx);
        if (roles.EMPLOYEE_SELF_SERVICE?.id) uniqueRoleIds = [roles.EMPLOYEE_SELF_SERVICE.id];
      }
      for (const accessRoleId of uniqueRoleIds) {
        await tx.userAccessRole.create({ data: { userId: user.id, roleId: accessRoleId as string, assignedById: (req as any).user?.id } });
      }
      const emp = await tx.employee.create({
        data: {
          employeeId, userId: user.id, departmentId, positionId, managerId,
          hireDate: hireDate ? new Date(hireDate) : new Date(),
          salary: Number(salary || 0),
          salaryType: salaryType || 'MONTHLY',
          address, city, country,
          emergencyName, emergencyPhone, employmentType, branch, grade, gender,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          maritalStatus, workLocation, personalEmail, companyEmail,
          noticePeriodDays: noticePeriodDays ? Number(noticePeriodDays) : undefined,
          bankAccount, bankName, taxId,
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          department: true, position: true,
        },
      });
      return emp;
    });

    return success(res, result, password ? 'Employee created with login password' : 'Employee created. Issue a login password from Access Control before the employee can sign in.', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const {
      firstName, lastName, phone, departmentId, positionId, managerId, salary, salaryType,
      status, address, city, country, emergencyName, emergencyPhone, employmentType,
      branch, grade, gender, dateOfBirth, maritalStatus, workLocation, personalEmail,
      companyEmail, noticePeriodDays, bankAccount, bankName, taxId,
    } = req.body;

    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } });
    if (!emp) return error(res, 'Employee not found', 404);

    const [, updated] = await Promise.all([
      prisma.user.update({ where: { id: emp.userId }, data: { firstName, lastName, phone } }),
      prisma.employee.update({
        where: { id: req.params.id },
        data: {
          departmentId, positionId, managerId, salary, salaryType, status, address, city, country,
          emergencyName, emergencyPhone, employmentType, branch, grade, gender,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          maritalStatus, workLocation, personalEmail, companyEmail,
          noticePeriodDays: noticePeriodDays ? Number(noticePeriodDays) : undefined,
          bankAccount, bankName, taxId,
        },
        include: { user: { select: { firstName: true, lastName: true, email: true } }, department: true, position: true },
      }),
    ]);
    return success(res, updated, 'Employee updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } });
    if (!existing) return error(res, 'Employee not found', 404);
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { status: 'TERMINATED', terminatedDate: new Date() },
    });
    return success(res, employee, 'Employee terminated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
