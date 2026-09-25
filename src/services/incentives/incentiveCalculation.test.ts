import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  normalizeManufacturer,
  evaluateInvoiceEligibility,
  aggregateAchievement,
  selectSlab,
  computeReward,
  roundHalfUp2,
  type EligibilityInvoiceInput,
  type SchemeEligibilityConfig,
  type SlabInput,
} from './incentiveCalculation';

const D = Prisma.Decimal;

// Shared POC scenario, matching docs/incentive-tracking-poc.md exactly, so the
// numbers in this test file, the POC runner output, and the documentation
// are all the same worked example.
const scheme: SchemeEligibilityConfig = {
  manufacturerKey: 'panasonic',
  startDate: new Date('2026-04-01T00:00:00.000Z'),
  endDate: new Date('2027-03-31T23:59:59.999Z'),
  eligibleTradeTypes: ['DISTRIBUTOR_SALE', 'SUPER_TRADE', 'SPECIAL_TRADE'],
};

const slabs: SlabInput[] = [
  { id: 'slab-0', thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 0.1, sortOrder: 0 },
  { id: 'slab-1', thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 0.15, sortOrder: 1 },
  { id: 'slab-2', thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 0.25, sortOrder: 2 },
];

function invoice(overrides: Partial<EligibilityInvoiceInput>): EligibilityInvoiceInput {
  return {
    purchaseInvoiceId: 'inv-x',
    invoiceNo: 'INV-X',
    date: new Date('2026-06-01T00:00:00.000Z'),
    workflowStatus: 'SUBMITTED',
    tradeType: 'DISTRIBUTOR_SALE',
    items: [],
    ...overrides,
  };
}

describe('normalizeManufacturer', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeManufacturer('Panasonic')).toBe('panasonic');
    expect(normalizeManufacturer(' panasonic ')).toBe('panasonic');
    expect(normalizeManufacturer('PANASONIC')).toBe('panasonic');
    expect(normalizeManufacturer('Pana  sonic')).toBe('pana sonic');
  });
  it('does not fuzzy-match variants', () => {
    expect(normalizeManufacturer('Panasonic India')).not.toBe('panasonic');
    expect(normalizeManufacturer('Panasonic Consumer')).not.toBe('panasonic');
  });
  it('returns empty string for null/undefined', () => {
    expect(normalizeManufacturer(null)).toBe('');
    expect(normalizeManufacturer(undefined)).toBe('');
  });
});

describe('evaluateInvoiceEligibility — Case A: eligible invoice', () => {
  it('includes Panasonic lines and computes eligible value/quantity', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-a',
        invoiceNo: 'INV-A',
        items: [
          { purchaseInvoiceItemId: 'item-a1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-a2', productId: 'prod-tv', manufacturer: ' panasonic ', quantity: 5, amount: 200000 },
        ],
      }),
      scheme
    );
    expect(result.invoiceLevelEligible).toBe(true);
    expect(result.lines.every((l) => l.eligible)).toBe(true);
    expect(result.eligibleValue.toString()).toBe('500000');
    expect(result.eligibleQuantity.toString()).toBe('15');
  });
});

describe('evaluateInvoiceEligibility — Case B: wrong manufacturer', () => {
  it('excludes every line, contributes zero', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-b',
        invoiceNo: 'INV-B',
        items: [{ purchaseInvoiceItemId: 'item-b1', productId: 'prod-samsung-tv', manufacturer: 'Samsung', quantity: 10, amount: 250000 }],
      }),
      scheme
    );
    expect(result.invoiceLevelEligible).toBe(true);
    expect(result.lines[0].eligible).toBe(false);
    expect(result.lines[0].exclusionReason).toBe('MANUFACTURER_MISMATCH');
    expect(result.eligibleValue.toString()).toBe('0');
  });
});

describe('evaluateInvoiceEligibility — Case C: mixed-manufacturer invoice', () => {
  it('counts only the Panasonic line, not the full invoice', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-c',
        invoiceNo: 'INV-C',
        items: [
          { purchaseInvoiceItemId: 'item-c1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-c2', productId: 'prod-samsung-tv', manufacturer: 'Samsung', quantity: 10, amount: 250000 },
        ],
      }),
      scheme
    );
    expect(result.eligibleValue.toString()).toBe('300000'); // NOT 550000 (full invoice)
    expect(result.lines.find((l) => l.productId === 'prod-ac')?.eligible).toBe(true);
    expect(result.lines.find((l) => l.productId === 'prod-samsung-tv')?.eligible).toBe(false);
  });
});

describe('evaluateInvoiceEligibility — Case D: wrong trade type', () => {
  it('excludes the whole invoice with TRADE_TYPE_NOT_ELIGIBLE', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        tradeType: 'PROJECT_NON_SPA',
        items: [{ purchaseInvoiceItemId: 'item-d1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 }],
      }),
      scheme
    );
    expect(result.invoiceLevelEligible).toBe(false);
    expect(result.invoiceExclusionReason).toBe('TRADE_TYPE_NOT_ELIGIBLE');
    expect(result.eligibleValue.toString()).toBe('0');
  });
});

describe('evaluateInvoiceEligibility — Case E: outside scheme period', () => {
  it('excludes with OUTSIDE_SCHEME_PERIOD', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        date: new Date('2025-01-01T00:00:00.000Z'),
        items: [{ purchaseInvoiceItemId: 'item-e1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 }],
      }),
      scheme
    );
    expect(result.invoiceExclusionReason).toBe('OUTSIDE_SCHEME_PERIOD');
  });
});

describe('evaluateInvoiceEligibility — Case F: draft invoice', () => {
  it('excludes with NOT_SUBMITTED', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        workflowStatus: 'DRAFT',
        items: [{ purchaseInvoiceItemId: 'item-f1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 }],
      }),
      scheme
    );
    expect(result.invoiceExclusionReason).toBe('NOT_SUBMITTED');
  });
});

describe('evaluateInvoiceEligibility — Case G: null tradeType', () => {
  it('excludes with TRADE_TYPE_NULL (excluded by default, not assumed eligible)', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        tradeType: null,
        items: [{ purchaseInvoiceItemId: 'item-g1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 }],
      }),
      scheme
    );
    expect(result.invoiceExclusionReason).toBe('TRADE_TYPE_NULL');
  });
});

describe('negative line handling', () => {
  it('excludes a negative-total line even when manufacturer matches, and does not net it against positive lines', () => {
    const result = evaluateInvoiceEligibility(
      invoice({
        items: [
          { purchaseInvoiceItemId: 'item-n1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-n2', productId: 'prod-adj', manufacturer: 'Panasonic', quantity: -1, amount: -5000 },
        ],
      }),
      scheme
    );
    const negLine = result.lines.find((l) => l.productId === 'prod-adj');
    expect(negLine?.eligible).toBe(false);
    expect(negLine?.exclusionReason).toBe('NEGATIVE_LINE_EXCLUDED');
    // Only the positive line counts; the negative line is excluded, not netted (300000, not 295000).
    expect(result.eligibleValue.toString()).toBe('300000');
  });
});

describe('aggregateAchievement — cumulative achievement across invoices', () => {
  it('sums eligible value/quantity across A + B + C (only eligible lines)', () => {
    const a = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-a',
        invoiceNo: 'INV-A',
        items: [
          { purchaseInvoiceItemId: 'item-a1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-a2', productId: 'prod-tv', manufacturer: 'Panasonic', quantity: 5, amount: 200000 },
        ],
      }),
      scheme
    );
    const b = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-b',
        invoiceNo: 'INV-B',
        items: [{ purchaseInvoiceItemId: 'item-b1', productId: 'prod-samsung-tv', manufacturer: 'Samsung', quantity: 10, amount: 250000 }],
      }),
      scheme
    );
    const c = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-c',
        invoiceNo: 'INV-C',
        items: [
          { purchaseInvoiceItemId: 'item-c1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-c2', productId: 'prod-samsung-tv', manufacturer: 'Samsung', quantity: 10, amount: 250000 },
        ],
      }),
      scheme
    );
    const agg = aggregateAchievement([a, b, c]);
    // 500000 (A) + 0 (B) + 300000 (C) = 800000
    expect(agg.eligibleValue.toString()).toBe('800000');
    expect(agg.eligibleQuantity.toString()).toBe('25'); // 15 (A) + 0 (B) + 10 (C)
  });
});

describe('selectSlab — provisional highest-slab-wins', () => {
  it('selects the ₹0 slab when achievement is 0 (a zero threshold is always reached)', () => {
    const slab = selectSlab(slabs, 'VALUE', new D(0), new D(0));
    expect(slab?.id).toBe('slab-0');
  });
  it('selects the ₹500,000 slab at exactly the threshold (inclusive)', () => {
    const slab = selectSlab(slabs, 'VALUE', new D(500000), new D(0));
    expect(slab?.id).toBe('slab-1');
  });
  it('selects the ₹1,000,000 slab for achievement above the highest threshold', () => {
    const slab = selectSlab(slabs, 'VALUE', new D(800000), new D(0));
    expect(slab?.id).toBe('slab-1'); // 800000 has NOT reached slab-2 (1,000,000)
    const slabAbove = selectSlab(slabs, 'VALUE', new D(1500000), new D(0));
    expect(slabAbove?.id).toBe('slab-2');
  });
  it('returns null when there are no slabs at all, or achievement is below every threshold', () => {
    const noSlabs = selectSlab([], 'VALUE', new D(100), new D(0));
    expect(noSlabs).toBeNull();
    const allThresholdsAboveZero: SlabInput[] = [{ id: 'only', thresholdValue: 100, rewardType: 'PERCENTAGE', rewardValue: 1, sortOrder: 0 }];
    expect(selectSlab(allThresholdsAboveZero, 'VALUE', new D(50), new D(0))).toBeNull();
  });
});

describe('computeReward', () => {
  it('computes PERCENTAGE reward: eligibleValue × rate / 100', () => {
    const reward = computeReward(slabs[1], new D(800000), new D(25)); // slab-1: 0.15%
    expect(reward?.primaryIncentiveAmount.toString()).toBe('1200'); // 800000 * 0.15 / 100
    expect(roundHalfUp2(reward!.primaryIncentiveAmount).toFixed(2)).toBe('1200.00');
  });
  it('computes FIXED_PER_UNIT reward: eligibleQuantity × rewardValue', () => {
    const fixedSlab: SlabInput = { id: 'fixed-1', thresholdValue: 0, rewardType: 'FIXED_PER_UNIT', rewardValue: 14, sortOrder: 0 };
    const reward = computeReward(fixedSlab, new D(0), new D(120)); // 120 pcs × ₹14
    expect(reward?.primaryIncentiveAmount.toString()).toBe('1680');
  });
  it('computes both primary and alternate rewards without auto-selecting one (RCCB cash-or-gold style)', () => {
    const altSlab: SlabInput = {
      id: 'rccb-slab',
      thresholdValue: 445,
      rewardType: 'FIXED_PER_UNIT',
      rewardValue: 55,
      altRewardType: 'FIXED_PER_UNIT',
      altRewardValue: 14400 / 200, // illustrative gold-gram-equivalent rate, not a real conversion
      sortOrder: 0,
    };
    const reward = computeReward(altSlab, new D(0), new D(445));
    expect(reward?.primaryIncentiveAmount.toString()).toBe('24475'); // 445 * 55
    expect(reward?.altIncentiveAmount).not.toBeNull();
    // Both values are present simultaneously; nothing picks one over the other.
    expect(reward?.primaryIncentiveAmount.toString()).not.toBe(reward?.altIncentiveAmount?.toString());
  });
  it('returns null when no slab is selected', () => {
    expect(computeReward(null, new D(100), new D(1))).toBeNull();
  });
});

describe('roundHalfUp2', () => {
  it('rounds half-up to 2 decimal places, only for final display', () => {
    expect(roundHalfUp2(new D('1200.005')).toFixed(2)).toBe('1200.01');
    expect(roundHalfUp2(new D('1200.004')).toFixed(2)).toBe('1200.00');
    expect(roundHalfUp2(new D('1200.5')).toFixed(2)).toBe('1200.50');
  });
});

describe('end-to-end manual calculation cross-check (Case A only, scheme-wide)', () => {
  it('matches the documented worked example exactly', () => {
    const a = evaluateInvoiceEligibility(
      invoice({
        purchaseInvoiceId: 'inv-a',
        invoiceNo: 'INV-A',
        items: [
          { purchaseInvoiceItemId: 'item-a1', productId: 'prod-ac', manufacturer: 'Panasonic', quantity: 10, amount: 300000 },
          { purchaseInvoiceItemId: 'item-a2', productId: 'prod-tv', manufacturer: 'Panasonic', quantity: 5, amount: 200000 },
        ],
      }),
      scheme
    );
    const agg = aggregateAchievement([a]);
    expect(agg.eligibleValue.toString()).toBe('500000');
    const slab = selectSlab(slabs, 'VALUE', agg.eligibleValue, agg.eligibleQuantity);
    expect(slab?.id).toBe('slab-1'); // exactly at 500,000 threshold -> 0.15% slab, not 0.10%
    const reward = computeReward(slab, agg.eligibleValue, agg.eligibleQuantity);
    // 500000 * 0.15 / 100 = 750
    expect(reward?.primaryIncentiveAmount.toString()).toBe('750');
  });
});
