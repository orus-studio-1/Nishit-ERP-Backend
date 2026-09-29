import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../lib/prisma';
import { permissionCatalog } from '../../utils/accessControl';
import {
  IncentiveNotFoundError,
  IncentiveValidationError,
  addSlab,
  changeSchemeStatus,
  createIncentiveScheme,
  getSchemeOrThrow,
  updateIncentiveScheme,
} from './incentiveScheme.service';

vi.mock('../../lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    incentiveScheme: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    incentiveSlab: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    incentiveContribution: { count: vi.fn() },
    supplier: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

const db = prisma as any;

const validInput = () => ({
  manufacturerLabel: ' Panasonic ',
  name: 'Panasonic FY26',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  measurementType: 'VALUE' as const,
  eligibleTradeTypes: ['DISTRIBUTOR_SALE' as const],
  eligibleSupplierIds: ['sup-1'],
  slabs: [
    { thresholdValue: 500000, rewardType: 'PERCENTAGE' as const, rewardValue: 0.15 },
    { thresholdValue: 0, rewardType: 'PERCENTAGE' as const, rewardValue: 0.1 },
  ],
});

async function messageOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err: any) {
    expect(err).toBeInstanceOf(IncentiveValidationError);
    return [err.message, ...(err.details ?? [])].join(' | ');
  }
  throw new Error('expected a validation error but none was thrown');
}

beforeEach(() => {
  vi.clearAllMocks();
  db.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }, { id: 'sup-2' }]);
  db.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
});

describe('createIncentiveScheme validation', () => {
  it('rejects a missing name and a blank manufacturer', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), name: ' ' }))).toContain('name is required');
    expect(await messageOf(createIncentiveScheme({ ...validInput(), manufacturerLabel: '   ' }))).toContain('manufacturerLabel is required');
  });
  it('rejects bad dates and reversed periods', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), startDate: 'nope' }))).toContain('startDate must be a valid date');
    expect(await messageOf(createIncentiveScheme({ ...validInput(), startDate: '2027-04-01', endDate: '2026-04-01' }))).toContain('must not be after');
  });
  it('rejects unknown enum values', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), measurementType: 'MONEY' as any }))).toContain('measurementType must be one of');
    expect(await messageOf(createIncentiveScheme({ ...validInput(), slabMode: 'TIERED' as any }))).toContain('slabMode must be one of');
    expect(await messageOf(createIncentiveScheme({ ...validInput(), eligibleTradeTypes: ['RETAIL' as any] }))).toContain('eligibleTradeTypes[] must be one of');
  });
  it('requires a trade type unless allowAnyTradeType is set', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), eligibleTradeTypes: [] }))).toContain('allowAnyTradeType');
  });
  it('rejects an ACTIVE scheme with no slabs', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), status: 'ACTIVE', slabs: [] }))).toContain('at least one slab');
  });
  it('rejects duplicate thresholds and negative values', async () => {
    const dup = { ...validInput(), slabs: [validInput().slabs[0], { ...validInput().slabs[0] }] };
    expect(await messageOf(createIncentiveScheme(dup))).toContain('Duplicate slab threshold');
    const neg = { ...validInput(), slabs: [{ thresholdValue: -5, rewardType: 'PERCENTAGE' as const, rewardValue: 1 }] };
    expect(await messageOf(createIncentiveScheme(neg))).toContain('cannot be negative');
  });
  it('rejects progressive slabs whose reward type does not fit the measurement', async () => {
    const input = { ...validInput(), slabMode: 'PROGRESSIVE' as const, slabs: [{ thresholdValue: 0, rewardType: 'FIXED_PER_UNIT' as const, rewardValue: 5 }] };
    expect(await messageOf(createIncentiveScheme(input))).toContain('requires PERCENTAGE');
  });
  it('rejects half-configured alternate rewards', async () => {
    const input = { ...validInput(), slabs: [{ thresholdValue: 0, rewardType: 'PERCENTAGE' as const, rewardValue: 1, altRewardType: 'PERCENTAGE' as const }] };
    expect(await messageOf(createIncentiveScheme(input))).toContain('alternate reward needs both');
  });
  it('does not touch the database when validation fails', async () => {
    await messageOf(createIncentiveScheme({ ...validInput(), name: '' }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('supplier, amount basis and reward-excluded products', () => {
  it('requires an eligible supplier unless the scheme allows any supplier', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), eligibleSupplierIds: [] }))).toContain('eligible supplier');
  });
  it('rejects a supplier or product that does not exist in the company', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), eligibleSupplierIds: ['ghost'] }))).toContain('Unknown supplier id(s): ghost');
    expect(await messageOf(createIncentiveScheme({ ...validInput(), rewardExcludedProductIds: ['ghost-product'] }))).toContain('Unknown product id(s): ghost-product');
  });
  it('rejects reward-excluded products with progressive slabs', async () => {
    const input = { ...validInput(), slabMode: 'PROGRESSIVE' as const, rewardExcludedProductIds: ['prod-1'] };
    expect(await messageOf(createIncentiveScheme(input))).toContain('not supported with PROGRESSIVE');
  });
  it('rejects an unknown amount basis', async () => {
    expect(await messageOf(createIncentiveScheme({ ...validInput(), amountBasis: 'WITH_GST' as any }))).toContain('amountBasis must be one of');
  });
  it('stores the confirmed defaults and the supplier and exclusion lists', async () => {
    const tx = {
      incentiveScheme: { create: vi.fn().mockResolvedValue({ id: 's' }), findFirst: vi.fn().mockResolvedValue({ id: 's' }) },
      incentiveSlab: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((cb: any) => cb(tx));
    await createIncentiveScheme({ ...validInput(), rewardExcludedProductIds: ['prod-1', 'prod-1'] });
    const data = tx.incentiveScheme.create.mock.calls[0][0].data;
    expect(data.amountBasis).toBe('PRE_TAX_BEFORE_DISCOUNT');
    expect(data.slabMode).toBe('HIGHEST_SLAB_WINS');
    expect(data.eligibleSupplierIds).toEqual(['sup-1']);
    expect(data.allowAnySupplier).toBe(false);
    expect(data.rewardExcludedProductIds).toEqual(['prod-1']);
  });
  it('allowAnySupplier needs no supplier list', async () => {
    const tx = {
      incentiveScheme: { create: vi.fn().mockResolvedValue({ id: 's' }), findFirst: vi.fn().mockResolvedValue({ id: 's' }) },
      incentiveSlab: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((cb: any) => cb(tx));
    await createIncentiveScheme({ ...validInput(), eligibleSupplierIds: [], allowAnySupplier: true });
    expect(tx.incentiveScheme.create.mock.calls[0][0].data.allowAnySupplier).toBe(true);
  });
});

describe('createIncentiveScheme success path', () => {
  it('normalizes the manufacturer, defaults the options, and stores slabs in ascending threshold order', async () => {
    const tx = {
      incentiveScheme: { create: vi.fn().mockResolvedValue({ id: 'scheme-1' }), findFirst: vi.fn().mockResolvedValue({ id: 'scheme-1' }) },
      incentiveSlab: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((cb: any) => cb(tx));

    await createIncentiveScheme(validInput());

    const data = tx.incentiveScheme.create.mock.calls[0][0].data;
    expect(data.manufacturerKey).toBe('panasonic');
    expect(data.manufacturerLabel).toBe('Panasonic');
    expect(data.allowAnyTradeType).toBe(false);
    expect(data.slabMode).toBe('HIGHEST_SLAB_WINS');
    expect(data.status).toBe('DRAFT');
    const slabCalls = tx.incentiveSlab.create.mock.calls.map((c: any) => c[0].data);
    expect(slabCalls.map((s: any) => s.thresholdValue.toString())).toEqual(['0', '500000']);
    expect(slabCalls.map((s: any) => s.sortOrder)).toEqual([0, 1]);
  });

  it('accepts an empty trade type list when allowAnyTradeType is true', async () => {
    const tx = {
      incentiveScheme: { create: vi.fn().mockResolvedValue({ id: 's' }), findFirst: vi.fn().mockResolvedValue({ id: 's' }) },
      incentiveSlab: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((cb: any) => cb(tx));
    await createIncentiveScheme({ ...validInput(), eligibleTradeTypes: [], allowAnyTradeType: true });
    expect(tx.incentiveScheme.create.mock.calls[0][0].data.allowAnyTradeType).toBe(true);
  });
});

describe('scheme lookup, update and status', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    status: 'DRAFT',
    slabMode: 'HIGHEST_SLAB_WINS',
    measurementType: 'VALUE',
    allowAnyTradeType: false,
    eligibleTradeTypes: ['DISTRIBUTOR_SALE'],
    amountBasis: 'PRE_TAX_BEFORE_DISCOUNT',
    eligibleSupplierIds: ['sup-1'],
    allowAnySupplier: false,
    rewardExcludedProductIds: [],
    startDate: new Date('2026-04-01'),
    endDate: new Date('2027-03-31'),
    slabs: [{ id: 'a', thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 1, altRewardType: null, altRewardValue: null, sortOrder: 0 }],
    ...over,
  });

  it('reports a missing scheme as not found (which also covers another company scheme, via tenant scoping)', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(null);
    await expect(getSchemeOrThrow('missing')).rejects.toBeInstanceOf(IncentiveNotFoundError);
  });

  it('will not activate a scheme without slabs, and will not reopen a cancelled one', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(stored({ slabs: [] }));
    expect(await messageOf(changeSchemeStatus('s1', 'ACTIVE'))).toContain('cannot be activated');
    db.incentiveScheme.findFirst.mockResolvedValue(stored({ status: 'CANCELLED' }));
    expect(await messageOf(changeSchemeStatus('s1', 'ACTIVE'))).toContain('Cannot change status from CANCELLED to ACTIVE');
    expect(db.incentiveScheme.update).not.toHaveBeenCalled();
  });

  it('will not activate a scheme with no eligible supplier', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(stored({ eligibleSupplierIds: [] }));
    expect(await messageOf(changeSchemeStatus('s1', 'ACTIVE'))).toContain('eligible supplier');
  });

  it('activates a valid draft', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(stored());
    db.incentiveScheme.update.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
    await changeSchemeStatus('s1', 'ACTIVE');
    expect(db.incentiveScheme.update.mock.calls[0][0].data).toEqual({ status: 'ACTIVE' });
  });

  it('rejects switching to progressive when existing slabs do not fit', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(
      stored({ slabs: [{ id: 'a', thresholdValue: 0, rewardType: 'FIXED_PER_UNIT', rewardValue: 5, altRewardType: null, altRewardValue: null, sortOrder: 0 }] })
    );
    expect(await messageOf(updateIncentiveScheme('s1', { slabMode: 'PROGRESSIVE' }))).toContain('do not fit the existing slabs');
    expect(db.incentiveScheme.update).not.toHaveBeenCalled();
  });

  it('flags recalculation when an eligibility-affecting field changes on a scheme that has results', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(stored({ status: 'ACTIVE' }));
    db.incentiveScheme.update.mockResolvedValue({ id: 's1' });
    db.incentiveContribution.count.mockResolvedValue(3);
    const result = await updateIncentiveScheme('s1', { allowAnyTradeType: true });
    expect(result.recalculationRecommended).toBe(true);
    const cosmetic = await updateIncentiveScheme('s1', { description: 'note' });
    expect(cosmetic.recalculationRecommended).toBe(false);
    const sameValue = await updateIncentiveScheme('s1', { slabMode: 'HIGHEST_SLAB_WINS', eligibleTradeTypes: ['DISTRIBUTOR_SALE'] });
    expect(sameValue.recalculationRecommended).toBe(false);
  });

  it('refuses a duplicate slab threshold', async () => {
    db.incentiveScheme.findFirst.mockResolvedValue(stored());
    expect(await messageOf(addSlab('s1', { thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 2 }))).toContain('already exists');
  });
});

describe('permission catalog', () => {
  it('registers the incentives module so routes can be permission checked', () => {
    const keys = permissionCatalog().map((p) => p.key);
    expect(keys).toContain('incentives:schemes:read');
    expect(keys).toContain('incentives:schemes:create');
    expect(keys).toContain('incentives:calculations:manage');
    expect(keys).toContain('incentives:contributions:read');
  });
});
