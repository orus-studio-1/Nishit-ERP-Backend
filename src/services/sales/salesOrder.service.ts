import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Tx = any;

export async function refreshSalesOrderProgress(tx: Tx, salesOrderId: string) {
  const order = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { items: true, invoices: true },
  });
  if (!order) return null;
  const totalQty = order.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.quantity || 0), new D(0));
  const deliveredQty = order.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.deliveredQty || 0), new D(0));
  const billedQty = order.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.billedQty || 0), new D(0));
  const amountBilled = order.invoices
    .filter((invoice: any) => invoice.status !== 'CANCELLED')
    .reduce((sum: Prisma.Decimal, invoice: any) => sum.plus(invoice.grandTotal || invoice.total || 0), new D(0));
  const deliveredPercent = totalQty.gt(0) ? deliveredQty.div(totalQty).mul(100) : new D(0);
  const billedPercent = totalQty.gt(0) ? billedQty.div(totalQty).mul(100) : new D(0);

  let status = order.status;
  if (!['DRAFT', 'CANCELLED', 'ON_HOLD', 'CLOSED'].includes(status)) {
    if (deliveredPercent.gte(100) && billedPercent.gte(100)) status = 'DELIVERED';
    else if (deliveredPercent.gt(0) || billedPercent.gt(0)) status = 'PROCESSING';
    else status = 'CONFIRMED';
  }
  return tx.salesOrder.update({
    where: { id: salesOrderId },
    data: { deliveredPercent, billedPercent, amountBilled, status },
  });
}

export async function markSalesOrderBilled(tx: Tx, salesOrderId: string, invoiceItems: any[]) {
  const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { items: true } });
  if (!order) return;
  for (const item of invoiceItems) {
    if (!item.salesOrderItemId) throw new Error('Invoice line is missing its sales-order line reference');
    const source = order.items.find((row: any) => row.id === item.salesOrderItemId);
    if (!source || source.productId !== item.productId) throw new Error('Invoice line does not match the sales-order line');
    const remaining = new D(source.quantity).minus(source.billedQty);
    if (new D(item.quantity).gt(remaining)) throw new Error('Submitted invoice quantity exceeds the remaining sales-order quantity');
    await tx.salesOrderItem.update({ where: { id: source.id }, data: { billedQty: { increment: item.quantity } } });
  }
  await refreshSalesOrderProgress(tx, salesOrderId);
}

export async function closeSalesOrderWhenSettled(tx: Tx, salesOrderId: string) {
  const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, include: { invoices: true } });
  if (!order || ['DRAFT', 'CANCELLED', 'CLOSED'].includes(order.status)) return order;
  const submitted = order.invoices.filter((invoice: any) => invoice.status === 'SUBMITTED');
  const settled = submitted.length > 0 && submitted.every((invoice: any) => new D(invoice.outstandingAmount).lte(0));
  if (settled && new D(order.deliveredPercent).gte(100) && new D(order.billedPercent).gte(100)) {
    return tx.salesOrder.update({ where: { id: order.id }, data: { status: 'CLOSED', closedAt: new Date(), shortCloseReason: null } });
  }
  return order;
}
