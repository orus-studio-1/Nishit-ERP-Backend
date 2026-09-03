import { Prisma } from '@prisma/client';
import { defaultWarehouse } from '../../utils/erp';

const D = Prisma.Decimal;
type Tx = any;

async function setReservedQty(tx: Tx, productId: string, warehouseId: string) {
  const active = await tx.stockReservation.findMany({
    where: { productId, warehouseId, status: { in: ['ACTIVE', 'PARTIAL'] } },
  });
  const reserved = active.reduce((sum: Prisma.Decimal, row: any) => {
    return sum.plus(new D(row.reservedQty).minus(row.fulfilledQty || 0));
  }, new D(0));
  await tx.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { reservedQty: Number(reserved.toString()) },
    create: { productId, warehouseId, quantity: 0, reservedQty: Number(reserved.toString()) },
  });
}

export async function availableQty(tx: Tx, productId: string, warehouseId: string) {
  const level = await tx.stockLevel.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return new D(level?.quantity || 0).minus(level?.reservedQty || 0);
}

export async function reserveSalesOrderStock(tx: Tx, salesOrderId: string, warehouseId?: string) {
  const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: { include: { product: true } } } });
  if (!order) throw new Error('Sales order not found');

  const requestedWarehouse = warehouseId ? await tx.warehouse.findFirst({ where: { id: warehouseId, isActive: true } }) : null;

  await tx.stockReservation.deleteMany({ where: { salesOrderId, status: { in: ['ACTIVE', 'PARTIAL'] } } });
  for (const item of order.items) {
    if (item.product?.type !== 'PRODUCT' || item.product?.maintainStock === false) continue;
    const qty = new D(item.quantity);
    if (item.supplyMode === 'MAKE_TO_ORDER') {
      const shortage = qty.minus(item.producedQty || 0);
      await tx.salesOrderItem.update({ where: { id: item.id }, data: { backorderQty: shortage, readyQty: item.producedQty || 0, supplyStatus: shortage.gt(0) ? 'PRODUCTION_REQUIRED' : 'READY_TO_DISPATCH' } });
      continue;
    }
    const itemWarehouse = item.sourceWarehouseId
      ? await tx.warehouse.findFirst({ where: { id: item.sourceWarehouseId, isActive: true } })
      : null;
    const bestStock = !itemWarehouse && !requestedWarehouse
      ? await tx.stockLevel.findFirst({ where: { productId: item.productId, warehouse: { isActive: true } }, orderBy: { quantity: 'desc' }, include: { warehouse: true } })
      : null;
    const warehouse = itemWarehouse || requestedWarehouse || bestStock?.warehouse || await defaultWarehouse(tx);
    if (!warehouse?.id) throw new Error(`No active warehouse is available to reserve ${item.product.name}`);
    const available = await availableQty(tx, item.productId, warehouse.id);
    const reservedQty = item.product.allowNegativeStock ? qty : Prisma.Decimal.min(qty, Prisma.Decimal.max(available, new D(0)));
    const backorderQty = Prisma.Decimal.max(qty.minus(reservedQty), new D(0));
    await tx.salesOrderItem.update({ where: { id: item.id }, data: { backorderQty, readyQty: reservedQty, supplyStatus: reservedQty.gte(qty) ? 'RESERVED' : reservedQty.gt(0) ? 'PARTIALLY_AVAILABLE' : 'PURCHASE_REQUIRED' } });
    if (reservedQty.lte(0)) continue;
    await tx.stockReservation.create({
      data: {
        productId: item.productId,
        warehouseId: warehouse.id,
        salesOrderId,
        salesOrderItemId: item.id,
        reservedQty,
        expiresAt: order.deliveryDate || undefined,
      },
    });
    await setReservedQty(tx, item.productId, warehouse.id);
  }
  const refreshed = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: true } });
  if (refreshed) {
    const ready = refreshed.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.readyQty || 0), new D(0));
    const ordered = refreshed.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.quantity || 0), new D(0));
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status: ready.gte(ordered) ? 'READY_TO_DISPATCH' : ready.gt(0) ? 'PARTIALLY_READY' : 'AWAITING_STOCK' } });
  }
}

export async function fulfillSalesOrderReservation(tx: Tx, salesOrderId: string, productId: string, warehouseId: string, qty: Prisma.Decimal.Value) {
  let remaining = new D(qty);
  const reservations = await tx.stockReservation.findMany({
    where: { salesOrderId, productId, warehouseId, status: { in: ['ACTIVE', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
  });
  for (const reservation of reservations) {
    if (remaining.lte(0)) break;
    const open = new D(reservation.reservedQty).minus(reservation.fulfilledQty || 0);
    const take = Prisma.Decimal.min(open, remaining);
    const fulfilledQty = new D(reservation.fulfilledQty || 0).plus(take);
    const status = fulfilledQty.gte(reservation.reservedQty) ? 'FULFILLED' : 'PARTIAL';
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { fulfilledQty, status } });
    remaining = remaining.minus(take);
  }
  await setReservedQty(tx, productId, warehouseId);
}

export async function releaseSalesOrderReservations(tx: Tx, salesOrderId: string) {
  const reservations = await tx.stockReservation.findMany({ where: { salesOrderId, status: { in: ['ACTIVE', 'PARTIAL'] } } });
  await tx.stockReservation.updateMany({ where: { salesOrderId, status: { in: ['ACTIVE', 'PARTIAL'] } }, data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: 'Sales order release' } });
  for (const reservation of reservations) {
    await setReservedQty(tx, reservation.productId, reservation.warehouseId);
  }
}
