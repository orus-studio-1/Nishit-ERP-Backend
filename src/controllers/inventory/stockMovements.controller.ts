import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { postStockLedger, postStockTransfer } from '../../services/inventory/stockLedger.service';

export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { productId, warehouseId, type } = req.query as any;
    const where: any = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.stockMovement.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createStockMovement = async (req: Request, res: Response) => {
  try {
    const { productId, warehouseId, type, quantity, unitCost, reference, notes,batchNumber,serialNumber } = req.body;

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: { productId, warehouseId, type, quantity, unitCost, reference, notes },
        include: { product: true, warehouse: true },
      });
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new Error('Product not found');
      }

      let batchId: string | undefined;
      let serialNoId: string | undefined;

      if (product.hasBatchNo) {
        if (!batchNumber || !batchNumber.trim()) {
          throw new Error(`Batch number is required for ${product.name}`);
        }
        const batch = await tx.batch.findFirst({
          where: { productId, warehouseId, batchNo: batchNumber.trim() },
        });
        if (!batch) {
          throw new Error(`Batch "${batchNumber}" does not exist in the selected warehouse`);
        }
        batchId = batch.id;
      }

      if (product.hasSerialNo) {
        if (!serialNumber || !serialNumber.trim()) {
          throw new Error(`Serial number is required for ${product.name}`);
        }
        const serial = await tx.serialNumber.findFirst({
          where: { productId, serialNo: serialNumber.trim() },
        });
        if (!serial) {
          throw new Error(`Serial number "${serialNumber}" does not exist for ${product.name}`);
        }
        serialNoId = serial.id;
      }

      if (type === 'TRANSFER' && req.body.toWarehouseId) {
        await postStockTransfer(tx, {
          productId,
          fromWarehouseId: warehouseId,
          toWarehouseId: req.body.toWarehouseId,
          quantity,
          rate: unitCost || 0,
          voucherType: 'STOCK_MOVEMENT',
          voucherId: created.id,
          voucherNo: reference || created.id,
          remarks: notes,
        });
      } else {
        const sign = type === 'OUT' ? -1 : 1;
        await postStockLedger(tx, {
          productId,
          warehouseId,
          actualQty: Number(quantity) * sign,
          rate: unitCost || 0,
          voucherType: 'STOCK_MOVEMENT',
          voucherId: created.id,
          voucherNo: reference || created.id,
          remarks: notes,
          batchId,
          serialNoId
        });
      }
      return created;
    });

    return success(res, movement, 'Stock movement recorded', 201);
  } catch (err: any) {
      if (err instanceof Error && !('code' in err)) {
        return error(res, err.message, 400);
      }
      return handlePrismaError(res, err);
  }
};
