import { Prisma } from '@prisma/client';
import { resolveItemPricing } from '../../services/inventory/pricing.service';

export async function normalizeSalesItems(tx: any, items: any[] = [], context: { customerId?: string; priceListId?: string; currency?: string; customerGroup?: string; territory?: string; salesChannel?: string } = {}) {
  const normalized = [];
  let subtotal = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);

  for (const item of items) {
    const itemCode = String(item.itemCode || item.sku || '').trim();
    let product = item.productId ? await tx.product.findUnique({ where: { id: item.productId } }) : null;
    if (!product && itemCode) product = await tx.product.findFirst({ where: { sku: itemCode } });
    if (!product) {
      const sku = itemCode || `MISC-${Date.now()}-${normalized.length + 1}`;
      product = await tx.product.create({
        data: {
          sku,
          name: item.description || sku,
          description: item.description,
          type: 'SERVICE',
          salePrice: new Prisma.Decimal(item.unitPrice ?? item.rate ?? 0),
          taxRate: new Prisma.Decimal(item.taxRate || 0),
          isActive: true,
        },
      });
    }

    const quantity = new Prisma.Decimal(item.quantity || 0);
    const pricing = await resolveItemPricing(tx, {
      product,
      customerId: context.customerId,
      priceListId: context.priceListId,
      currency: context.currency,
      quantity,
      customerGroup: context.customerGroup,
      territory: context.territory,
      salesChannel: context.salesChannel,
      unitId: item.uomId,
      explicitRate: item.unitPrice ?? item.rate,
      explicitDiscount: item.discount,
    });
    const unitPrice = pricing.rate;
    const discount = pricing.discount;
    const taxRate = new Prisma.Decimal(item.taxRate ?? product.taxRate ?? 0);
    const net = quantity.mul(unitPrice).mul(new Prisma.Decimal(1).minus(discount.div(100)));
    const lineTax = net.mul(taxRate.div(100));
    const total = net.plus(lineTax);
    subtotal = subtotal.plus(net);
    taxAmount = taxAmount.plus(lineTax);
    normalized.push({ productId: product.id, description: item.description || product.description || product.name, hsnCode: item.hsnCode ?? product.hsnCode, brand: item.brand ?? product.brand ?? product.manufacturer, quantity, unitPrice, taxRate, discount, total, uomId: item.uomId, costRate: product.costPrice || 0, marginPercent: pricing.marginPercent, priceSource: pricing.source });
  }

  return { items: normalized, subtotal, taxAmount };
}
