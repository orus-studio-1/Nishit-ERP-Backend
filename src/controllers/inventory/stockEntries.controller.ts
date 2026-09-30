import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { postStockLedger, postStockTransfer } from '../../services/inventory/stockLedger.service';
import { respondPaginated } from '../../utils/pagination';

const include = {
  fromWarehouse: true,
  toWarehouse: true,
  items: { include: { product: true, warehouse: true } },
};

async function nextStockEntryNo(tx: any) {
  let series = await tx.numberingSeries.findFirst({ where: { documentType: 'STOCK_ENTRY', isActive: true, isDefault: true } });
  if (!series) {
    series = await tx.numberingSeries.create({
      data: { documentType: 'STOCK_ENTRY', name: 'STE-DEFAULT', pattern: `STE-${new Date().getFullYear()}-#####`, prefix: 'STE', digits: 5, isDefault: true },
    });
  }
  const updated = await tx.numberingSeries.update({ where: { id: series.id }, data: { current: { increment: 1 } } });
  return updated.pattern.replace('#'.repeat(updated.digits), String(updated.current).padStart(updated.digits, '0'));
}

function itemData(items: any[] = []) {
  return items.map((item) => ({
    productId: item.productId,
    warehouseId: item.warehouseId || undefined,
    quantity: new Prisma.Decimal(item.quantity || 0),
    valuationRate: new Prisma.Decimal(item.valuationRate || item.rate || 0),
    batchId: item.batchId || undefined,
    serialNoId: item.serialNoId || undefined,
    remarks: item.remarks,
  }));
}

async function postStockEntry(tx: any, entry: any, reverse = false) {
  const sign = reverse ? -1 : 1;
  for (const item of entry.items) {
    const qty = new Prisma.Decimal(item.quantity).mul(sign);
    if (entry.purpose === 'REPACK') {
      const targetWarehouse = item.warehouseId || entry.toWarehouseId || entry.fromWarehouseId;
      if (!targetWarehouse) throw new Error('Warehouse is required for repack item');
      await postStockLedger(tx, {
        productId: item.productId,
        warehouseId: targetWarehouse,
        actualQty: qty,
        rate: item.valuationRate,
        postingDate: entry.postingDate,
        voucherType: 'STOCK_ENTRY',
        voucherId: entry.id,
        voucherNo: entry.entryNo,
        remarks: reverse ? `Reversal of repack ${entry.entryNo}` : entry.remarks,
        batchId: item.batchId,
        serialNoId: item.serialNoId,
      });
      continue;
    }
    if (entry.purpose === 'STOCK_RECONCILIATION' || entry.purpose === 'OPENING_STOCK') {
      const targetWarehouse = item.warehouseId || entry.toWarehouseId || entry.fromWarehouseId;
      if (!targetWarehouse) throw new Error('Warehouse is required for stock reconciliation item');
      const level = await tx.stockLevel.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: targetWarehouse } } });
      const currentQty = new Prisma.Decimal(level?.quantity || 0);
      const targetQty = reverse ? currentQty.minus(qty.minus(currentQty)) : qty;
      const diffQty = reverse ? qty.neg() : targetQty.minus(currentQty);
      await postStockLedger(tx, {
        productId: item.productId,
        warehouseId: targetWarehouse,
        actualQty: diffQty,
        rate: item.valuationRate,
        postingDate: entry.postingDate,
        voucherType: 'STOCK_ENTRY',
        voucherId: entry.id,
        voucherNo: entry.entryNo,
        remarks: reverse ? `Reversal of ${entry.entryNo}` : entry.remarks,
        batchId: item.batchId,
        serialNoId: item.serialNoId,
      });
      continue;
    }
    if (entry.purpose === 'MATERIAL_TRANSFER') {
      if (!entry.fromWarehouseId || !entry.toWarehouseId) throw new Error('Transfer requires source and target warehouse');
      await postStockTransfer(tx, {
        productId: item.productId,
        fromWarehouseId: reverse ? entry.toWarehouseId : entry.fromWarehouseId,
        toWarehouseId: reverse ? entry.fromWarehouseId : entry.toWarehouseId,
        quantity: item.quantity,
        rate: item.valuationRate,
        postingDate: entry.postingDate,
        voucherType: 'STOCK_ENTRY',
        voucherId: entry.id,
        voucherNo: entry.entryNo,
        batchId: item.batchId || undefined,
        serialNoId: item.serialNoId || undefined,
        remarks: reverse ? 'Reversal of stock transfer' : entry.remarks,
      });
      continue;
    }
    const targetWarehouse = item.warehouseId || entry.toWarehouseId || entry.fromWarehouseId;
    if (!targetWarehouse) throw new Error('Warehouse is required for stock entry item');
    const outgoing = ['MATERIAL_ISSUE', 'SCRAP', 'SUPPLIER_RETURN', 'JOB_WORK_ISSUE'].includes(entry.purpose);
    await postStockLedger(tx, {
      productId: item.productId,
      warehouseId: targetWarehouse,
      actualQty: outgoing ? qty.neg() : qty,
      rate: item.valuationRate,
      postingDate: entry.postingDate,
      voucherType: 'STOCK_ENTRY',
      voucherId: entry.id,
      voucherNo: entry.entryNo,
      remarks: reverse ? `Reversal of ${entry.entryNo}` : entry.remarks,
      batchId: item.batchId,
      serialNoId: item.serialNoId,
    });
  }
}

async function reverseStockEntry(tx: any, entry: any) {
  const ledgerRows = await tx.stockLedgerEntry.findMany({ where: { voucherType: 'STOCK_ENTRY', voucherId: entry.id, isCancelled: false } });
  for (const row of ledgerRows) {
    await postStockLedger(tx, {
      productId: row.productId,
      warehouseId: row.warehouseId,
      actualQty: new Prisma.Decimal(row.actualQty).neg(),
      rate: row.valuationRate,
      postingDate: new Date(),
      voucherType: 'STOCK_ENTRY',
      voucherId: entry.id,
      voucherNo: `${entry.entryNo}-CANCEL`,
      remarks: `Reversal of ${entry.entryNo}`,
      batchId: row.batchId,
      serialNoId: row.serialNoId,
      reversalOfId: row.id,
    });
    await tx.stockLedgerEntry.update({ where: { id: row.id }, data: { isCancelled: true } });
  }
}

export const getStockEntries = async (req: Request, res: Response) => {
  try {
    const { status, purpose } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (purpose) where.purpose = purpose;
    return respondPaginated(res, prisma.stockEntry, req, { where, include });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getStockEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.stockEntry.findUnique({ where: { id: req.params.id }, include });
    if (!entry) return error(res, 'Stock entry not found', 404);
    return success(res, entry);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createStockEntry = async (req: Request, res: Response) => {
  try {
    const { purpose, postingDate, fromWarehouseId, toWarehouseId, remarks, items = [] } = req.body;
    if (!purpose) return error(res, 'purpose is required', 400);
    if (!items.length) return error(res, 'At least one stock entry item is required', 400);
    if (purpose === 'MATERIAL_TRANSFER' && (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId)) return error(res, 'Material transfer requires different source and destination warehouses', 400);
    for (const item of items) {
      const quantity = new Prisma.Decimal(item.quantity || 0);
      if (!item.productId || quantity.lte(0)) return error(res, 'Every stock entry line requires a product and positive quantity', 400);
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) return error(res, 'Stock entry product not found', 404);
      if (product.hasBatchNo && !item.batchId && !String(item.batchNo || '').trim()) return error(res, `Batch is required for ${product.sku}`, 400);
      if (product.hasSerialNo && ((!item.serialNoId && !String(item.serialNo || '').trim()) || !quantity.eq(1))) return error(res, `Serialized item ${product.sku} requires one serial and quantity 1 per row`, 400);
      if (purpose !== 'MATERIAL_TRANSFER' && !item.warehouseId && !fromWarehouseId && !toWarehouseId) return error(res, `Warehouse is required for ${product.sku}`, 400);
    }
    const entry = await prisma.$transaction(async (tx) => {
      const resolvedItems = [];
      for (const item of items) {
        let batchId = item.batchId || undefined;
        let serialNoId = item.serialNoId || undefined;
        if (!batchId && String(item.batchNo || '').trim()) {
          const warehouseId = item.warehouseId || toWarehouseId || fromWarehouseId;
          if (!warehouseId) throw new Error('Warehouse is required to create a batch');
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          const existingBatch = await tx.batch.findFirst({ where: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim() } });
          const expiryDate = item.expiryDate ? new Date(item.expiryDate) : undefined;
          const batch = existingBatch || await tx.batch.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim(), quantity: 0, expiryDate } });
          batchId = batch.id;
        }
        if (!serialNoId && String(item.serialNo || '').trim()) {
          const warehouseId = item.warehouseId || toWarehouseId || fromWarehouseId;
          if (!warehouseId) throw new Error('Warehouse is required to create a serial number');
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          const existingSerial = await tx.serialNumber.findFirst({ where: { companyId: product?.companyId, productId: item.productId, serialNo: String(item.serialNo).trim() } });
          if (existingSerial) throw new Error(`Serial number ${item.serialNo} already exists`);
          const serial = await tx.serialNumber.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, serialNo: String(item.serialNo).trim(), batchId, status: 'AVAILABLE' } });
          serialNoId = serial.id;
        }
        resolvedItems.push({ ...item, batchId, serialNoId });
      }
      return tx.stockEntry.create({ data: {
        entryNo: await nextStockEntryNo(tx),
        purpose,
        postingDate: postingDate ? new Date(postingDate) : new Date(),
        fromWarehouseId: fromWarehouseId || undefined,
        toWarehouseId: toWarehouseId || undefined,
        remarks,
        items: { create: itemData(resolvedItems) },
      },
      include,
    }); });
    return success(res, entry, 'Stock entry created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const updateStockEntryStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockEntry.findUnique({ where: { id: req.params.id }, include });
      if (!existing) throw new Error('Stock entry not found');
      if (status === 'SUBMITTED') {
        if (existing.status !== 'DRAFT') throw new Error('Only draft stock entries can be submitted');
        await postStockEntry(tx, existing);
        return tx.stockEntry.update({ where: { id: existing.id }, data: { status: 'SUBMITTED', submittedAt: new Date() }, include });
      }
      if (status === 'CANCELLED') {
        if (existing.status !== 'SUBMITTED') throw new Error('Only submitted stock entries can be cancelled');
        await reverseStockEntry(tx, existing);
        return tx.stockEntry.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include });
      }
      throw new Error('Unsupported stock entry transition');
    });
    return success(res, entry, 'Stock entry updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const amendStockEntry = async (req: Request, res: Response) => {
  try {
    const amended = await prisma.$transaction(async tx => {
      const source = await tx.stockEntry.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!source) throw new Error('Stock entry not found');
      if (source.status !== 'CANCELLED') throw new Error('Only cancelled stock entries can be amended');
      return tx.stockEntry.create({ data: { entryNo: await nextStockEntryNo(tx), companyId: source.companyId, purpose: source.purpose, postingDate: new Date(), fromWarehouseId: source.fromWarehouseId, toWarehouseId: source.toWarehouseId, remarks: source.remarks, amendedFromId: source.id, revisionNo: source.revisionNo + 1, sourceDocumentType: source.sourceDocumentType, sourceDocumentId: source.sourceDocumentId, items: { create: source.items.map(item => ({ productId: item.productId, warehouseId: item.warehouseId, quantity: item.quantity, valuationRate: item.valuationRate, batchId: item.batchId, serialNoId: item.serialNoId, remarks: item.remarks })) } }, include });
    });
    return success(res, amended, 'Stock entry amendment created', 201);
  } catch (err: any) { return error(res, err.message || 'Could not amend stock entry', err.message?.includes('not found') ? 404 : 400); }
};

export const bulkCreateStockEntries = async (req: Request, res: Response) => {
  try {
    const entries = req.body.entries || [];
    if (!Array.isArray(entries) || !entries.length) {
      return error(res, 'At least one stock entry is required', 400);
    }

    for (const e of entries) {
      const { purpose, fromWarehouseId, toWarehouseId, items = [] } = e;
      if (!purpose) return error(res, 'purpose is required for all entries', 400);
      if (!items.length) return error(res, 'At least one stock entry item is required per entry', 400);
      if (purpose === 'MATERIAL_TRANSFER' && (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId)) return error(res, 'Material transfer requires different source and destination warehouses', 400);
      for (const item of items) {
        const quantity = new Prisma.Decimal(item.quantity || 0);
        if (!item.productId || quantity.lte(0)) return error(res, 'Every stock entry line requires a product and positive quantity', 400);
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product) return error(res, 'Stock entry product not found', 404);
        if (product.hasBatchNo && !item.batchId && !String(item.batchNo || '').trim()) return error(res, `Batch is required for ${product.sku}`, 400);
        if (product.hasSerialNo && ((!item.serialNoId && !String(item.serialNo || '').trim()) || !quantity.eq(1))) return error(res, `Serialized item ${product.sku} requires one serial and quantity 1 per row`, 400);
        if (purpose !== 'MATERIAL_TRANSFER' && !item.warehouseId && !fromWarehouseId && !toWarehouseId) return error(res, `Warehouse is required for ${product.sku}`, 400);
      }
    }

    const createdEntries = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const e of entries) {
        const { purpose, postingDate, fromWarehouseId, toWarehouseId, remarks, items = [] } = e;
        const resolvedItems = [];
        for (const item of items) {
          let batchId = item.batchId || undefined;
          let serialNoId = item.serialNoId || undefined;
          if (!batchId && String(item.batchNo || '').trim()) {
            const warehouseId = item.warehouseId || toWarehouseId || fromWarehouseId;
            if (!warehouseId) throw new Error('Warehouse is required to create a batch');
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            const existingBatch = await tx.batch.findFirst({ where: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim() } });
            const batch = existingBatch || await tx.batch.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, batchNo: String(item.batchNo).trim(), quantity: 0 } });
            batchId = batch.id;
          }
          if (!serialNoId && String(item.serialNo || '').trim()) {
            const warehouseId = item.warehouseId || toWarehouseId || fromWarehouseId;
            if (!warehouseId) throw new Error('Warehouse is required to create a serial number');
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            const existingSerial = await tx.serialNumber.findFirst({ where: { companyId: product?.companyId, productId: item.productId, serialNo: String(item.serialNo).trim() } });
            if (existingSerial) throw new Error(`Serial number ${item.serialNo} already exists`);
            const serial = await tx.serialNumber.create({ data: { companyId: product?.companyId, productId: item.productId, warehouseId, serialNo: String(item.serialNo).trim(), batchId, status: 'AVAILABLE' } });
            serialNoId = serial.id;
          }
          resolvedItems.push({ ...item, batchId, serialNoId });
        }
        const created = await tx.stockEntry.create({
          data: {
            entryNo: await nextStockEntryNo(tx),
            purpose,
            postingDate: postingDate ? new Date(postingDate) : new Date(),
            fromWarehouseId: fromWarehouseId || undefined,
            toWarehouseId: toWarehouseId || undefined,
            remarks,
            items: { create: itemData(resolvedItems) },
          },
          include,
        });
        results.push(created);
      }
      return results;
    });

    return success(res, { count: createdEntries.length, items: createdEntries }, 'Bulk stock entries created', 201);
  } catch (err: any) {
    if (err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};
