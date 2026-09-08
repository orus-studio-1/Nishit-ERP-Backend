import { Prisma } from '@prisma/client';
import { defaultWarehouse } from '../../utils/erp';
import { ensureLedgerAccount, postToLedger } from '../accounting/ledger.service';

const D = Prisma.Decimal;

type Tx = any;

export async function stockSnapshot(tx: Tx, productId: string, warehouseId: string) {
  const level = await tx.stockLevel.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return {
    quantity: new D(level?.quantity || 0),
    reservedQty: new D(level?.reservedQty || 0),
  };
}

async function movingAverageRate(tx: Tx, productId: string, warehouseId: string, incomingQty: Prisma.Decimal, incomingRate: Prisma.Decimal) {
  const current = await stockSnapshot(tx, productId, warehouseId);
  const last = await tx.stockLedgerEntry.findFirst({
    where: { productId, warehouseId, isCancelled: false },
    orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
  });
  const oldRate = new D(last?.valuationRate || 0);
  const newQty = current.quantity.plus(incomingQty);
  if (newQty.lte(0)) return incomingRate;
  return current.quantity.mul(oldRate).plus(incomingQty.mul(incomingRate)).div(newQty);
}

async function fifoOutgoingRate(tx: Tx, productId: string, warehouseId: string, qty: Prisma.Decimal) {
  let remaining = qty.abs();
  let value = new D(0);
  const layers = await tx.inventoryValuationLayer.findMany({
    where: { productId, warehouseId, isClosed: false, remainingQty: { gt: 0 } },
    orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
  });
  for (const layer of layers) {
    if (remaining.lte(0)) break;
    const take = D.min(new D(layer.remainingQty), remaining);
    value = value.plus(take.mul(layer.rate));
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    const last = await tx.stockLedgerEntry.findFirst({
      where: { productId, warehouseId, isCancelled: false },
      orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
    });
    value = value.plus(remaining.mul(last?.valuationRate || 0));
  }
  return qty.abs().gt(0) ? value.div(qty.abs()) : new D(0);
}

async function consumeFifoLayers(tx: Tx, productId: string, warehouseId: string, qty: Prisma.Decimal) {
  let remaining = qty.abs();
  const layers = await tx.inventoryValuationLayer.findMany({
    where: { productId, warehouseId, isClosed: false, remainingQty: { gt: 0 } },
    orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
  });
  for (const layer of layers) {
    if (remaining.lte(0)) break;
    const take = D.min(new D(layer.remainingQty), remaining);
    const newRemaining = new D(layer.remainingQty).minus(take);
    await tx.inventoryValuationLayer.update({
      where: { id: layer.id },
      data: { remainingQty: newRemaining, isClosed: newRemaining.lte(0) },
    });
    remaining = remaining.minus(take);
  }
}

export async function postStockLedger(tx: Tx, input: {
  productId: string;
  warehouseId?: string;
  actualQty: Prisma.Decimal.Value;
  rate?: Prisma.Decimal.Value;
  postingDate?: Date;
  voucherType: string;
  voucherId?: string;
  voucherNo: string;
  remarks?: string;
  batchId?: string;
  serialNoId?: string;
  reversalOfId?: string;
}) {
  const warehouse = await defaultWarehouse(tx, input.warehouseId);
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product || product.type !== 'PRODUCT' || product.maintainStock === false) return null;
  if (warehouse.isFrozen && input.voucherType !== 'STOCK_RECONCILIATION') throw new Error(`${warehouse.name} is frozen for physical count`);

  // Serialize every balance mutation for an item/warehouse pair. This prevents
  // two concurrent issues from both reading the same available quantity.
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `stock:${input.productId}:${warehouse.id}`);

  const actualQty = new D(input.actualQty || 0);
  if (actualQty.eq(0)) return null;
  if (product.hasBatchNo && !input.batchId && actualQty.lt(0) && product.batchAllocationStrategy !== 'MANUAL') {
    const batch = await tx.batch.findFirst({ where: { productId: product.id, warehouseId: warehouse.id, isActive: true, quantity: { gte: actualQty.abs() }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] }, orderBy: product.batchAllocationStrategy === 'FEFO' ? [{ expiryDate: 'asc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }] });
    if (batch) input.batchId = batch.id;
  }
  if (product.hasBatchNo && !input.batchId) throw new Error(`Batch number is required for ${product.sku || product.name}`);
  if (product.hasSerialNo && !input.serialNoId) throw new Error(`Serial number is required for ${product.sku || product.name}`);
  if ((product.hasBatchNo || product.hasSerialNo) && actualQty.lt(0) && !input.batchId && !input.serialNoId) {
    throw new Error(`Serial/batch items cannot be issued without traceability for ${product.sku || product.name}`);
  }
  if (input.batchId && actualQty.lt(0)) {
    const batch = await tx.batch.findUnique({ where: { id: input.batchId } });
    if (!batch || batch.productId !== product.id || new D(batch.quantity).lt(actualQty.abs())) throw new Error(`Insufficient quantity in selected batch for ${product.sku || product.name}`);
    if (batch.expiryDate && batch.expiryDate <= new Date()) throw new Error(`Expired batch cannot be issued for ${product.sku || product.name}`);
  }
  const before = await stockSnapshot(tx, input.productId, warehouse.id);
  const afterQty = before.quantity.plus(actualQty);
  if (afterQty.lt(0) && (!product.allowNegativeStock || product.hasBatchNo || product.hasSerialNo)) {
    throw new Error(`Insufficient stock for ${product.sku || product.name} in ${warehouse.name}`);
  }

  let valuationRate = new D(product.costPrice || 0);
  const inputRate = new D(input.rate || product.costPrice || 0);
  if (actualQty.gt(0)) {
    valuationRate = product.valuationMethod === 'MOVING_AVERAGE'
      ? await movingAverageRate(tx, input.productId, warehouse.id, actualQty, inputRate)
      : inputRate;
  } else if (product.valuationMethod === 'FIFO') {
    valuationRate = await fifoOutgoingRate(tx, input.productId, warehouse.id, actualQty);
  } else {
    const last = await tx.stockLedgerEntry.findFirst({
      where: { productId: input.productId, warehouseId: warehouse.id, isCancelled: false },
      orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
    });
    valuationRate = product.valuationMethod === 'STANDARD' ? new D(product.costPrice || 0) : new D(last?.valuationRate || inputRate);
  }

  const valueDiff = actualQty.mul(valuationRate);
  const stockValue = afterQty.mul(valuationRate);
  const entry = await tx.stockLedgerEntry.create({
    data: {
      productId: input.productId,
      warehouseId: warehouse.id,
      postingDate: input.postingDate || new Date(),
      voucherType: input.voucherType,
      voucherId: input.voucherId,
      voucherNo: input.voucherNo,
      actualQty,
      qtyAfterTransaction: afterQty,
      incomingRate: actualQty.gt(0) ? inputRate : null,
      outgoingRate: actualQty.lt(0) ? valuationRate : null,
      valuationRate,
      stockValue,
      stockValueDifference: valueDiff,
      batchId: input.batchId,
      serialNoId: input.serialNoId,
      reversalOfId: input.reversalOfId,
      remarks: input.remarks,
    },
  });

  if (actualQty.gt(0) && product.valuationMethod === 'FIFO') {
    await tx.inventoryValuationLayer.create({
      data: {
        productId: input.productId,
        warehouseId: warehouse.id,
        sourceLedgerEntryId: entry.id,
        postingDate: input.postingDate || new Date(),
        originalQty: actualQty,
        remainingQty: actualQty,
        rate: inputRate,
      },
    });
  }
  if (actualQty.lt(0) && product.valuationMethod === 'FIFO') {
    await consumeFifoLayers(tx, input.productId, warehouse.id, actualQty);
  }

  await tx.stockLevel.upsert({
    where: { productId_warehouseId: { productId: input.productId, warehouseId: warehouse.id } },
    update: { quantity: afterQty },
    create: { productId: input.productId, warehouseId: warehouse.id, quantity: afterQty },
  });
  const threshold = new D((await tx.productWarehouseRule.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } }))?.reorderLevel ?? product.reorderLevel ?? product.minStockLevel ?? 0);
  const availableAfter = afterQty.minus(before.reservedQty);
  const notificationType = `LOW_STOCK:${product.id}:${warehouse.id}`;
  if (availableAfter.lte(threshold)) {
    const recipients = product.companyId ? await tx.user.findMany({ where: { companyId: product.companyId, isActive: true, role: { in: ['ADMIN', 'MANAGER', 'PURCHASE_MANAGER'] } }, select: { id: true } }) : [];
    for (const recipient of recipients) {
      const existing = await tx.notification.findFirst({ where: { userId: recipient.id, type: notificationType, isRead: false } });
      const message = `${product.sku} · ${product.name} has ${availableAfter.toString()} available in ${warehouse.name}; reorder level is ${threshold.toString()}.`;
      if (existing) await tx.notification.update({ where: { id: existing.id }, data: { title: `Low stock: ${product.name}`, message, link: `/inventory/reports/stock-balance?productId=${product.id}&warehouseId=${warehouse.id}` } });
      else await tx.notification.create({ data: { companyId: product.companyId, userId: recipient.id, type: notificationType, title: `Low stock: ${product.name}`, message, link: `/inventory/reports/stock-balance?productId=${product.id}&warehouseId=${warehouse.id}` } });
    }
  } else {
    await tx.notification.updateMany({ where: { type: notificationType, isRead: false }, data: { isRead: true } });
  }
  if (input.batchId) {
    await tx.batch.update({ where: { id: input.batchId }, data: { quantity: { increment: actualQty } } });
  }
  if (input.serialNoId) {
    await tx.serialNumber.update({
      where: { id: input.serialNoId },
      data: { warehouseId: actualQty.gt(0) ? warehouse.id : null, status: actualQty.gt(0) ? 'AVAILABLE' : 'DELIVERED' },
    });
  }
  const stockAccount = await ensureLedgerAccount(tx, '1200', 'Stock In Hand', 'ASSET');
  const cogsAccount = await ensureLedgerAccount(tx, '5000', 'Cost of Goods Sold / Stock Adjustment', 'EXPENSE');
  if (!valueDiff.eq(0)) {
    await postToLedger(tx, {
      voucherType: 'STOCK_ENTRY',
      voucherId: input.voucherId || entry.id,
      voucherNo: input.voucherNo,
      postingDate: input.postingDate || new Date(),
      lines: actualQty.gt(0)
        ? [
          { accountId: stockAccount.id, debit: valueDiff.abs(), credit: 0, remarks: input.remarks },
          { accountId: cogsAccount.id, debit: 0, credit: valueDiff.abs(), remarks: input.remarks },
        ]
        : [
          { accountId: cogsAccount.id, debit: valueDiff.abs(), credit: 0, remarks: input.remarks },
          { accountId: stockAccount.id, debit: 0, credit: valueDiff.abs(), remarks: input.remarks },
        ],
    });
  }
  return entry;
}

export async function postStockTransfer(tx: Tx, input: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: Prisma.Decimal.Value;
  rate?: Prisma.Decimal.Value;
  postingDate?: Date;
  voucherType: string;
  voucherId?: string;
  voucherNo: string;
  remarks?: string;
  batchId?: string;
  serialNoId?: string;
}) {
  let destinationBatchId: string | undefined;
  if (input.batchId) {
    const sourceBatch = await tx.batch.findUnique({ where: { id: input.batchId } });
    if (!sourceBatch || sourceBatch.productId !== input.productId || sourceBatch.warehouseId !== input.fromWarehouseId) throw new Error('Selected batch is not available in the source warehouse');
    const destinationBatch = await tx.batch.findFirst({ where: { companyId: sourceBatch.companyId, batchNo: sourceBatch.batchNo, warehouseId: input.toWarehouseId } })
      || await tx.batch.create({ data: { companyId: sourceBatch.companyId, batchNo: sourceBatch.batchNo, productId: sourceBatch.productId, warehouseId: input.toWarehouseId, expiryDate: sourceBatch.expiryDate, manufacturingDate: sourceBatch.manufacturingDate, supplierBatchNo: sourceBatch.supplierBatchNo, supplierId: sourceBatch.supplierId, quantity: 0 } });
    destinationBatchId = destinationBatch.id;
  }
  await postStockLedger(tx, { ...input, warehouseId: input.fromWarehouseId, actualQty: new D(input.quantity).neg(), batchId: input.batchId, serialNoId: input.serialNoId, remarks: input.remarks || 'Material transfer out' });
  await postStockLedger(tx, { ...input, warehouseId: input.toWarehouseId, actualQty: input.quantity, batchId: destinationBatchId, serialNoId: input.serialNoId, remarks: input.remarks || 'Material transfer in' });
}
