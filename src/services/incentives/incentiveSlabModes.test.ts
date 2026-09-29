import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { evaluateInvoiceEligibility, type SlabInput } from './incentiveCalculation';
import { allocateInvoiceRewards, computeSchemeReward, computeSlabProgress, validateSlabConfiguration } from './incentiveSlabModes';

const D = Prisma.Decimal;

const valueSlabs: SlabInput[] = [
  { id: 's0', thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 0.1, sortOrder: 0 },
  { id: 's1', thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 0.15, sortOrder: 1 },
  { id: 's2', thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 0.25, sortOrder: 2 },
];

const qtySlabs: SlabInput[] = [
  { id: 'q0', thresholdValue: 0, rewardType: 'FIXED_PER_UNIT', rewardValue: 5, sortOrder: 0 },
  { id: 'q1', thresholdValue: 120, rewardType: 'FIXED_PER_UNIT', rewardValue: 8, sortOrder: 1 },
  { id: 'q2', thresholdValue: 270, rewardType: 'FIXED_PER_UNIT', rewardValue: 11, sortOrder: 2 },
];

const amount = (r: ReturnType<typeof computeSchemeReward>) => r.reward?.primaryIncentiveAmount.toString();

describe('computeSchemeReward: HIGHEST_SLAB_WINS vs PROGRESSIVE (value, percentage)', () => {
  it('at 750,000: highest slab pays 0.15% on everything, progressive pays banded rates', () => {
    const highest = computeSchemeReward(valueSlabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(750000), new D(0));
    // 750000 x 0.15 / 100 = 1125
    expect(amount(highest)).toBe('1125');
    const progressive = computeSchemeReward(valueSlabs, 'PROGRESSIVE', 'VALUE', new D(750000), new D(0));
    // 500000 x 0.10% = 500, plus 250000 x 0.15% = 375  => 875
    expect(amount(progressive)).toBe('875');
    expect(progressive.slab?.id).toBe('s1');
  });

  it('above the top slab: progressive = 500 + 750 + 500', () => {
    const progressive = computeSchemeReward(valueSlabs, 'PROGRESSIVE', 'VALUE', new D(1200000), new D(0));
    // 500000 x 0.10% = 500; 500000 x 0.15% = 750; 200000 x 0.25% = 500 => 1750
    expect(amount(progressive)).toBe('1750');
    const highest = computeSchemeReward(valueSlabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(1200000), new D(0));
    expect(amount(highest)).toBe('3000'); // 1200000 x 0.25%
  });

  it('inside the first band, both modes agree', () => {
    const a = computeSchemeReward(valueSlabs, 'PROGRESSIVE', 'VALUE', new D(400000), new D(0));
    const b = computeSchemeReward(valueSlabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(400000), new D(0));
    expect(amount(a)).toBe('400');
    expect(amount(b)).toBe('400');
  });

  it('pays nothing below the first threshold in both modes', () => {
    const slabs: SlabInput[] = [{ id: 'only', thresholdValue: 100000, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 }];
    expect(computeSchemeReward(slabs, 'PROGRESSIVE', 'VALUE', new D(50000), new D(0)).reward).toBeNull();
    expect(computeSchemeReward(slabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(50000), new D(0)).reward).toBeNull();
  });

  it('progressive pays only on the part above the first threshold when the first threshold is above zero', () => {
    const slabs: SlabInput[] = [{ id: 'only', thresholdValue: 100000, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 }];
    // (150000 - 100000) x 1% = 500
    expect(amount(computeSchemeReward(slabs, 'PROGRESSIVE', 'VALUE', new D(150000), new D(0)))).toBe('500');
    // highest-slab-wins pays on all 150000
    expect(amount(computeSchemeReward(slabs, 'HIGHEST_SLAB_WINS', 'VALUE', new D(150000), new D(0)))).toBe('1500');
  });
});

describe('computeSchemeReward: quantity, fixed per unit', () => {
  it('at 300 units: highest = 300 x 11, progressive = 120x5 + 150x8 + 30x11', () => {
    expect(amount(computeSchemeReward(qtySlabs, 'HIGHEST_SLAB_WINS', 'QUANTITY', new D(0), new D(300)))).toBe('3300');
    // 600 + 1200 + 330
    expect(amount(computeSchemeReward(qtySlabs, 'PROGRESSIVE', 'QUANTITY', new D(0), new D(300)))).toBe('2130');
  });
});

describe('alternate rewards', () => {
  const withAlt = qtySlabs.map((s, i) => ({ ...s, altRewardType: 'FIXED_PER_UNIT' as const, altRewardValue: 2 + i }));
  it('progressive computes the alternate total across bands and never chooses between them', () => {
    const r = computeSchemeReward(withAlt, 'PROGRESSIVE', 'QUANTITY', new D(0), new D(300));
    expect(r.reward?.primaryIncentiveAmount.toString()).toBe('2130');
    // alt rates 2,3,4: 120x2 + 150x3 + 30x4 = 240 + 450 + 120 = 810
    expect(r.reward?.altIncentiveAmount?.toString()).toBe('810');
  });
  it('highest-slab-wins computes the alternate on the whole quantity at the top slab alt rate', () => {
    const r = computeSchemeReward(withAlt, 'HIGHEST_SLAB_WINS', 'QUANTITY', new D(0), new D(300));
    expect(r.reward?.altIncentiveAmount?.toString()).toBe('1200'); // 300 x 4
  });
});

describe('validateSlabConfiguration', () => {
  it('accepts a valid highest-slab-wins configuration, including mixed reward types', () => {
    const mixed: SlabInput[] = [{ id: 'a', thresholdValue: 0, rewardType: 'FIXED_PER_UNIT', rewardValue: 5, sortOrder: 0 }];
    expect(validateSlabConfiguration(mixed, 'HIGHEST_SLAB_WINS', 'VALUE')).toEqual([]);
  });
  it('rejects a scheme with no slabs', () => {
    expect(validateSlabConfiguration([], 'HIGHEST_SLAB_WINS', 'VALUE')).toContain('At least one slab is required.');
  });
  it('rejects a per-unit reward on a value-measured progressive scheme', () => {
    const problems = validateSlabConfiguration(qtySlabs, 'PROGRESSIVE', 'VALUE');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain('requires PERCENTAGE');
  });
  it('rejects a percentage reward on a quantity-measured progressive scheme', () => {
    expect(validateSlabConfiguration(valueSlabs, 'PROGRESSIVE', 'QUANTITY')[0]).toContain('requires FIXED_PER_UNIT');
  });
  it('requires alternate rewards on every slab or none in progressive mode', () => {
    const partial: SlabInput[] = qtySlabs.map((s, i) => (i === 0 ? { ...s, altRewardType: 'FIXED_PER_UNIT', altRewardValue: 1 } : s));
    expect(validateSlabConfiguration(partial, 'PROGRESSIVE', 'QUANTITY').join(' ')).toContain('every slab or on none');
  });
  it('rejects half-configured alternate rewards and negatives', () => {
    const bad: SlabInput[] = [{ id: 'x', thresholdValue: -1, rewardType: 'PERCENTAGE', rewardValue: -2, altRewardType: 'PERCENTAGE', sortOrder: 0 }];
    const joined = validateSlabConfiguration(bad, 'HIGHEST_SLAB_WINS', 'VALUE').join(' ');
    expect(joined).toContain('threshold cannot be negative');
    expect(joined).toContain('reward cannot be negative');
    expect(joined).toContain('needs both a type and a value');
  });
  it('computeSchemeReward refuses an invalid configuration instead of guessing', () => {
    expect(() => computeSchemeReward(qtySlabs, 'PROGRESSIVE', 'VALUE', new D(100), new D(10))).toThrow('Invalid slab configuration');
  });
});

describe('allocateInvoiceRewards', () => {
  // Invoices A (500,000), C (300,000), H (60,000): the POC scenario, total 860,000.
  const invoices = [
    { key: 'A', eligibleValue: new D(500000), eligibleQuantity: new D(15) },
    { key: 'C', eligibleValue: new D(300000), eligibleQuantity: new D(10) },
    { key: 'H', eligibleValue: new D(60000), eligibleQuantity: new D(2) },
  ];

  it('highest-slab-wins: each invoice at the scheme slab (0.15%), summing to 1290', () => {
    const r = allocateInvoiceRewards(invoices, valueSlabs, 'HIGHEST_SLAB_WINS', 'VALUE');
    expect(r.get('A')!.primary.toString()).toBe('750');
    expect(r.get('C')!.primary.toString()).toBe('450');
    expect(r.get('H')!.primary.toString()).toBe('90');
  });

  it('progressive: marginal allocation in invoice order, summing exactly to the scheme total', () => {
    const r = allocateInvoiceRewards(invoices, valueSlabs, 'PROGRESSIVE', 'VALUE');
    // cumulative 500000 -> 500; 800000 -> 500 + 300000x0.15% = 950; 860000 -> 500 + 360000x0.15% = 1040
    expect(r.get('A')!.primary.toString()).toBe('500');
    expect(r.get('C')!.primary.toString()).toBe('450');
    expect(r.get('H')!.primary.toString()).toBe('90');
    const total = [...r.values()].reduce((s, v) => s.plus(v.primary), new D(0));
    const scheme = computeSchemeReward(valueSlabs, 'PROGRESSIVE', 'VALUE', new D(860000), new D(27));
    expect(total.toString()).toBe(scheme.reward!.primaryIncentiveAmount.toString());
    expect(total.toString()).toBe('1040');
  });

  it('progressive allocation depends on order but the total does not', () => {
    const reversed = [...invoices].reverse();
    const r = allocateInvoiceRewards(reversed, valueSlabs, 'PROGRESSIVE', 'VALUE');
    const total = [...r.values()].reduce((s, v) => s.plus(v.primary), new D(0));
    expect(total.toString()).toBe('1040');
  });
});

describe('computeSlabProgress', () => {
  it('shows current slab, next slab and the remaining gap', () => {
    const p = computeSlabProgress(valueSlabs, 'VALUE', new D(860000), new D(27));
    expect(p.currentSlab?.id).toBe('s1');
    expect(p.nextSlab?.id).toBe('s2');
    expect(p.remainingToNext?.toString()).toBe('140000');
    expect(p.progressToNextPercent?.toString()).toBe('86');
  });
  it('has no next slab once the top slab is reached', () => {
    const p = computeSlabProgress(valueSlabs, 'VALUE', new D(1500000), new D(0));
    expect(p.currentSlab?.id).toBe('s2');
    expect(p.nextSlab).toBeNull();
    expect(p.remainingToNext).toBeNull();
  });
  it('has no current slab before the first threshold', () => {
    const slabs: SlabInput[] = [{ id: 'only', thresholdValue: 100000, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 }];
    const p = computeSlabProgress(slabs, 'VALUE', new D(25000), new D(0));
    expect(p.currentSlab).toBeNull();
    expect(p.nextSlab?.id).toBe('only');
    expect(p.remainingToNext?.toString()).toBe('75000');
  });
});

describe('allowAnyTradeType eligibility', () => {
  const base = {
    manufacturerKey: 'panasonic',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T23:59:59.999Z'),
    eligibleTradeTypes: [] as string[],
  };
  const invoice = (tradeType: string | null) => ({
    purchaseInvoiceId: 'i',
    invoiceNo: 'INV',
    date: new Date('2026-06-01T00:00:00.000Z'),
    workflowStatus: 'SUBMITTED',
    tradeType,
    items: [{ purchaseInvoiceItemId: 'l', productId: 'p', manufacturer: 'Panasonic', quantity: 1, amount: 1000 }],
  });

  it('counts NULL and any trade type when allowAnyTradeType is true, even with an empty list', () => {
    expect(evaluateInvoiceEligibility(invoice(null), { ...base, allowAnyTradeType: true }).eligibleValue.toString()).toBe('1000');
    expect(evaluateInvoiceEligibility(invoice('PROJECT_SPA'), { ...base, allowAnyTradeType: true }).eligibleValue.toString()).toBe('1000');
  });
  it('still applies every other rule when allowAnyTradeType is true', () => {
    const draft = { ...invoice(null), workflowStatus: 'DRAFT' };
    expect(evaluateInvoiceEligibility(draft, { ...base, allowAnyTradeType: true }).invoiceExclusionReason).toBe('NOT_SUBMITTED');
    const late = { ...invoice(null), date: new Date('2030-01-01T00:00:00.000Z') };
    expect(evaluateInvoiceEligibility(late, { ...base, allowAnyTradeType: true }).invoiceExclusionReason).toBe('OUTSIDE_SCHEME_PERIOD');
  });
  it('default behaviour is unchanged: NULL excluded, unlisted excluded', () => {
    const cfg = { ...base, eligibleTradeTypes: ['DISTRIBUTOR_SALE'] };
    expect(evaluateInvoiceEligibility(invoice(null), cfg).invoiceExclusionReason).toBe('TRADE_TYPE_NULL');
    expect(evaluateInvoiceEligibility(invoice('PROJECT_SPA'), cfg).invoiceExclusionReason).toBe('TRADE_TYPE_NOT_ELIGIBLE');
    expect(evaluateInvoiceEligibility(invoice('DISTRIBUTOR_SALE'), cfg).invoiceLevelEligible).toBe(true);
  });
});
