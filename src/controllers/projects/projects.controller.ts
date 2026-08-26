import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';

export const getProjects = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { status, search } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          members: { include: { project: false } },
          _count: { select: { tasks: true, milestones: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.project.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getProject = async (req: Request, res: Response) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        tasks: { include: { assignee: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        documents: true,
        members: true,
      },
    });
    if (!project) return error(res, 'Project not found', 404);
    return success(res, project);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createProject = async (req: Request, res: Response) => {
  try {
    const { name, description, status, priority, startDate, endDate, budget } = req.body;
    const project = await prisma.project.create({
      data: {
        name, description, status, priority,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        budget,
      },
    });
    return success(res, project, 'Project created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateProject = async (req: Request, res: Response) => {
  try {
    const { name, description, status, priority, startDate, endDate, budget, progress } = req.body;
    const project = await prisma.project.update({ where: { id: req.params.id }, data: {
      name, description, status, priority,
      startDate: startDate ? new Date(startDate) : startDate === null ? null : undefined,
      endDate: endDate ? new Date(endDate) : endDate === null ? null : undefined,
      budget: budget === null ? null : budget !== undefined ? Number(budget) : undefined,
      progress: progress !== undefined ? Math.max(0, Math.min(100, Number(progress))) : undefined,
    } });
    return success(res, project, 'Project updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    return success(res, null, 'Project deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const addProjectMember = async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body;
    const targetUser = await prisma.user.findFirst({ where: { id: userId, companyId: (req as AuthRequest).user?.companyId || '__missing_company__' } });
    if (!targetUser) return error(res, 'User not found in this company', 404);
    const project = await prisma.project.findFirst({ where: { id: req.params.id } });
    if (!project) return error(res, 'Project not found', 404);
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: req.params.id, userId } },
      update: { role },
      create: { projectId: req.params.id, userId, role },
    });
    return success(res, member, 'Member added');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const removeProjectMember = async (req: Request, res: Response) => {
  try {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
    });
    return success(res, null, 'Member removed');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
