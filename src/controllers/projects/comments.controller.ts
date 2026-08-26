import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';

export const getComments = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.query as any;
    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return success(res, comments);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createComment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.content || !req.body.taskId) return error(res, 'Comment content and task are required', 400);
    const comment = await prisma.comment.create({
      data: { content: String(req.body.content).trim(), taskId: req.body.taskId, userId: req.user!.id },
      include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
    });
    return success(res, comment, 'Comment added', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteComment = async (req: Request, res: Response) => {
  try {
    await prisma.comment.delete({ where: { id: req.params.id } });
    return success(res, null, 'Comment deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
