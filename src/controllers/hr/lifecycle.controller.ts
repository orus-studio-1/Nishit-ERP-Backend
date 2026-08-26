import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

function cleanId(value?: string | null) {
  return value || undefined;
}

function lifecycleValidation(type: string, body: any) {
  if (!body.employeeId) return 'Employee is required';
  if (!type) return 'Lifecycle event type is required';
  if (!body.effectiveDate) return 'Effective date is required';
  if (type === 'PROMOTION' && !body.newPositionId && !body.newSalary) return 'Promotion requires a new position or new salary';
  if (type === 'TRANSFER' && !body.newDepartmentId) return 'Transfer requires a new department';
  if (type === 'SEPARATION' && !body.reason) return 'Separation requires a reason';
  return null;
}

export const getLifecycleEvents = async (req: Request, res: Response) => {
  try {
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;
    const items = await prisma.employeeLifecycleEvent.findMany({
      where,
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } }, department: true, position: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLifecycleEvent = async (req: Request, res: Response) => {
  try {
    const type = req.body.type;
    const validation = lifecycleValidation(type, req.body);
    if (validation) return error(res, validation, 400);
    const employee = await prisma.employee.findFirst({ where: { id: req.body.employeeId, user: { companyId: (req as any).user?.companyId || '__missing_company__' } } });
    if (!employee) return error(res, 'Employee not found', 404);
    if (employee.status === 'TERMINATED' && type !== 'ONBOARDING') return error(res, 'Terminated employees can only receive onboarding/reactivation events', 400);
    const open = await prisma.employeeLifecycleEvent.findFirst({ where: { employeeId: employee.id, status: 'DRAFT' } });
    if (open) return error(res, 'This employee already has a draft lifecycle event. Apply or cancel it before creating another.', 400);

    const item = await prisma.employeeLifecycleEvent.create({
      data: {
        employeeId: employee.id,
        type,
        effectiveDate: new Date(req.body.effectiveDate),
        previousDepartmentId: employee.departmentId,
        previousPositionId: employee.positionId,
        previousSalary: employee.salary,
        newDepartmentId: cleanId(req.body.newDepartmentId),
        newPositionId: cleanId(req.body.newPositionId),
        newSalary: req.body.newSalary ? Number(req.body.newSalary) : undefined,
        reason: req.body.reason,
        notes: req.body.notes,
      },
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } }, department: true, position: true } } },
    });
    return success(res, item, 'Lifecycle event drafted', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateLifecycleEventStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.employeeLifecycleEvent.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Lifecycle event not found');
      if (existing.status !== 'DRAFT') throw new Error('Only draft lifecycle events can be applied or cancelled');
      if (status === 'CANCELLED') {
        return tx.employeeLifecycleEvent.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
      }
      if (status !== 'SUBMITTED') throw new Error('Invalid lifecycle status');
      if (existing.effectiveDate < new Date(new Date().setHours(0, 0, 0, 0)) && !req.body.allowBackdated) {
        throw new Error('Backdated lifecycle events require allowBackdated=true');
      }
      const employeeData: any = {};
      if (existing.type === 'TRANSFER') {
        employeeData.departmentId = existing.newDepartmentId;
        if (existing.newPositionId) employeeData.positionId = existing.newPositionId;
      }
      if (existing.type === 'PROMOTION') {
        if (existing.newDepartmentId) employeeData.departmentId = existing.newDepartmentId;
        if (existing.newPositionId) employeeData.positionId = existing.newPositionId;
        if (existing.newSalary) employeeData.salary = Number(existing.newSalary);
      }
      if (existing.type === 'SEPARATION') {
        employeeData.status = 'TERMINATED';
        employeeData.terminatedDate = existing.effectiveDate;
      } else if (existing.type === 'ONBOARDING') {
        employeeData.status = 'ACTIVE';
        employeeData.terminatedDate = null;
        if (existing.newDepartmentId) employeeData.departmentId = existing.newDepartmentId;
        if (existing.newPositionId) employeeData.positionId = existing.newPositionId;
      }
      await tx.employee.update({ where: { id: existing.employeeId }, data: employeeData });
      return tx.employeeLifecycleEvent.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    });
    return success(res, item, status === 'SUBMITTED' ? 'Lifecycle event approved and applied' : 'Lifecycle event cancelled');
  } catch (err: any) {
    return error(res, err.message || 'Unable to update lifecycle event', 400);
  }
};

export const getHrDashboard = async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId || '__missing_company__';
    const employee = { user: { companyId } };
    const [employees, pendingLeaves, openPayrolls, activeDepartments] = await Promise.all([
      prisma.employee.count({ where: { status: { in: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] }, ...employee } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING', employee } }),
      prisma.payrollEntry.count({ where: { status: { in: ['DRAFT', 'SUBMITTED'] } } }),
      prisma.department.count({ where: { isActive: true } }),
    ]);
    return success(res, { employees, pendingLeaves, openPayrolls, activeDepartments });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
