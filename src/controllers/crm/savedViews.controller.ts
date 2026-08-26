import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';

export const getSavedViews = async (req: AuthRequest, res: Response) => {
  try {
    const { entity } = req.query as any;
    const views = await prisma.crmSavedView.findMany({
      where: { userId: req.user!.id, ...(entity ? { entity } : {}) },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return success(res, views);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createSavedView = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.name || !req.body.entity) return error(res, 'name and entity are required', 400);
    const view = await prisma.crmSavedView.create({
      data: {
        companyId: req.user?.companyId,
        userId: req.user!.id,
        name: req.body.name,
        entity: req.body.entity,
        filters: req.body.filters || {},
        columns: req.body.columns,
        isDefault: !!req.body.isDefault,
      },
    });
    return success(res, view, 'Saved view created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteSavedView = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.crmSavedView.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    return success(res, null, 'Saved view deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
