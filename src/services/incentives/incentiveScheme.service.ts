// Incentive scheme management: validated create/update/status/slab operations and
// the progress summary. Calculation itself lives in incentiveCalculation.service.ts.
//
// Tenant scoping: IncentiveScheme carries companyId, so the Prisma tenant proxy scopes
// every scheme query automatically. Slabs, runs and contributions have no companyId of their
// own; they are only ever reached through a scheme that was first loaded via the scoped
// client (see getSchemeOrThrow), so cross-company access is not possible.

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { normalizeManufacturer, type SlabInput } from './incentiveCalculation';
import { computeSlabProgress, validateSlabConfiguration, type MeasurementType, type SlabMode } from './incentiveSlabModes';

const D = Prisma.Decimal;

export const TRADE_TYPES = ['DISTRIBUTOR_SALE', 'SUPER_TRADE', 'SPECIAL_TRADE', 'PROJECT_NON_SPA', 'PROJECT_SPA'] as const;
export const MEASUREMENT_TYPES = ['VALUE', 'QUANTITY'] as const;
export const REWARD_TYPES = ['PERCENTAGE', 'FIXED_PER_UNIT'] as const;
export const SLAB_MODES = ['HIGHEST_SLAB_WINS', 'PROGRESSIVE'] as const;
export const AMOUNT_BASES = ['PRE_TAX_BEFORE_DISCOUNT', 'PRE_TAX_AFTER_DISCOUNT'] as const;
export const SCHEME_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'] as const;

export type TradeType = (typeof TRADE_TYPES)[number];
export type RewardType = (typeof REWARD_TYPES)[number];
export type AmountBasisType = (typeof AMOUNT_BASES)[number];
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

/** Thrown for invalid input; controllers turn it into a 400. */
export class IncentiveValidationError extends Error {
  constructor(message: string, public details?: string[]) {
    super(message);
    this.name = 'IncentiveValidationError';
  }
}
/** Thrown when a scheme is not found (or belongs to another company); controllers turn it into a 404. */
export class IncentiveNotFoundError extends Error {
  constructor(message = 'Incentive scheme not found') {
    super(message);
    this.name = 'IncentiveNotFoundError';
  }
}

export interface SlabInputDto {
  thresholdValue: number | string;
  rewardType: RewardType;
  rewardValue: number | string;
  altRewardType?: RewardType | null;
  altRewardValue?: number | string | null;
  sortOrder?: number;
}

export interface SchemeInputDto {
  manufacturerLabel: string;
  name: string;
  code?: string | null;
  description?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  measurementType: MeasurementType;
  eligibleTradeTypes?: TradeType[];
  allowAnyTradeType?: boolean;
  /** Pre-tax before discount by default; PRE_TAX_AFTER_DISCOUNT only for schemes that say so. */
  amountBasis?: AmountBasisType;
  /** Suppliers the incentive applies to. Required unless allowAnySupplier is true. */
  eligibleSupplierIds?: string[];
  allowAnySupplier?: boolean;
  /** Products that count towards the slab but earn no reward. */
  rewardExcludedProductIds?: string[];
  includedCategoryIds?: string[];
  returnHandling?: 'IGNORE_RETURNS' | 'DEDUCT_RETURNS';
  paymentConditionDays?: number | string | null;
  minInvoiceValue?: number | string | null;
  eligibilityDateBasis?: 'INVOICE_DATE' | 'GRN_DATE';
  autoCalculate?: 'MANUAL' | 'ON_INVOICE_SUBMIT' | 'DAILY' | 'MONTHLY';
  eligibleBranchIds?: string[];
  allowAnyBranch?: boolean;
  slabMode?: SlabMode;
  bookingChannel?: string | null;
  status?: SchemeStatus;
  slabs?: SlabInputDto[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new IncentiveValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!value || Number.isNaN(date.getTime())) throw new IncentiveValidationError(`${field} must be a valid date`);
  return date;
}

function parseDecimal(value: unknown, field: string): Prisma.Decimal {
  if (value === null || value === undefined || value === '') throw new IncentiveValidationError(`${field} is required`);
  try {
    const parsed = new D(value as any);
    if (!parsed.isFinite()) throw new Error('not finite');
    return parsed;
  } catch {
    throw new IncentiveValidationError(`${field} must be a number`);
  }
}

function parseSlab(input: SlabInputDto, index: number) {
  const label = `slabs[${index}]`;
  const thresholdValue = parseDecimal(input.thresholdValue, `${label}.thresholdValue`);
  const rewardValue = parseDecimal(input.rewardValue, `${label}.rewardValue`);
  if (thresholdValue.isNegative()) throw new IncentiveValidationError(`${label}.thresholdValue cannot be negative`);
  if (rewardValue.isNegative()) throw new IncentiveValidationError(`${label}.rewardValue cannot be negative`);
  const rewardType = oneOf(input.rewardType, REWARD_TYPES, `${label}.rewardType`);

  const hasAltType = input.altRewardType !== undefined && input.altRewardType !== null;
  const hasAltValue = input.altRewardValue !== undefined && input.altRewardValue !== null && input.altRewardValue !== '';
  if (hasAltType !== hasAltValue) throw new IncentiveValidationError(`${label}: alternate reward needs both altRewardType and altRewardValue`);
  const altRewardType = hasAltType ? oneOf(input.altRewardType, REWARD_TYPES, `${label}.altRewardType`) : null;
  const altRewardValue = hasAltValue ? parseDecimal(input.altRewardValue, `${label}.altRewardValue`) : null;
  if (altRewardValue?.isNegative()) throw new IncentiveValidationError(`${label}.altRewardValue cannot be negative`);

  return { thresholdValue, rewardType, rewardValue, altRewardType, altRewardValue };
}

/** Assigns sortOrder by ascending threshold and rejects duplicate thresholds. */
function orderSlabs(parsed: ReturnType<typeof parseSlab>[]) {
  const sorted = [...parsed].sort((a, b) => a.thresholdValue.comparedTo(b.thresholdValue));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].thresholdValue.equals(sorted[i - 1].thresholdValue)) {
      throw new IncentiveValidationError(`Duplicate slab threshold: ${sorted[i].thresholdValue.toString()}`);
    }
  }
  return sorted.map((slab, index) => ({ ...slab, sortOrder: index }));
}

function toSlabInputs(slabs: Array<{ id: string; thresholdValue: any; rewardType: any; rewardValue: any; altRewardType: any; altRewardValue: any; sortOrder: number }>): SlabInput[] {
  return slabs.map((s) => ({
    id: s.id,
    thresholdValue: s.thresholdValue,
    rewardType: s.rewardType,
    rewardValue: s.rewardValue,
    altRewardType: s.altRewardType,
    altRewardValue: s.altRewardValue,
    sortOrder: s.sortOrder,
  }));
}

function assertTradeTypeConfig(allowAnyTradeType: boolean, eligibleTradeTypes: TradeType[]) {
  if (!allowAnyTradeType && eligibleTradeTypes.length === 0) {
    throw new IncentiveValidationError('Choose at least one eligible trade type, or set allowAnyTradeType to true');
  }
}

function assertSupplierConfig(allowAnySupplier: boolean, supplierIds: string[]) {
  if (!allowAnySupplier && supplierIds.length === 0) {
    throw new IncentiveValidationError('Choose at least one eligible supplier, or set allowAnySupplier to true');
  }
}

function cleanIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) throw new IncentiveValidationError(`${field} must be a list of ids`);
  return [...new Set(value.map((v: string) => v.trim()))];
}

function assertProgressiveRewardExclusions(slabMode: SlabMode, rewardExcludedProductIds: string[]) {
  if (slabMode === 'PROGRESSIVE' && rewardExcludedProductIds.length > 0) {
    throw new IncentiveValidationError('Reward-excluded products are not supported with PROGRESSIVE slabs');
  }
}

/** Suppliers, products, categories, branches must exist in the caller company (queries are tenant scoped). */
async function assertReferencesExist(supplierIds: string[], productIds: string[], categoryIds: string[] = [], branchIds: string[] = []) {
  if (supplierIds.length) {
    const found = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true } });
    const missing = supplierIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new IncentiveValidationError(`Unknown supplier id(s): ${missing.join(', ')}`);
  }
  if (productIds.length) {
    const found = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } });
    const missing = productIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new IncentiveValidationError(`Unknown product id(s): ${missing.join(', ')}`);
  }
  if (categoryIds.length) {
    const found = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true } });
    const missing = categoryIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new IncentiveValidationError(`Unknown category id(s): ${missing.join(', ')}`);
  }
  if (branchIds.length) {
    const found = await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true } });
    const missing = branchIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new IncentiveValidationError(`Unknown branch id(s): ${missing.join(', ')}`);
  }
}

export async function getSchemeOrThrow(id: string, includeSlabs = false) {
  const scheme = await prisma.incentiveScheme.findFirst({ where: { id }, include: { slabs: includeSlabs ? { orderBy: { sortOrder: 'asc' } } : false } });
  if (!scheme) throw new IncentiveNotFoundError();
  return scheme as typeof scheme & { slabs: any[] };
}

export async function createIncentiveScheme(input: SchemeInputDto) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new IncentiveValidationError('name is required');
  const manufacturerLabel = String(input.manufacturerLabel ?? '').trim();
  const manufacturerKey = normalizeManufacturer(manufacturerLabel);
  if (!manufacturerKey) throw new IncentiveValidationError('manufacturerLabel is required');
  const startDate = parseDate(input.startDate, 'startDate');
  const endDate = parseDate(input.endDate, 'endDate');
  if (startDate > endDate) throw new IncentiveValidationError('startDate must not be after endDate');

  const measurementType = oneOf(input.measurementType, MEASUREMENT_TYPES, 'measurementType');
  const slabMode = input.slabMode === undefined ? 'HIGHEST_SLAB_WINS' : oneOf(input.slabMode, SLAB_MODES, 'slabMode');
  const status = input.status === undefined ? 'DRAFT' : oneOf(input.status, SCHEME_STATUSES, 'status');
  const allowAnyTradeType = input.allowAnyTradeType === true;
  const eligibleTradeTypes = (input.eligibleTradeTypes ?? []).map((t) => oneOf(t, TRADE_TYPES, 'eligibleTradeTypes[]'));
  assertTradeTypeConfig(allowAnyTradeType, eligibleTradeTypes);
  const amountBasis = input.amountBasis === undefined ? 'PRE_TAX_BEFORE_DISCOUNT' : oneOf(input.amountBasis, AMOUNT_BASES, 'amountBasis');
  const allowAnySupplier = input.allowAnySupplier === true;
  const eligibleSupplierIds = cleanIds(input.eligibleSupplierIds, 'eligibleSupplierIds');
  const rewardExcludedProductIds = cleanIds(input.rewardExcludedProductIds, 'rewardExcludedProductIds');
  
  const allowAnyBranch = input.allowAnyBranch === undefined ? true : input.allowAnyBranch === true;
  const eligibleBranchIds = cleanIds(input.eligibleBranchIds, 'eligibleBranchIds');
  const includedCategoryIds = cleanIds(input.includedCategoryIds, 'includedCategoryIds');
  const returnHandling = input.returnHandling === undefined ? 'IGNORE_RETURNS' : oneOf(input.returnHandling, ['IGNORE_RETURNS', 'DEDUCT_RETURNS'], 'returnHandling');
  const eligibilityDateBasis = input.eligibilityDateBasis === undefined ? 'INVOICE_DATE' : oneOf(input.eligibilityDateBasis, ['INVOICE_DATE', 'GRN_DATE'], 'eligibilityDateBasis');
  const autoCalculate = input.autoCalculate === undefined ? 'MANUAL' : oneOf(input.autoCalculate, ['MANUAL', 'ON_INVOICE_SUBMIT', 'DAILY', 'MONTHLY'], 'autoCalculate');
  
  const paymentConditionDays = (input.paymentConditionDays === null || input.paymentConditionDays === undefined || input.paymentConditionDays === '') ? null : parseInt(String(input.paymentConditionDays), 10);
  if (paymentConditionDays !== null && (isNaN(paymentConditionDays) || paymentConditionDays < 0)) throw new IncentiveValidationError('paymentConditionDays must be a positive integer');
  
  let minInvoiceValue: Prisma.Decimal | null = null;
  if (input.minInvoiceValue !== null && input.minInvoiceValue !== undefined && input.minInvoiceValue !== '') {
    minInvoiceValue = parseDecimal(input.minInvoiceValue, 'minInvoiceValue');
    if (minInvoiceValue.isNegative()) throw new IncentiveValidationError('minInvoiceValue cannot be negative');
  }

  assertSupplierConfig(allowAnySupplier, eligibleSupplierIds);
  if (!allowAnyBranch && eligibleBranchIds.length === 0) throw new IncentiveValidationError('Choose at least one eligible branch, or set allowAnyBranch to true');
  assertProgressiveRewardExclusions(slabMode, rewardExcludedProductIds);
  await assertReferencesExist(eligibleSupplierIds, rewardExcludedProductIds, includedCategoryIds, eligibleBranchIds);

  const slabs = orderSlabs((input.slabs ?? []).map(parseSlab));
  if (slabs.length) {
    const problems = validateSlabConfiguration(
      slabs.map((s, i) => ({ id: `slabs[${i}]`, ...s, altRewardType: s.altRewardType, altRewardValue: s.altRewardValue })),
      slabMode,
      measurementType
    );
    if (problems.length) throw new IncentiveValidationError('Invalid slab configuration', problems);
  }
  if (status === 'ACTIVE' && slabs.length === 0) throw new IncentiveValidationError('An ACTIVE scheme needs at least one slab');

  return prisma.$transaction(async (tx: any) => {
    const scheme = await tx.incentiveScheme.create({
      data: {
        manufacturerKey,
        manufacturerLabel,
        name,
        code: input.code || null,
        description: input.description || null,
        startDate,
        endDate,
        measurementType,
        eligibleTradeTypes,
        allowAnyTradeType,
        amountBasis,
        eligibleSupplierIds,
        allowAnySupplier,
        rewardExcludedProductIds,
        includedCategoryIds,
        returnHandling,
        paymentConditionDays,
        minInvoiceValue,
        eligibilityDateBasis,
        autoCalculate,
        eligibleBranchIds,
        allowAnyBranch,
        slabMode,
        bookingChannel: input.bookingChannel || null,
        status,
      },
    });
    for (const slab of slabs) {
      await tx.incentiveSlab.create({ data: { schemeId: scheme.id, ...slab } });
    }
    return tx.incentiveScheme.findFirst({ where: { id: scheme.id }, include: { slabs: { orderBy: { sortOrder: 'asc' } } } });
  });
}

export type SchemePatch = Partial<Omit<SchemeInputDto, 'slabs' | 'status'>>;

/**
 * Updates scheme configuration (not status, not slabs). Editing rules that change eligibility or
 * rewards does NOT recalculate anything: existing contributions stay as they were until an
 * explicit recalculation runs, which is reported back via `recalculationRecommended`.
 */
export async function updateIncentiveScheme(id: string, patch: SchemePatch) {
  const current = await getSchemeOrThrow(id, true);
  const data: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new IncentiveValidationError('name cannot be empty');
    data.name = name;
  }
  if (patch.manufacturerLabel !== undefined) {
    const label = String(patch.manufacturerLabel).trim();
    const key = normalizeManufacturer(label);
    if (!key) throw new IncentiveValidationError('manufacturerLabel cannot be empty');
    data.manufacturerLabel = label;
    data.manufacturerKey = key;
  }
  if (patch.code !== undefined) data.code = patch.code || null;
  if (patch.description !== undefined) data.description = patch.description || null;
  if (patch.bookingChannel !== undefined) data.bookingChannel = patch.bookingChannel || null;

  const startDate = patch.startDate !== undefined ? parseDate(patch.startDate, 'startDate') : current.startDate;
  const endDate = patch.endDate !== undefined ? parseDate(patch.endDate, 'endDate') : current.endDate;
  if (startDate > endDate) throw new IncentiveValidationError('startDate must not be after endDate');
  if (patch.startDate !== undefined) data.startDate = startDate;
  if (patch.endDate !== undefined) data.endDate = endDate;

  const measurementType = patch.measurementType !== undefined ? oneOf(patch.measurementType, MEASUREMENT_TYPES, 'measurementType') : (current.measurementType as MeasurementType);
  const slabMode = patch.slabMode !== undefined ? oneOf(patch.slabMode, SLAB_MODES, 'slabMode') : (current.slabMode as SlabMode);
  const allowAnyTradeType = patch.allowAnyTradeType !== undefined ? patch.allowAnyTradeType === true : current.allowAnyTradeType;
  const eligibleTradeTypes =
    patch.eligibleTradeTypes !== undefined ? patch.eligibleTradeTypes.map((t) => oneOf(t, TRADE_TYPES, 'eligibleTradeTypes[]')) : (current.eligibleTradeTypes as TradeType[]);
  assertTradeTypeConfig(allowAnyTradeType, eligibleTradeTypes);
  const amountBasis = patch.amountBasis !== undefined ? oneOf(patch.amountBasis, AMOUNT_BASES, 'amountBasis') : (current.amountBasis as AmountBasisType);
  const allowAnySupplier = patch.allowAnySupplier !== undefined ? patch.allowAnySupplier === true : current.allowAnySupplier;
  const eligibleSupplierIds = patch.eligibleSupplierIds !== undefined ? cleanIds(patch.eligibleSupplierIds, 'eligibleSupplierIds') : (current.eligibleSupplierIds as string[]);
  const rewardExcludedProductIds = patch.rewardExcludedProductIds !== undefined ? cleanIds(patch.rewardExcludedProductIds, 'rewardExcludedProductIds') : (current.rewardExcludedProductIds as string[]);
  
  const allowAnyBranch = patch.allowAnyBranch !== undefined ? patch.allowAnyBranch === true : current.allowAnyBranch;
  const eligibleBranchIds = patch.eligibleBranchIds !== undefined ? cleanIds(patch.eligibleBranchIds, 'eligibleBranchIds') : (current.eligibleBranchIds as string[]);
  const includedCategoryIds = patch.includedCategoryIds !== undefined ? cleanIds(patch.includedCategoryIds, 'includedCategoryIds') : (current.includedCategoryIds as string[]);
  
  if (patch.returnHandling !== undefined) data.returnHandling = oneOf(patch.returnHandling, ['IGNORE_RETURNS', 'DEDUCT_RETURNS'], 'returnHandling');
  if (patch.eligibilityDateBasis !== undefined) data.eligibilityDateBasis = oneOf(patch.eligibilityDateBasis, ['INVOICE_DATE', 'GRN_DATE'], 'eligibilityDateBasis');
  if (patch.autoCalculate !== undefined) data.autoCalculate = oneOf(patch.autoCalculate, ['MANUAL', 'ON_INVOICE_SUBMIT', 'DAILY', 'MONTHLY'], 'autoCalculate');
  
  if (patch.paymentConditionDays !== undefined) {
    if (patch.paymentConditionDays === null || patch.paymentConditionDays === '') data.paymentConditionDays = null;
    else {
      const days = parseInt(String(patch.paymentConditionDays), 10);
      if (isNaN(days) || days < 0) throw new IncentiveValidationError('paymentConditionDays must be a positive integer');
      data.paymentConditionDays = days;
    }
  }
  
  if (patch.minInvoiceValue !== undefined) {
    if (patch.minInvoiceValue === null || patch.minInvoiceValue === '') data.minInvoiceValue = null;
    else {
      const minVal = parseDecimal(patch.minInvoiceValue, 'minInvoiceValue');
      if (minVal.isNegative()) throw new IncentiveValidationError('minInvoiceValue cannot be negative');
      data.minInvoiceValue = minVal;
    }
  }

  // Schemes created before supplier rules may have none; only complain when this edit touches suppliers.
  if (patch.eligibleSupplierIds !== undefined || patch.allowAnySupplier !== undefined) assertSupplierConfig(allowAnySupplier, eligibleSupplierIds);
  if (patch.eligibleBranchIds !== undefined || patch.allowAnyBranch !== undefined) {
    if (!allowAnyBranch && eligibleBranchIds.length === 0) throw new IncentiveValidationError('Choose at least one eligible branch, or set allowAnyBranch to true');
  }
  assertProgressiveRewardExclusions(slabMode, rewardExcludedProductIds);
  await assertReferencesExist(
    patch.eligibleSupplierIds !== undefined ? eligibleSupplierIds : [],
    patch.rewardExcludedProductIds !== undefined ? rewardExcludedProductIds : [],
    patch.includedCategoryIds !== undefined ? includedCategoryIds : [],
    patch.eligibleBranchIds !== undefined ? eligibleBranchIds : []
  );

  if (current.slabs.length) {
    const problems = validateSlabConfiguration(toSlabInputs(current.slabs), slabMode, measurementType);
    if (problems.length) throw new IncentiveValidationError('These settings do not fit the existing slabs', problems);
  }
  if (patch.measurementType !== undefined && measurementType !== current.measurementType) data.measurementType = measurementType;
  if (patch.slabMode !== undefined && slabMode !== current.slabMode) data.slabMode = slabMode;
  if (patch.amountBasis !== undefined && amountBasis !== current.amountBasis) data.amountBasis = amountBasis;
  if (patch.allowAnySupplier !== undefined && allowAnySupplier !== current.allowAnySupplier) data.allowAnySupplier = allowAnySupplier;
  const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  if (patch.eligibleSupplierIds !== undefined && !sameSet(eligibleSupplierIds, current.eligibleSupplierIds)) data.eligibleSupplierIds = eligibleSupplierIds;
  if (patch.rewardExcludedProductIds !== undefined && !sameSet(rewardExcludedProductIds, current.rewardExcludedProductIds)) data.rewardExcludedProductIds = rewardExcludedProductIds;
  if (patch.eligibleBranchIds !== undefined && !sameSet(eligibleBranchIds, current.eligibleBranchIds)) data.eligibleBranchIds = eligibleBranchIds;
  if (patch.includedCategoryIds !== undefined && !sameSet(includedCategoryIds, current.includedCategoryIds)) data.includedCategoryIds = includedCategoryIds;
  if (patch.allowAnyBranch !== undefined && allowAnyBranch !== current.allowAnyBranch) data.allowAnyBranch = allowAnyBranch;
  if (patch.allowAnyTradeType !== undefined && allowAnyTradeType !== current.allowAnyTradeType) data.allowAnyTradeType = allowAnyTradeType;
  if (patch.eligibleTradeTypes !== undefined && [...eligibleTradeTypes].sort().join() !== [...current.eligibleTradeTypes].sort().join()) {
    data.eligibleTradeTypes = eligibleTradeTypes;
  }
  // Unchanged dates and manufacturer are not results-affecting either.
  if (patch.startDate !== undefined && startDate.getTime() === current.startDate.getTime()) delete data.startDate;
  if (patch.endDate !== undefined && endDate.getTime() === current.endDate.getTime()) delete data.endDate;
  if (data.manufacturerKey === current.manufacturerKey) delete data.manufacturerKey;

  const updated = await prisma.incentiveScheme.update({ where: { id }, data, include: { slabs: { orderBy: { sortOrder: 'asc' } } } });
  const affectsResults = ['manufacturerKey', 'startDate', 'endDate', 'measurementType', 'slabMode', 'allowAnyTradeType', 'eligibleTradeTypes', 'amountBasis', 'allowAnySupplier', 'eligibleSupplierIds', 'rewardExcludedProductIds', 'includedCategoryIds', 'returnHandling', 'paymentConditionDays', 'minInvoiceValue', 'eligibilityDateBasis', 'eligibleBranchIds', 'allowAnyBranch'].some((key) => key in data);
  const hasContributions = (await prisma.incentiveContribution.count({ where: { schemeId: id, lifecycleStatus: 'ACTIVE' } })) > 0;
  return { scheme: updated, recalculationRecommended: affectsResults && hasContributions };
}

const STATUS_TRANSITIONS: Record<SchemeStatus, SchemeStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['CLOSED', 'CANCELLED'],
  CLOSED: ['ACTIVE'],
  CANCELLED: [],
};

export async function changeSchemeStatus(id: string, nextStatus: unknown) {
  const status = oneOf(nextStatus, SCHEME_STATUSES, 'status');
  const scheme = await getSchemeOrThrow(id, true);
  if (scheme.status === status) return scheme;
  if (!STATUS_TRANSITIONS[scheme.status as SchemeStatus].includes(status)) {
    throw new IncentiveValidationError(`Cannot change status from ${scheme.status} to ${status}`);
  }
  if (status === 'ACTIVE') {
    const problems = validateSlabConfiguration(toSlabInputs(scheme.slabs), scheme.slabMode as SlabMode, scheme.measurementType as MeasurementType);
    if (!scheme.allowAnySupplier && scheme.eligibleSupplierIds.length === 0) problems.push('Choose the eligible supplier(s) or allow any supplier.');
    if (scheme.slabMode === 'PROGRESSIVE' && scheme.rewardExcludedProductIds.length > 0) problems.push('Reward-excluded products are not supported with PROGRESSIVE slabs.');
    if (problems.length) throw new IncentiveValidationError('Scheme cannot be activated', problems);
  }
  return prisma.incentiveScheme.update({ where: { id }, data: { status }, include: { slabs: { orderBy: { sortOrder: 'asc' } } } });
}

/** Rebuilds sortOrder so it always follows ascending threshold, after any slab add/change/delete. */
async function resequenceSlabs(tx: any, schemeId: string) {
  const slabs = await tx.incentiveSlab.findMany({ where: { schemeId }, orderBy: { thresholdValue: 'asc' } });
  // Two-step to avoid tripping the (schemeId, sortOrder) unique index mid-update.
  for (let i = 0; i < slabs.length; i++) await tx.incentiveSlab.update({ where: { id: slabs[i].id }, data: { sortOrder: -(i + 1) } });
  for (let i = 0; i < slabs.length; i++) await tx.incentiveSlab.update({ where: { id: slabs[i].id }, data: { sortOrder: i } });
}

export async function addSlab(schemeId: string, input: SlabInputDto) {
  const scheme = await getSchemeOrThrow(schemeId, true);
  const parsed = parseSlab(input, 0);
  if (scheme.slabs.some((s: any) => new D(s.thresholdValue).equals(parsed.thresholdValue))) {
    throw new IncentiveValidationError(`A slab with threshold ${parsed.thresholdValue.toString()} already exists`);
  }
  const candidate = [...toSlabInputs(scheme.slabs), { id: 'new', ...parsed, sortOrder: scheme.slabs.length }];
  const problems = validateSlabConfiguration(candidate, scheme.slabMode as SlabMode, scheme.measurementType as MeasurementType);
  if (problems.length) throw new IncentiveValidationError('Invalid slab configuration', problems);

  return prisma.$transaction(async (tx: any) => {
    const created = await tx.incentiveSlab.create({ data: { schemeId, ...parsed, sortOrder: 1000 + scheme.slabs.length } });
    await resequenceSlabs(tx, schemeId);
    return tx.incentiveSlab.findFirst({ where: { id: created.id } });
  });
}

export async function updateSlab(schemeId: string, slabId: string, input: SlabInputDto) {
  const scheme = await getSchemeOrThrow(schemeId, true);
  if (!scheme.slabs.some((s: any) => s.id === slabId)) throw new IncentiveNotFoundError('Slab not found');
  const parsed = parseSlab(input, 0);
  if (scheme.slabs.some((s: any) => s.id !== slabId && new D(s.thresholdValue).equals(parsed.thresholdValue))) {
    throw new IncentiveValidationError(`A slab with threshold ${parsed.thresholdValue.toString()} already exists`);
  }
  const candidate = toSlabInputs(scheme.slabs).map((s) => (s.id === slabId ? { ...s, ...parsed } : s));
  const problems = validateSlabConfiguration(candidate, scheme.slabMode as SlabMode, scheme.measurementType as MeasurementType);
  if (problems.length) throw new IncentiveValidationError('Invalid slab configuration', problems);

  return prisma.$transaction(async (tx: any) => {
    await tx.incentiveSlab.update({ where: { id: slabId }, data: parsed });
    await resequenceSlabs(tx, schemeId);
    return tx.incentiveSlab.findFirst({ where: { id: slabId } });
  });
}

export async function deleteSlab(schemeId: string, slabId: string) {
  const scheme = await getSchemeOrThrow(schemeId, true);
  if (!scheme.slabs.some((s: any) => s.id === slabId)) throw new IncentiveNotFoundError('Slab not found');
  const referenced = await prisma.incentiveContribution.count({ where: { slabId } });
  if (referenced > 0) {
    throw new IncentiveValidationError('This slab is referenced by past calculations and cannot be deleted. Recalculation history must stay intact.');
  }
  if (scheme.status === 'ACTIVE' && scheme.slabs.length === 1) {
    throw new IncentiveValidationError('An ACTIVE scheme needs at least one slab');
  }
  await prisma.$transaction(async (tx: any) => {
    await tx.incentiveSlab.delete({ where: { id: slabId } });
    await resequenceSlabs(tx, schemeId);
  });
}

/**
 * Current standing of a scheme, from ACTIVE contributions only: totals, the slab reached, and how far
 * the next slab is. Reads stored results; it does not recalculate. `lastRun` shows how fresh they are.
 */
export async function getSchemeSummary(schemeId: string) {
  const scheme = await getSchemeOrThrow(schemeId, true);
  const [totals, contributionCount, settledTotals, settledCount, lastRun, lastCompletedRun] = await Promise.all([
    prisma.incentiveContribution.aggregate({
      where: { schemeId, lifecycleStatus: 'ACTIVE' },
      _sum: { eligibleValue: true, eligibleQuantity: true, rewardEligibleValue: true, rewardEligibleQuantity: true, incentiveAmount: true, altIncentiveAmount: true },
    }),
    prisma.incentiveContribution.count({ where: { schemeId, lifecycleStatus: 'ACTIVE' } }),
    prisma.incentiveContribution.aggregate({
      where: { schemeId, lifecycleStatus: 'ACTIVE', settlementStatus: 'SETTLED' },
      _sum: { settledAmount: true },
    }),
    prisma.incentiveContribution.count({ where: { schemeId, lifecycleStatus: 'ACTIVE', settlementStatus: 'SETTLED' } }),
    prisma.incentiveCalculationRun.findFirst({ where: { schemeId }, orderBy: { startedAt: 'desc' } }),
    prisma.incentiveCalculationRun.findFirst({ where: { schemeId, status: 'COMPLETED' }, orderBy: { startedAt: 'desc' } }),
  ]);

  const eligibleValue = new D(totals._sum.eligibleValue ?? 0);
  const eligibleQuantity = new D(totals._sum.eligibleQuantity ?? 0);
  const progress = computeSlabProgress(toSlabInputs(scheme.slabs), scheme.measurementType as MeasurementType, eligibleValue, eligibleQuantity);
  const slabView = (slab: SlabInput | null) => (slab ? { id: slab.id, thresholdValue: String(slab.thresholdValue), rewardType: slab.rewardType, rewardValue: String(slab.rewardValue) } : null);

  return {
    scheme: {
      id: scheme.id,
      name: scheme.name,
      code: scheme.code,
      manufacturerLabel: scheme.manufacturerLabel,
      status: scheme.status,
      measurementType: scheme.measurementType,
      slabMode: scheme.slabMode,
      allowAnyTradeType: scheme.allowAnyTradeType,
      eligibleTradeTypes: scheme.eligibleTradeTypes,
      amountBasis: scheme.amountBasis,
      allowAnySupplier: scheme.allowAnySupplier,
      eligibleSupplierIds: scheme.eligibleSupplierIds,
      rewardExcludedProductIds: scheme.rewardExcludedProductIds,
      includedCategoryIds: scheme.includedCategoryIds,
      returnHandling: scheme.returnHandling,
      paymentConditionDays: scheme.paymentConditionDays,
      minInvoiceValue: scheme.minInvoiceValue ? String(scheme.minInvoiceValue) : null,
      eligibilityDateBasis: scheme.eligibilityDateBasis,
      autoCalculate: scheme.autoCalculate,
      eligibleBranchIds: scheme.eligibleBranchIds,
      allowAnyBranch: scheme.allowAnyBranch,
      startDate: scheme.startDate,
      endDate: scheme.endDate,
    },
    achievement: {
      eligibleValue: eligibleValue.toString(),
      eligibleQuantity: eligibleQuantity.toString(),
      rewardEligibleValue: new D(totals._sum.rewardEligibleValue ?? 0).toString(),
      rewardEligibleQuantity: new D(totals._sum.rewardEligibleQuantity ?? 0).toString(),
      activeContributions: contributionCount,
    },
    incentive: {
      primaryAmount: new D(totals._sum.incentiveAmount ?? 0).toString(),
      alternateAmount: totals._sum.altIncentiveAmount === null ? null : new D(totals._sum.altIncentiveAmount ?? 0).toString(),
      note: 'Estimated from the last completed calculation. Not a settled or approved amount.',
      settledAmount: new D(settledTotals._sum.settledAmount ?? 0).toString(),
      settledCount,
      pendingCount: Math.max(0, contributionCount - settledCount),
    },
    progress: {
      currentSlab: slabView(progress.currentSlab),
      nextSlab: slabView(progress.nextSlab),
      remainingToNextSlab: progress.remainingToNext?.toString() ?? null,
      progressToNextSlabPercent: progress.progressToNextPercent ? progress.progressToNextPercent.toDecimalPlaces(2).toString() : null,
    },
    freshness: {
      lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, completedAt: lastRun.completedAt } : null,
      lastCompletedAt: lastCompletedRun?.completedAt ?? null,
    },
  };
}

export interface SettleContributionDto {
  settledAmount?: number | string;
  settledReference?: string;
  settledAt?: string;
  notes?: string;
  userId?: string;
}

/** Records that a contribution's incentive amount was actually received (e.g. a credit note from
 * the manufacturer). This is manual bookkeeping only — see the module notes on why there is no
 * automatic settlement/credit-note processing. */
export async function settleContribution(schemeId: string, contributionId: string, input: SettleContributionDto) {
  await getSchemeOrThrow(schemeId);
  const contribution = await prisma.incentiveContribution.findFirst({ where: { id: contributionId, schemeId } });
  if (!contribution) throw new IncentiveNotFoundError('Contribution not found');
  if (contribution.lifecycleStatus !== 'ACTIVE') throw new IncentiveValidationError('Only an active contribution can be marked as received; this one was superseded or reversed.');
  if (contribution.settlementStatus === 'SETTLED') throw new IncentiveValidationError('This contribution is already marked as received.');
  const settledAmount = input.settledAmount !== undefined && input.settledAmount !== null && input.settledAmount !== ''
    ? new D(input.settledAmount)
    : contribution.incentiveAmount;
  if (settledAmount.lt(0)) throw new IncentiveValidationError('Settled amount cannot be negative.');
  return prisma.incentiveContribution.update({
    where: { id: contributionId },
    data: {
      settlementStatus: 'SETTLED',
      settledAmount,
      settledAt: input.settledAt ? new Date(input.settledAt) : new Date(),
      settledReference: input.settledReference?.trim() || undefined,
      settledById: input.userId,
      settlementNotes: input.notes?.trim() || undefined,
    },
  });
}

/** Reverts a settled contribution back to pending, e.g. after a data-entry mistake. */
export async function unsettleContribution(schemeId: string, contributionId: string) {
  await getSchemeOrThrow(schemeId);
  const contribution = await prisma.incentiveContribution.findFirst({ where: { id: contributionId, schemeId } });
  if (!contribution) throw new IncentiveNotFoundError('Contribution not found');
  if (contribution.settlementStatus !== 'SETTLED') throw new IncentiveValidationError('This contribution is not marked as received.');
  return prisma.incentiveContribution.update({
    where: { id: contributionId },
    data: { settlementStatus: 'PENDING', settledAmount: null, settledAt: null, settledReference: null, settledById: null, settlementNotes: null },
  });
}
