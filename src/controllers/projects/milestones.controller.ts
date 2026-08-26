import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';

export const getMilestones = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query as any;
    const where: any = {};
    if (projectId) where.projectId = projectId;
    const milestones = await prisma.milestone.findMany({
      where,
      include: { project: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    return success(res, milestones);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createMilestone = async (req: Request, res: Response) => {
  try {
    const { name, description, projectId, dueDate, status } = req.body;
    if (!name || !projectId) return error(res, 'Milestone name and project are required', 400);
    const m = await prisma.milestone.create({ data: { name, description, projectId, dueDate: dueDate ? new Date(dueDate) : undefined, status } });
    return success(res, m, 'Milestone created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateMilestone = async (req: Request, res: Response) => {
  try {
    const { name, description, dueDate, status } = req.body;
    const m = await prisma.milestone.update({ where: { id: req.params.id }, data: { name, description, dueDate: dueDate ? new Date(dueDate) : dueDate === null ? null : undefined, status } });
    return success(res, m, 'Milestone updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteMilestone = async (req: Request, res: Response) => {
  try {
    await prisma.milestone.delete({ where: { id: req.params.id } });
    return success(res, null, 'Milestone deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
