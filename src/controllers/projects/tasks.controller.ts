import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';
import { respondPaginated } from '../../utils/pagination';

export const getTasks = async (req: Request, res: Response) => {
  try {
    const { projectId, status, assigneeId, priority } = req.query as any;
    const where: any = { parentId: null };
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;
    if (priority) where.priority = priority;

    return respondPaginated(res, prisma.task, req, {
      where,
      include: {
        assignee: { select: { firstName: true, lastName: true, avatar: true } },
        creator: { select: { firstName: true, lastName: true } },
        subtasks: { include: { assignee: { select: { firstName: true, lastName: true } } } },
        _count: { select: { comments: true } },
      },
      defaultLimit: 50,
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getTask = async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { firstName: true, lastName: true, avatar: true } },
        creator: { select: { firstName: true, lastName: true } },
        project: { select: { name: true } },
        subtasks: true,
        comments: {
          include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) return error(res, 'Task not found', 404);
    return success(res, task);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createTask = async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, projectId, assigneeId, status, priority, dueDate, parentId, tags } = req.body;
    if (!title) return error(res, 'Task title is required', 400);
    const task = await prisma.task.create({
      data: { title, description, projectId, assigneeId, status, priority, dueDate: dueDate ? new Date(dueDate) : undefined, parentId, tags: Array.isArray(tags) ? tags : [], creatorId: req.user!.id },
      include: {
        assignee: { select: { firstName: true, lastName: true } },
        creator: { select: { firstName: true, lastName: true } },
      },
    });
    return success(res, task, 'Task created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateTask = async (req: Request, res: Response) => {
  try {
    const { title, description, projectId, assigneeId, status, priority, dueDate, parentId, tags } = req.body;
    const data: any = { title, description, projectId, assigneeId, status, priority, dueDate: dueDate ? new Date(dueDate) : dueDate === null ? null : undefined, parentId, tags: Array.isArray(tags) ? tags : undefined };
    if (req.body.status === 'DONE' && !req.body.completedAt) data.completedAt = new Date();
    const task = await prisma.task.update({ where: { id: req.params.id }, data });
    return success(res, task, 'Task updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteTask = async (req: Request, res: Response) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    return success(res, null, 'Task deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
