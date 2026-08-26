import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { pickDefined } from '../../utils/payload';

// ---- DEPARTMENTS ----
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const depts = await prisma.department.findMany({
      include: { _count: { select: { employees: true } }, positions: true },
      orderBy: { name: 'asc' },
    });
    return success(res, depts);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!name || !code) return error(res, 'Department name and code are required', 400);
    const dept = await prisma.department.create({ data: { ...pickDefined(req.body, ['description']), name, code } });
    return success(res, dept, 'Department created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const dept = await prisma.department.update({ where: { id: req.params.id }, data: pickDefined(req.body, ['name', 'code', 'description']) });
    return success(res, dept, 'Department updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    await prisma.department.delete({ where: { id: req.params.id } });
    return success(res, null, 'Department deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

// ---- POSITIONS ----
export const getPositions = async (req: Request, res: Response) => {
  try {
    const positions = await prisma.position.findMany({
      include: { department: true, _count: { select: { employees: true } } },
      orderBy: { title: 'asc' },
    });
    return success(res, positions);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPosition = async (req: Request, res: Response) => {
  try {
    const title = String(req.body.title || '').trim();
    const departmentId = String(req.body.departmentId || '').trim();
    if (!title || !departmentId) return error(res, 'Position title and department are required', 400);
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) return error(res, 'Department not found for this position', 404);
    const pos = await prisma.position.create({
      data: {
        title,
        departmentId,
        description: req.body.description,
        minSalary: req.body.minSalary === '' || req.body.minSalary == null ? undefined : Number(req.body.minSalary),
        maxSalary: req.body.maxSalary === '' || req.body.maxSalary == null ? undefined : Number(req.body.maxSalary),
      },
      include: { department: true, _count: { select: { employees: true } } },
    });
    return success(res, pos, 'Position created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updatePosition = async (req: Request, res: Response) => {
  try {
    const data: any = {};
    if (req.body.title !== undefined) data.title = String(req.body.title || '').trim();
    if (req.body.departmentId !== undefined) data.departmentId = req.body.departmentId;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.minSalary !== undefined) data.minSalary = req.body.minSalary === '' || req.body.minSalary == null ? null : Number(req.body.minSalary);
    if (req.body.maxSalary !== undefined) data.maxSalary = req.body.maxSalary === '' || req.body.maxSalary == null ? null : Number(req.body.maxSalary);
    if (!data.title && req.body.title !== undefined) return error(res, 'Position title is required', 400);
    if (data.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) return error(res, 'Department not found for this position', 404);
    }
    const pos = await prisma.position.update({
      where: { id: req.params.id },
      data,
      include: { department: true, _count: { select: { employees: true } } },
    });
    return success(res, pos, 'Position updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deletePosition = async (req: Request, res: Response) => {
  try {
    const used = await prisma.employee.count({ where: { positionId: req.params.id } });
    if (used > 0) return error(res, 'This position is assigned to employees. Reassign employees before deleting it.', 400);
    await prisma.position.delete({ where: { id: req.params.id } });
    return success(res, null, 'Position deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
