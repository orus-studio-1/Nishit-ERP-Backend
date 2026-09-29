import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { aggregateAchievement, evaluateInvoiceEligibility, linePreTaxAmount, type EligibilityInvoiceInput, type SchemeEligibilityConfig, type SlabInput } from './incentiveCalculation';
import { allocateInvoiceRewards, computeSchemeReward } from './incentiveSlabModes';

const D = Prisma.Decimal;

const config: SchemeEligibilityConfig = {
  manufacturerKey: 'panasonic',
  startDate: new Date('2026-04-01T00:00:00.000Z'),
  endDate: new Date('2027-03-31T23:59:59.999Z'),
  eligibleTradeTypes: ['DISTRIBUTOR_SALE'],
  eligibleSupplierIds: ['sup-panasonic'],
};

const line = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  purchaseInvoiceItemId: id,
  productId: `prod-${id}`,
  manufacturer: 'Panasonic',
  quantity: 1,
  amount,
  ...extra,
});

const invoice = (over: Partial<EligibilityInvoiceInput>): EligibilityInvoiceInput => ({
  purchaseInvoiceId: 'inv',
  invoiceNo: 'INV-1',
  date: new Date('2026-06-01T00:00:00.000Z'),
  workflowStatus: 'SUBMITTED',
  supplierId: 'sup-panasonic',
  tradeType: 'DISTRIBUTOR_SALE',
  items: [],
  ...over,
});

describe('highest slab applies to the whole amount', () => {
  // Client example: 5 lakh and above pays 1%, 10 lakh and above pays 1.5%.
  const slabs: SlabInput[] = [
    { id: 'a', thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 },
    { id: 'b', thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 1.5, sortOrder: 1 },
  ];
  it('12 lakh earns 1.5% on all 12 lakh, not banded', () => {
    const { slab, reward } = computeSchemeReward(slabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(1200000), new D(0));
    expect(slab?.id).toBe('b');
    expect(reward?.primaryIncentiveAmount.toString()).toBe('18000'); // 12,00,000 x 1.5%
  });
  it('7 lakh earns the 1% slab on all 7 lakh', () => {
    expect(computeSchemeReward(slabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(700000), new D(0)).reward?.primaryIncentiveAmount.toString()).toBe('7000');
  });
});

describe('pre-tax amount', () => {
  // Goods 1,00,000, discount 5%, GST 18%.
  it('is quantity x unit price: discount and GST do not change it', () => {
    expect(linePreTaxAmount({ quantity: 10, unitPrice: 10000, discountPercent: 5 }).toString()).toBe('100000');
  });
  it('the ERP stores item.total as net plus GST, which must never be used as the amount', () => {
    const storedTotal = 10 * 10000 * 0.95 * 1.18; // 112,100: what PurchaseInvoiceItem.total holds
    const amount = linePreTaxAmount({ quantity: 10, unitPrice: 10000, discountPercent: 5 });
    expect(amount.toString()).not.toBe(String(storedTotal));
    expect(amount.toString()).toBe('100000');
  });
  it('after-discount basis is available only when a scheme asks for it', () => {
    expect(linePreTaxAmount({ quantity: 10, unitPrice: 10000, discountPercent: 5 }, 'PRE_TAX_AFTER_DISCOUNT').toString()).toBe('95000');
    expect(linePreTaxAmount({ quantity: 10, unitPrice: 10000 }, 'PRE_TAX_AFTER_DISCOUNT').toString()).toBe('100000');
  });
});

describe('Panasonic supplier versus another merchant', () => {
  const items = [line('1', 100000)];
  it('counts a Panasonic product bought from the Panasonic supplier', () => {
    expect(evaluateInvoiceEligibility(invoice({ items }), config).eligibleValue.toString()).toBe('100000');
  });
  it('does not count the same product bought from another merchant', () => {
    const r = evaluateInvoiceEligibility(invoice({ supplierId: 'sup-other', items }), config);
    expect(r.eligibleValue.toString()).toBe('0');
    expect(r.invoiceExclusionReason).toBe('SUPPLIER_NOT_ELIGIBLE');
  });
  it('does not count an invoice with no supplier', () => {
    expect(evaluateInvoiceEligibility(invoice({ supplierId: null, items }), config).invoiceExclusionReason).toBe('SUPPLIER_NOT_ELIGIBLE');
  });
  it('a product named Panasonic from the right supplier still needs the manufacturer to match', () => {
    const r = evaluateInvoiceEligibility(invoice({ items: [line('1', 100000, { manufacturer: 'Havells' })] }), config);
    expect(r.lines[0].exclusionReason).toBe('MANUFACTURER_MISMATCH');
  });
  it('allowAnySupplier lifts the supplier rule for a scheme that says so', () => {
    const r = evaluateInvoiceEligibility(invoice({ supplierId: 'sup-other', items }), { ...config, allowAnySupplier: true });
    expect(r.eligibleValue.toString()).toBe('100000');
  });
});

describe('billing type eligibility', () => {
  it('each scheme decides which billing types count', () => {
    const items = [line('1', 100000)];
    const special = invoice({ tradeType: 'SPECIAL_TRADE', items });
    expect(evaluateInvoiceEligibility(special, config).invoiceExclusionReason).toBe('TRADE_TYPE_NOT_ELIGIBLE');
    expect(evaluateInvoiceEligibility(special, { ...config, eligibleTradeTypes: ['SPECIAL_TRADE', 'SUPER_TRADE'] }).eligibleValue.toString()).toBe('100000');
  });
  it('an invoice can carry more than one billing type: a line override decides for that line', () => {
    const mixed = invoice({
      tradeType: 'SPECIAL_TRADE',
      items: [line('1', 60000, { tradeType: 'DISTRIBUTOR_SALE' }), line('2', 40000)],
    });
    const r = evaluateInvoiceEligibility(mixed, config); // scheme accepts DISTRIBUTOR_SALE only
    expect(r.eligibleValue.toString()).toBe('60000');
    expect(r.lines[0].effectiveTradeType).toBe('DISTRIBUTOR_SALE');
    expect(r.lines[1].exclusionReason).toBe('TRADE_TYPE_NOT_ELIGIBLE');
    expect(r.invoiceLevelEligible).toBe(true); // some lines count, so the invoice is not reported as excluded
  });
  it('a line follows the invoice when it has no override, and a missing type is excluded by default', () => {
    const r = evaluateInvoiceEligibility(invoice({ tradeType: null, items: [line('1', 1000), line('2', 2000, { tradeType: 'DISTRIBUTOR_SALE' })] }), config);
    expect(r.lines[0].exclusionReason).toBe('TRADE_TYPE_NULL');
    expect(r.eligibleValue.toString()).toBe('2000');
  });
  it('project types are separate billing types, not folded into trade', () => {
    const cfg = { ...config, eligibleTradeTypes: ['PROJECT_NON_SPA'] };
    expect(evaluateInvoiceEligibility(invoice({ tradeType: 'PROJECT_NON_SPA', items: [line('1', 5)] }), cfg).eligibleValue.toString()).toBe('5');
    expect(evaluateInvoiceEligibility(invoice({ tradeType: 'PROJECT_SPA', items: [line('1', 5)] }), cfg).eligibleValue.toString()).toBe('0');
  });
});

describe('products that count for the slab but not for the reward', () => {
  // 5 lakh of normal products and 3 lakh of products excluded from the benefit.
  const slabs: SlabInput[] = [
    { id: 'low', thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 },
    { id: 'high', thresholdValue: 750000, rewardType: 'PERCENTAGE', rewardValue: 1.5, sortOrder: 1 },
  ];
  const cfg: SchemeEligibilityConfig = { ...config, rewardExcludedProductIds: ['prod-excl'] };
  const inv = invoice({ items: [line('norm', 500000), line('excl', 300000, { productId: 'prod-excl' })] });

  it('keeps two amounts: slab 8 lakh, reward 5 lakh', () => {
    const r = evaluateInvoiceEligibility(inv, cfg);
    expect(r.eligibleValue.toString()).toBe('800000');
    expect(r.rewardEligibleValue.toString()).toBe('500000');
    expect(r.lines.find((l) => l.productId === 'prod-excl')).toMatchObject({ eligible: true, rewardEligible: false });
  });
  it('picks the slab on 8 lakh but pays the rate on 5 lakh', () => {
    const agg = aggregateAchievement([evaluateInvoiceEligibility(inv, cfg)]);
    const { slab, reward } = computeSchemeReward(slabs, 'HIGHEST_SLAB_WINS', 'VALUE', agg.eligibleValue, agg.eligibleQuantity, agg.rewardEligibleValue, agg.rewardEligibleQuantity);
    expect(slab?.id).toBe('high'); // 8 lakh reaches the 7.5 lakh slab (a 5 lakh reward amount alone would not)
    expect(reward?.primaryIncentiveAmount.toString()).toBe('7500'); // 5,00,000 x 1.5%, not 8,00,000 x 1.5% = 12,000
  });
  it('splits the reward per invoice using the reward amount', () => {
    const r = allocateInvoiceRewards(
      [{ key: 'a', eligibleValue: new D(800000), eligibleQuantity: new D(2), rewardEligibleValue: new D(500000), rewardEligibleQuantity: new D(1) }],
      slabs,
      'HIGHEST_SLAB_WINS',
      'VALUE'
    );
    expect(r.get('a')!.primary.toString()).toBe('7500');
  });
  it('an invoice of only excluded products still counts for the slab and earns nothing', () => {
    const r = evaluateInvoiceEligibility(invoice({ items: [line('excl', 300000, { productId: 'prod-excl' })] }), cfg);
    expect(r.eligibleValue.toString()).toBe('300000');
    expect(r.rewardEligibleValue.toString()).toBe('0');
  });
  it('without an exclusion list every eligible product earns the reward', () => {
    const r = evaluateInvoiceEligibility(inv, config);
    expect(r.rewardEligibleValue.toString()).toBe(r.eligibleValue.toString());
  });
});
