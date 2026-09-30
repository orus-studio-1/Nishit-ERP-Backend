import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { pickDefined } from '../../utils/payload';
import { respondPaginated } from '../../utils/pagination';

const productFields = ['sku', 'name', 'description', 'categoryId', 'unitId', 'type', 'supplyPolicy', 'costPrice', 'salePrice', 'taxRate', 'minStockLevel', 'maxStockLevel', 'valuationMethod', 'maintainStock', 'allowNegativeStock', 'hasBatchNo', 'hasSerialNo', 'reorderLevel', 'reorderQty', 'brand', 'manufacturer', 'isActive', 'image', 'barcode', 'weight', 'hsnCode', 'taxCode', 'defaultTaxTemplateId', 'defaultWarehouseId', 'isVariant', 'variantOfId', 'itemNature', 'shelfLifeDays', 'receiptInspectionRequired', 'inProcessInspectionRequired', 'finalInspectionRequired', 'safetyStock', 'leadTimeDays', 'minimumOrderQty', 'orderMultiple', 'backflush', 'drawingReference', 'revisionReference', 'batchAllocationStrategy', 'inventoryAccountId', 'cogsAccountId', 'stockAdjustmentAccountId'] as const;

export const getProducts = async (req: Request, res: Response) => {
  try {
    const { categoryId, type, search, isActive } = req.query as any;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];

    return respondPaginated(res, prisma.product, req, { where, include: { category: true, unit: true, stockLevels: { include: { warehouse: true } } } });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getProduct = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true, unit: true, stockLevels: { include: { warehouse: true } }, uomConversions: true, warehouseRules: { include: { warehouse: true } }, customerCodes: true, supplierItems: true },
    });
    if (!product) return error(res, 'Product not found', 404);
    return success(res, product);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const searchProducts = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return success(res, []);
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        salePrice: true,
        taxRate: true,
        defaultTaxTemplateId: true,
        unitId: true,
        unit: { select: { id: true, name: true, symbol: true } },
        defaultTaxTemplate: { select: { id: true, name: true, code: true, lines: { orderBy: { rowOrder: 'asc' }, select: { rate: true } } } },
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return success(res, products.map((p: any) => ({
      ...p,
      salePrice: Number(p.salePrice || 0),
      taxRate: p.defaultTaxTemplate?.lines?.length
        ? p.defaultTaxTemplate.lines.reduce((sum: number, line: any) => sum + Number(line.rate || 0), 0)
        : Number(p.taxRate || 0),
    })));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const data = pickDefined(req.body, productFields) as any;
    if (!data.defaultWarehouseId) {
      const warehouse = await prisma.warehouse.findFirst({ orderBy: { code: 'asc' } });
      if (warehouse) data.defaultWarehouseId = warehouse.id;
    }
    
    const product = await prisma.product.create({
      data,
      include: { category: true, unit: true },
    });
    return success(res, product, 'Product created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: pickDefined(req.body, productFields) as any,
      include: { category: true, unit: true },
    });
    return success(res, product, 'Product updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    return success(res, product, 'Product deactivated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
