import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

const D = Prisma.Decimal;

export async function processInventoryMonitoring() {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const levels = await prisma.stockLevel.findMany({ include: { product: { include: { warehouseRules: true } }, warehouse: true } });
  const reorder = levels.filter(level => { const rule = level.product.warehouseRules.find(r => r.warehouseId === level.warehouseId); const threshold = rule?.reorderLevel ?? level.product.reorderLevel ?? level.product.minStockLevel; return new D(level.quantity).minus(level.reservedQty).lte(threshold || 0); });
  const expiring = await prisma.batch.findMany({ where: { isActive: true, quantity: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 30 * 86400000) } }, include: { product: true } });
  const ledgerMismatches: Array<{ companyId?: string | null }> = [];
  for (const level of levels) {
    const ledger = await prisma.stockLedgerEntry.aggregate({ where: { productId: level.productId, warehouseId: level.warehouseId }, _sum: { actualQty: true } });
    if (!new D(ledger._sum.actualQty || 0).eq(level.quantity)) ledgerMismatches.push({ companyId: level.product.companyId });
  }
  const companyIds = [...new Set([...reorder.map(r => r.product.companyId), ...expiring.map(b => b.companyId)].filter(Boolean))] as string[];
  for (const companyId of companyIds) {
    const users = await prisma.user.findMany({ where: { companyId, isActive: true, role: { in: ['ADMIN', 'MANAGER', 'PURCHASE_MANAGER'] } }, select: { id: true } });
    const companyReorder = reorder.filter(r => r.product.companyId === companyId).length, companyExpiry = expiring.filter(b => b.companyId === companyId).length, companyMismatch = ledgerMismatches.filter(row => row.companyId === companyId).length;
    for (const user of users) {
      const exists = await prisma.notification.findFirst({ where: { companyId, userId: user.id, type: 'INVENTORY_NIGHTLY_ALERT', createdAt: { gte: since } } });
      if (!exists && (companyReorder || companyExpiry || companyMismatch)) await prisma.notification.create({ data: { companyId, userId: user.id, type: 'INVENTORY_NIGHTLY_ALERT', title: 'Inventory attention required', message: `${companyReorder} reorder item(s), ${companyExpiry} expiring batch(es), ${companyMismatch} ledger mismatch(es)`, link: '/inventory/reports/advanced' } });
      for (const level of reorder.filter(row => row.product.companyId === companyId)) {
        const rule = level.product.warehouseRules.find(row => row.warehouseId === level.warehouseId);
        const threshold = rule?.reorderLevel ?? level.product.reorderLevel ?? level.product.minStockLevel;
        const available = new D(level.quantity).minus(level.reservedQty);
        const type = `LOW_STOCK:${level.productId}:${level.warehouseId}`;
        const existingLow = await prisma.notification.findFirst({ where: { userId: user.id, type, isRead: false } });
        const message = `${level.product.sku} · ${level.product.name} has ${available.toString()} available in ${level.warehouse.name}; reorder level is ${new D(threshold || 0).toString()}.`;
        if (existingLow) await prisma.notification.update({ where: { id: existingLow.id }, data: { message, link: `/inventory/reports/stock-balance?productId=${level.productId}&warehouseId=${level.warehouseId}` } });
        else await prisma.notification.create({ data: { companyId, userId: user.id, type, title: `Low stock: ${level.product.name}`, message, link: `/inventory/reports/stock-balance?productId=${level.productId}&warehouseId=${level.warehouseId}` } });
      }
    }
  }
  return { reorder: reorder.length, expiring: expiring.length, ledgerMismatches: ledgerMismatches.length };
}
