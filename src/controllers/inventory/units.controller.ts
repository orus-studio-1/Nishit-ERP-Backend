import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { pickDefined } from '../../utils/payload';

const DEFAULT_UNITS = [
  { name: 'Piece', symbol: 'pcs' },
  { name: 'Number', symbol: 'nos' },
  { name: 'Kilogram', symbol: 'kg' },
  { name: 'Gram', symbol: 'g' },
  { name: 'Litre', symbol: 'L' },
  { name: 'Millilitre', symbol: 'ml' },
  { name: 'Meter', symbol: 'm' },
  { name: 'Square Meter', symbol: 'm²' },
  { name: 'Box', symbol: 'box' },
  { name: 'Pack', symbol: 'pack' },
  { name: 'Set', symbol: 'set' },
  { name: 'Pair', symbol: 'pair' },
  { name: 'Tonne', symbol: 't' },
];

export const getUnits = async (req: Request, res: Response) => {
  try {
    if (await prisma.unit.count() === 0) {
      await prisma.unit.createMany({ data: DEFAULT_UNITS, skipDuplicates: true });
    }
    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } });
    return success(res, units);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateUnit = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name || '').trim();
    const symbol = String(req.body.symbol || '').trim();
    if (!name || !symbol) return error(res, 'Unit name and symbol are required', 400);
    return success(res, await prisma.unit.update({ where: { id: req.params.id }, data: { name, symbol } }), 'Unit updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createUnit = async (req: Request, res: Response) => {
  try {
    if (!String(req.body.name || '').trim() || !String(req.body.symbol || '').trim()) return error(res, 'Unit name and symbol are required', 400);
    const unit = await prisma.unit.create({ data: pickDefined(req.body, ['name', 'symbol']) as any });
    return success(res, unit, 'Unit created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteUnit = async (req: Request, res: Response) => {
  try {
    await prisma.unit.delete({ where: { id: req.params.id } });
    return success(res, null, 'Unit deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
