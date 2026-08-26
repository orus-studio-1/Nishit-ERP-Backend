import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { success, paginated, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { generateSupplierNo } from '../utils/generate';
import { pickDefined } from '../utils/payload';

const supplierFields = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'country', 'zip', 'taxId', 'currency',
  'paymentTerms', 'bankAccount', 'bankName', 'notes', 'isActive', 'panAvailable', 'pan', 'tdsSection',
  'tdsRate', 'tdsThreshold', 'lowerDeductionRate', 'lowerDeductionValidUntil', 'msmeRegistered',
  'msmeCategory', 'msmeRegistrationNo', 'reverseChargeApplicable', 'defaultItcEligibility', 'isImportSupplier',
] as const;

export const getSuppliers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { search, isActive } = req.query as any;
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { supplierNo: { contains: search, mode: 'insensitive' } },
    ];

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: { _count: { select: { purchaseOrders: true, invoices: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.supplier.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getSupplier = async (req: Request, res: Response) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrders: { take: 5, orderBy: { createdAt: 'desc' } },
        invoices: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!supplier) return error(res, 'Supplier not found', 404);
    return success(res, supplier);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createSupplier = async (req: Request, res: Response) => {
  try {
    const supplierNo = await generateSupplierNo();
    const supplier = await prisma.supplier.create({ data: { ...pickDefined(req.body, supplierFields), supplierNo } as any });
    return success(res, supplier, 'Supplier created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateSupplier = async (req: Request, res: Response) => {
  try {
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: pickDefined(req.body, supplierFields) as any });
    return success(res, supplier, 'Supplier updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteSupplier = async (req: Request, res: Response) => {
  try {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    return success(res, null, 'Supplier deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
