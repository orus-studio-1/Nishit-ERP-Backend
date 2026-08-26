import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Tx = any;

export async function resolveItemPricing(tx: Tx, input: {
  product: any;
  customerId?: string;
  priceListId?: string;
  quantity?: Prisma.Decimal.Value;
  currency?: string;
  customerGroup?: string;
  territory?: string;
  salesChannel?: string;
  unitId?: string;
  explicitRate?: Prisma.Decimal.Value;
  explicitDiscount?: Prisma.Decimal.Value;
}) {
  const quantity = new D(input.quantity || 1);
  let rate = input.explicitRate !== undefined && input.explicitRate !== null
    ? new D(input.explicitRate)
    : new D(input.product.salePrice || 0);
  let discount = new D(input.explicitDiscount || 0);

  const today = new Date();
  const itemPrices = await tx.itemPrice.findMany({
    where: {
      productId: input.product.id,
      currency: input.currency || undefined,
      OR: [
        ...(input.customerId ? [{ customerId: input.customerId }] : []),
        ...(input.customerGroup ? [{ customerGroup: input.customerGroup }] : []),
        ...(input.territory ? [{ territory: input.territory }] : []),
        ...(input.salesChannel ? [{ salesChannel: input.salesChannel }] : []),
        { customerId: null, customerGroup: null, territory: null, salesChannel: null },
      ],
      ...(input.priceListId ? { priceListId: input.priceListId } : {}),
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: today } }] },
        { OR: [{ validTo: null }, { validTo: { gte: today } }] },
        { OR: [{ minQty: null }, { minQty: { lte: quantity } }] },
        { OR: [{ maxQty: null }, { maxQty: { gte: quantity } }] },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });
  const score = (p: any) => p.customerId ? 50 : p.customerGroup ? 40 : (p.territory || p.salesChannel) ? 30 : p.priceListId ? 20 : 10;
  const itemPrice = itemPrices.sort((a: any, b: any) => score(b) - score(a))[0];
  if (itemPrice && input.explicitRate === undefined) rate = new D(itemPrice.price);

  if (itemPrice?.unitId && input.unitId && itemPrice.unitId !== input.unitId) {
    const conversion = await tx.productUomConversion.findUnique({ where: { productId_fromUnitId_toUnitId: { productId: input.product.id, fromUnitId: itemPrice.unitId, toUnitId: input.unitId } } });
    if (!conversion) throw new Error(`No UOM conversion exists for ${input.product.sku}`);
    rate = rate.div(conversion.factor);
  }

  const rule = await tx.pricingRule.findFirst({
    where: {
      isActive: true,
      OR: [
        { productId: input.product.id },
        { categoryId: input.product.categoryId || undefined },
        { productId: null, categoryId: null },
      ],
      AND: [
        { OR: [{ customerId: input.customerId || undefined }, { customerId: null }] },
        { OR: [{ customerGroup: input.customerGroup || undefined }, { customerGroup: null }] },
        { OR: [{ territory: input.territory || undefined }, { territory: null }] },
        { OR: [{ salesChannel: input.salesChannel || undefined }, { salesChannel: null }] },
        { OR: [{ currency: input.currency || undefined }, { currency: null }] },
        { OR: [{ priceListId: input.priceListId || undefined }, { priceListId: null }] },
        { OR: [{ minQty: null }, { minQty: { lte: quantity } }] },
        { OR: [{ maxQty: null }, { maxQty: { gte: quantity } }] },
        { OR: [{ validFrom: null }, { validFrom: { lte: today } }] },
        { OR: [{ validTo: null }, { validTo: { gte: today } }] },
      ],
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  if (rule) {
    if (new D(rule.marginPercent || 0).gt(0)) {
      rate = new D(input.product.costPrice || 0).mul(new D(1).plus(new D(rule.marginPercent).div(100)));
    }
    if (input.explicitDiscount === undefined) discount = new D(rule.discountPercent || 0);
  }

  const marginPercent = rate.gt(0) ? rate.minus(input.product.costPrice || 0).div(rate).mul(100) : new D(0);
  const minimumMargin = rule?.minimumMarginPercent ? new D(rule.minimumMarginPercent) : new D(0);
  const requiresApproval = Boolean(rule?.requiresApproval || marginPercent.lt(minimumMargin));
  const source = itemPrice ? (itemPrice.customerId ? 'CUSTOMER_CONTRACT' : itemPrice.customerGroup ? 'CUSTOMER_GROUP' : (itemPrice.territory || itemPrice.salesChannel) ? 'TERRITORY_CHANNEL' : 'GENERAL_PRICE_LIST') : 'STANDARD_SELLING_RATE';
  return { rate, discount, rule, itemPrice, source, marginPercent, requiresApproval };
}
