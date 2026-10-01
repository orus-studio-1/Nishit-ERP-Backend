import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { postStockLedger, postStockTransfer } from '../../services/inventory/stockLedger.service';
import { respondPaginated } from '../../utils/pagination';

async function resolveBatchAndSerial(tx: any, item: any, warehouseId: string) {
  let batchId = item.batchId || undefined;
  let serialNoId = item.serialNoId || undefined;

  if (!batchId && String(item.batchNo || '').trim()) {
    if (!warehouseId) throw new Error('Warehouse is required to create a batch');
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    const existingBatch = await tx.batch.findFirst({ where: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim() } });
    const batch = existingBatch || await tx.batch.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim(), quantity: 0 } });
    batchId = batch.id;
  }
  
  if (!serialNoId && String(item.serialNo || '').trim()) {
    if (!warehouseId) throw new Error('Warehouse is required to create a serial number');
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    const existingSerial = await tx.serialNumber.findFirst({ where: { companyId: product?.companyId, productId: item.productId, serialNo: String(item.serialNo).trim() } });
    if (existingSerial) throw new Error(`Serial number ${item.serialNo} already exists`);
    const serial = await tx.serialNumber.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, serialNo: String(item.serialNo).trim(), batchId, status: 'AVAILABLE' } });
    serialNoId = serial.id;
  }

  return { batchId, serialNoId };
}

export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const { productId, warehouseId, type } = req.query as any;
    const where: any = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (type) where.type = type;

    return respondPaginated(res, prisma.stockMovement, req, { where, include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } } });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createStockMovement = async (req: Request, res: Response) => {
  try {
    const { productId, warehouseId, type, quantity, unitCost, reference, notes, batchId, batchNo, batchNumber, serialNoId, serialNo, serialNumber } = req.body;

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: { productId, warehouseId, type, quantity, unitCost, reference, notes },
        include: { product: true, warehouse: true },
      });
      const resolved = await resolveBatchAndSerial(tx, { 
        productId, 
        batchId, 
        batchNo: batchNo || batchNumber, 
        serialNoId, 
        serialNo: serialNo || serialNumber 
      }, warehouseId);
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
          batchId: resolved.batchId,
          serialNoId: resolved.serialNoId,
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
          batchId: resolved.batchId,
          serialNoId: resolved.serialNoId,
        });
      }
      return created;
    });

    return success(res, movement, 'Stock movement recorded', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const bulkCreateStockMovements = async (req: Request, res: Response) => {
  try {
    const movements = req.body.movements || [];
    if (!Array.isArray(movements) || !movements.length) {
      return error(res, 'At least one stock movement is required', 400);
    }

    const createdMovements = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const m of movements) {
        const { productId, warehouseId, type, quantity, unitCost, reference, notes, batchId, batchNo, serialNoId, serialNo } = m;
        const created = await tx.stockMovement.create({
          data: { productId, warehouseId, type, quantity, unitCost, reference, notes },
          include: { product: true, warehouse: true },
        });

        const resolved = await resolveBatchAndSerial(tx, { productId, batchId, batchNo, serialNoId, serialNo }, warehouseId);

        if (type === 'TRANSFER' && m.toWarehouseId) {
          await postStockTransfer(tx, {
            productId,
            fromWarehouseId: warehouseId,
            toWarehouseId: m.toWarehouseId,
            quantity,
            rate: unitCost || 0,
            voucherType: 'STOCK_MOVEMENT',
            voucherId: created.id,
            voucherNo: reference || created.id,
            remarks: notes,
            batchId: resolved.batchId,
            serialNoId: resolved.serialNoId,
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
            batchId: resolved.batchId,
            serialNoId: resolved.serialNoId,
          });
        }
        results.push(created);
      }
      return results;
    });

    return success(res, { count: createdMovements.length, items: createdMovements }, 'Bulk stock movements recorded', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};
