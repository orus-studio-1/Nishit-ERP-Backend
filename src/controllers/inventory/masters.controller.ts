import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

export const getProductAttributes = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.productAttribute.findMany({ include: { values: true }, orderBy: { name: 'asc' } });
    return success(res, items);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createProductAttribute = async (req: Request, res: Response) => {
  try {
    if (!req.body.name) return error(res, 'name is required', 400);
    const attribute = await prisma.productAttribute.create({ data: { name: req.body.name, values: { create: (req.body.values || []).map((value: string) => ({ value })) } }, include: { values: true } });
    return success(res, attribute, 'Product attribute created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createUomConversion = async (req: Request, res: Response) => {
  try {
    const { productId, fromUnitId, toUnitId, factor } = req.body;
    if (!productId || !fromUnitId || !toUnitId || !factor) return error(res, 'productId, fromUnitId, toUnitId and factor are required', 400);
    const row = await prisma.productUomConversion.create({ data: { productId, fromUnitId, toUnitId, factor: new Prisma.Decimal(factor) } });
    return success(res, row, 'UOM conversion created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getUomConversions = async (_req: Request, res: Response) => {
  try {
    return success(res, await prisma.productUomConversion.findMany({ include: { product: true }, orderBy: { createdAt: 'desc' } }));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteUomConversion = async (req: Request, res: Response) => {
  try {
    await prisma.productUomConversion.delete({ where: { id: req.params.id } });
    return success(res, null, 'UOM conversion deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getBatches = async (req: Request, res: Response) => {
  try {
    const { productId, warehouseId } = req.query as any;
    const batches = await prisma.batch.findMany({ where: { ...(productId ? { productId } : {}), ...(warehouseId ? { warehouseId } : {}) }, include: { product: true, warehouse: true }, orderBy: { createdAt: 'desc' } });
    return success(res, batches);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createBatch = async (req: Request, res: Response) => {
  try {
    const { batchNo, productId } = req.body;
    if (!batchNo || !productId) return error(res, 'batchNo and productId are required', 400);
    const batch = await prisma.batch.create({ data: { ...req.body, expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined, manufacturingDate: req.body.manufacturingDate ? new Date(req.body.manufacturingDate) : undefined } });
    return success(res, batch, 'Batch created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getSerialNumbers = async (req: Request, res: Response) => {
  try {
    const { productId, warehouseId, status } = req.query as any;
    const serials = await prisma.serialNumber.findMany({ where: { ...(productId ? { productId } : {}), ...(warehouseId ? { warehouseId } : {}), ...(status ? { status } : {}) }, include: { product: true, warehouse: true }, orderBy: { createdAt: 'desc' } });
    return success(res, serials);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createSerialNumber = async (req: Request, res: Response) => {
  try {
    const { serialNo, productId } = req.body;
    if (!serialNo || !productId) return error(res, 'serialNo and productId are required', 400);
    const serial = await prisma.serialNumber.create({ data: { ...req.body, purchaseRate: req.body.purchaseRate ? new Prisma.Decimal(req.body.purchaseRate) : undefined } });
    return success(res, serial, 'Serial number created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
