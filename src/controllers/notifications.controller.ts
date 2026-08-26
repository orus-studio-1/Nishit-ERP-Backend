import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';

export const listNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const unreadOnly = req.query.unread === 'true';
    const where = { userId: req.user!.id, ...(unreadOnly ? { isRead: false } : {}) };
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    ]);
    return success(res, { items, unread });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const markNotificationRead = async (req: AuthRequest, res: Response) => {
  try {
    const updated = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { isRead: true },
    });
    if (!updated.count) return error(res, 'Notification not found', 404);
    return success(res, null, 'Notification marked as read');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const markAllNotificationsRead = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
    return success(res, null, 'Notifications marked as read');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
