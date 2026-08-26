import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { pickDefined } from '../../utils/payload';

export const getPriceLists = async (_req: Request, res: Response) => {
  try {
    return success(res, await prisma.priceList.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { itemPrices: true, pricingRules: true } } } }));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPriceList = async (req: Request, res: Response) => {
  try {
    if (!req.body.name) return error(res, 'name is required', 400);
    const item = await prisma.priceList.create({ data: pickDefined(req.body, ['name', 'currency', 'isBuying', 'isSelling', 'isActive']) as any });
    return success(res, item, 'Price list created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getItemPrices = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { productId, priceListId, customerId } = req.query as any;
    const where: any = {};
    if (productId) where.productId = productId;
    if (priceListId) where.priceListId = priceListId;
    if (customerId) where.customerId = customerId;
    const [items, total] = await Promise.all([
      prisma.itemPrice.findMany({ where, include: { product: true, priceList: true }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.itemPrice.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createItemPrice = async (req: Request, res: Response) => {
  try {
    const { productId, priceListId, price } = req.body;
    if (!productId || !priceListId || price === undefined) return error(res, 'productId, priceListId and price are required', 400);
    const item = await prisma.itemPrice.create({
      data: {
        ...req.body,
        price: new Prisma.Decimal(price),
        validFrom: req.body.validFrom ? new Date(req.body.validFrom) : undefined,
        validTo: req.body.validTo ? new Date(req.body.validTo) : undefined,
      },
      include: { product: true, priceList: true },
    });
    return success(res, item, 'Item price created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getPricingRules = async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.pricingRule.findMany({ include: { priceList: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] });
    return success(res, rules);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPricingRule = async (req: Request, res: Response) => {
  try {
    if (!req.body.name) return error(res, 'name is required', 400);
    const rule = await prisma.pricingRule.create({
      data: {
        ...req.body,
        minQty: req.body.minQty ? new Prisma.Decimal(req.body.minQty) : undefined,
        maxQty: req.body.maxQty ? new Prisma.Decimal(req.body.maxQty) : undefined,
        discountPercent: new Prisma.Decimal(req.body.discountPercent || 0),
        marginPercent: new Prisma.Decimal(req.body.marginPercent || 0),
        validFrom: req.body.validFrom ? new Date(req.body.validFrom) : undefined,
        validTo: req.body.validTo ? new Date(req.body.validTo) : undefined,
      },
    });
    return success(res, rule, 'Pricing rule created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
