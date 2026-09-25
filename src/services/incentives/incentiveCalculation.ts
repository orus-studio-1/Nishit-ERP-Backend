// Pure, DB-free incentive calculation logic (eligibility filtering, aggregation,
// slab selection, reward computation). Kept separate from incentiveCalculation.service.ts
// (which does the Prisma/transaction orchestration) so this file can be unit-tested
// without a database.
//
// Confirmed business rules (client):
// - Slab and reward amounts are PRE-TAX and BEFORE discount (GST and discounts do not change the amount).
// - The incentive applies only to purchases from the eligible supplier(s); the same product bought from
//   another merchant does not qualify. Supplier is checked in addition to the product manufacturer.
// - Billing type varies by scheme: each scheme lists the billing types it accepts (or accepts any).
// - Highest slab reached applies its rate to the whole amount (the default slab mode).
// - A product can count towards the slab but earn no reward (slab amount and reward amount are separate).
// Still assumed (not confirmed): negative lines are excluded, and a missing billing type is excluded.

import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export type EligibilityExclusionReason =
  | 'NOT_SUBMITTED'
  | 'OUTSIDE_SCHEME_PERIOD'
  | 'SUPPLIER_NOT_ELIGIBLE'
  | 'TRADE_TYPE_NULL'
  | 'TRADE_TYPE_NOT_ELIGIBLE'
  | 'MANUFACTURER_MISMATCH'
  | 'CATEGORY_MISMATCH'
  | 'PRODUCT_NOT_INCLUDED'
  | 'NEGATIVE_LINE_EXCLUDED'
  | 'MIN_INVOICE_VALUE_NOT_MET'
  | 'PAYMENT_CONDITION_NOT_MET'
  | 'BRANCH_NOT_ELIGIBLE';

export type AmountBasis = 'PRE_TAX_BEFORE_DISCOUNT' | 'PRE_TAX_AFTER_DISCOUNT';

/**
 * The amount a purchase line contributes. Always pre-tax.
 * PurchaseInvoiceItem.total is NOT used: the ERP stores it as net plus GST, and `discount` is a percentage.
 * - PRE_TAX_BEFORE_DISCOUNT (confirmed default): quantity x unit price.
 * - PRE_TAX_AFTER_DISCOUNT: quantity x unit price x (1 - discount%). Only for schemes that say so.
 */
export function linePreTaxAmount(
  line: { quantity: number | string | Decimal; unitPrice: number | string | Decimal; discountPercent?: number | string | Decimal | null },
  basis: AmountBasis = 'PRE_TAX_BEFORE_DISCOUNT'
): Decimal {
  const gross = new D(line.quantity as any).times(new D(line.unitPrice as any));
  if (basis === 'PRE_TAX_AFTER_DISCOUNT') return gross.times(new D(100).minus(new D((line.discountPercent ?? 0) as any))).dividedBy(100);
  return gross;
}

export interface EligibilityLineInput {
  purchaseInvoiceItemId: string;
  productId: string;
  productName?: string | null;
  manufacturer: string | null;
  quantity: number | string | Decimal;
  /** Pre-tax amount for this line, already computed with linePreTaxAmount(). */
  amount: number | string | Decimal;
  /** Optional billing type for this line only; when set it overrides the invoice billing type. */
  tradeType?: string | null;
  categoryId?: string | null;
}

export interface EligibilityInvoiceInput {
  purchaseInvoiceId: string;
  invoiceNo: string;
  date: Date;
  workflowStatus: string;
  supplierId?: string | null;
  tradeType: string | null;
  branchId?: string | null;
  grnDate?: Date | null;
  fullyPaidAt?: Date | null;
  items: EligibilityLineInput[];
}

export interface SchemeEligibilityConfig {
  manufacturerKey: string; // already normalized (see normalizeManufacturer)
  startDate: Date;
  endDate: Date;
  eligibleTradeTypes: string[];
  // When true, billing type is ignored entirely (missing included) and eligibleTradeTypes is not consulted.
  allowAnyTradeType?: boolean;
  // The supplier check applies when eligibleSupplierIds is given and allowAnySupplier is not true.
  eligibleSupplierIds?: string[];
  allowAnySupplier?: boolean;
  // Products that count towards the slab but earn no reward.
  rewardExcludedProductIds?: string[];
  includedProductIds?: string[];
  
  includedCategoryIds?: string[];
  returnHandling?: 'IGNORE_RETURNS' | 'DEDUCT_RETURNS';
  paymentConditionDays?: number | null;
  minInvoiceValue?: Decimal | null;
  maximumIncentiveCap?: Decimal | null;
  baselineVolume?: Decimal | null;
  eligibilityDateBasis?: 'INVOICE_DATE' | 'GRN_DATE';
  autoCalculate?: 'MANUAL' | 'ON_INVOICE_SUBMIT' | 'DAILY' | 'MONTHLY';
  eligibleBranchIds?: string[];
  allowAnyBranch?: boolean;
}

export interface EvaluatedLine {
  purchaseInvoiceItemId: string;
  productId: string;
  productName?: string | null;
  manufacturerRaw: string | null;
  manufacturerNormalized: string;
  quantity: Decimal;
  amount: Decimal;
  effectiveTradeType: string | null;
  /** Counts towards slab achievement. */
  eligible: boolean;
  /** Earns the reward (only meaningful when eligible). */
  rewardEligible: boolean;
  exclusionReason?: EligibilityExclusionReason;
}

export interface EvaluatedInvoice {
  purchaseInvoiceId: string;
  invoiceNo: string;
  date: Date;
  tradeType: string | null;
  invoiceLevelEligible: boolean;
  invoiceExclusionReason?: EligibilityExclusionReason;
  lines: EvaluatedLine[];
  /** Slab achievement amount and quantity (every eligible line). */
  eligibleValue: Decimal;
  eligibleQuantity: Decimal;
  /** Reward amount and quantity (eligible lines not excluded from reward). */
  rewardEligibleValue: Decimal;
  rewardEligibleQuantity: Decimal;
}

/**
 * Normalize a manufacturer string for exact (non-fuzzy) comparison:
 * trim, lowercase, collapse repeated internal whitespace to a single space.
 * "Panasonic", " panasonic ", "PANASONIC" all normalize to "panasonic".
 * "Panasonic India" normalizes to "panasonic india" and does NOT match "panasonic".
 */
export function normalizeManufacturer(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const TRADE_TYPE_REASONS: EligibilityExclusionReason[] = ['TRADE_TYPE_NULL', 'TRADE_TYPE_NOT_ELIGIBLE'];

/**
 * Evaluate one invoice against a scheme.
 * Invoice-level gates: status, date, supplier. If one fails, every line gets that reason.
 * Otherwise each line is checked on its own: billing type (the line's own, else the invoice's), then
 * manufacturer, then a non-negative amount. If every line fails on billing type the invoice is reported as
 * excluded for that reason, so a single-billing-type invoice reads the same as before.
 */
export function evaluateInvoiceEligibility(invoice: EligibilityInvoiceInput, scheme: SchemeEligibilityConfig): EvaluatedInvoice {
  let headerReason: EligibilityExclusionReason | undefined;
  const supplierRestricted = scheme.eligibleSupplierIds !== undefined && !scheme.allowAnySupplier;
  const branchRestricted = scheme.eligibleBranchIds !== undefined && !scheme.allowAnyBranch;
  
  const dateToCheck = scheme.eligibilityDateBasis === 'GRN_DATE' ? (invoice.grnDate ?? invoice.date) : invoice.date;

  if (invoice.workflowStatus !== 'SUBMITTED') headerReason = 'NOT_SUBMITTED';
  else if (dateToCheck < scheme.startDate || dateToCheck > scheme.endDate) headerReason = 'OUTSIDE_SCHEME_PERIOD';
  else if (supplierRestricted && !(invoice.supplierId && scheme.eligibleSupplierIds!.includes(invoice.supplierId))) headerReason = 'SUPPLIER_NOT_ELIGIBLE';
  else if (branchRestricted && !(invoice.branchId && scheme.eligibleBranchIds!.includes(invoice.branchId))) headerReason = 'BRANCH_NOT_ELIGIBLE';
  else if (scheme.paymentConditionDays !== null && scheme.paymentConditionDays !== undefined) {
    if (!invoice.fullyPaidAt) {
      headerReason = 'PAYMENT_CONDITION_NOT_MET';
    } else {
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysTaken = (invoice.fullyPaidAt.getTime() - invoice.date.getTime()) / msPerDay;
      if (daysTaken > scheme.paymentConditionDays) headerReason = 'PAYMENT_CONDITION_NOT_MET';
    }
  }

    const rewardExcluded = new Set(scheme.rewardExcludedProductIds ?? []);
    const productRestricted = scheme.includedProductIds !== undefined && scheme.includedProductIds.length > 0;
    const categoryRestricted = scheme.includedCategoryIds !== undefined && scheme.includedCategoryIds.length > 0;

    const lines: EvaluatedLine[] = invoice.items.map((item) => {
      const manufacturerNormalized = normalizeManufacturer(item.manufacturer);
      const quantity = new D(item.quantity as any);
      const amount = new D(item.amount as any);
      const effectiveTradeType = item.tradeType ?? invoice.tradeType ?? null;

      let reason: EligibilityExclusionReason | undefined = headerReason;
      if (!reason && !scheme.allowAnyTradeType) {
        if (effectiveTradeType === null) reason = 'TRADE_TYPE_NULL';
        else if (!scheme.eligibleTradeTypes.includes(effectiveTradeType)) reason = 'TRADE_TYPE_NOT_ELIGIBLE';
      }
      if (!reason && manufacturerNormalized !== scheme.manufacturerKey) reason = 'MANUFACTURER_MISMATCH';
      if (!reason && categoryRestricted && (!item.categoryId || !scheme.includedCategoryIds!.includes(item.categoryId))) reason = 'CATEGORY_MISMATCH';
      if (!reason && productRestricted && !scheme.includedProductIds!.includes(item.productId)) reason = 'PRODUCT_NOT_INCLUDED';
      if (!reason && amount.isNegative() && scheme.returnHandling !== 'DEDUCT_RETURNS') reason = 'NEGATIVE_LINE_EXCLUDED';

    const eligible = !reason;
    return {
      purchaseInvoiceItemId: item.purchaseInvoiceItemId,
      productId: item.productId,
      productName: item.productName,
      manufacturerRaw: item.manufacturer,
      manufacturerNormalized,
      quantity,
      amount,
      effectiveTradeType,
      eligible,
      rewardEligible: eligible && !rewardExcluded.has(item.productId),
      exclusionReason: reason,
    };
  });

  let invoiceExclusionReason = headerReason;
  if (!invoiceExclusionReason && lines.length > 0 && lines.every((l) => l.exclusionReason && TRADE_TYPE_REASONS.includes(l.exclusionReason))) {
    invoiceExclusionReason = lines[0].exclusionReason;
  }

  const sum = (rows: EvaluatedLine[], pick: (l: EvaluatedLine) => Decimal) => rows.reduce((s, l) => s.plus(pick(l)), new D(0));
  
  if (!invoiceExclusionReason && scheme.minInvoiceValue) {
    const totalEligibleValue = sum(lines.filter(l => !l.exclusionReason), l => l.amount);
    if (totalEligibleValue.lt(scheme.minInvoiceValue)) invoiceExclusionReason = 'MIN_INVOICE_VALUE_NOT_MET';
  }
  if (invoiceExclusionReason && lines.length > 0) {
    lines.forEach(l => { if (!l.exclusionReason) l.exclusionReason = invoiceExclusionReason; l.eligible = false; l.rewardEligible = false; });
  }

  const eligibleLines = lines.filter((l) => l.eligible);
  const rewardLines = lines.filter((l) => l.rewardEligible);

  return {
    purchaseInvoiceId: invoice.purchaseInvoiceId,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    tradeType: invoice.tradeType,
    invoiceLevelEligible: !invoiceExclusionReason,
    invoiceExclusionReason,
    lines,
    eligibleValue: sum(eligibleLines, (l) => l.amount),
    eligibleQuantity: sum(eligibleLines, (l) => l.quantity),
    rewardEligibleValue: sum(rewardLines, (l) => l.amount),
    rewardEligibleQuantity: sum(rewardLines, (l) => l.quantity),
  };
}

export interface AggregateAchievement {
  eligibleValue: Decimal;
  eligibleQuantity: Decimal;
  rewardEligibleValue: Decimal;
  rewardEligibleQuantity: Decimal;
  perInvoice: EvaluatedInvoice[];
}

/** Sum slab and reward amounts across all evaluated invoices for a scheme period. */
export function aggregateAchievement(evaluatedInvoices: EvaluatedInvoice[]): AggregateAchievement {
  const total = (pick: (i: EvaluatedInvoice) => Decimal) => evaluatedInvoices.reduce((s, i) => s.plus(pick(i)), new D(0));
  return {
    eligibleValue: total((i) => i.eligibleValue),
    eligibleQuantity: total((i) => i.eligibleQuantity),
    rewardEligibleValue: total((i) => i.rewardEligibleValue),
    rewardEligibleQuantity: total((i) => i.rewardEligibleQuantity),
    perInvoice: evaluatedInvoices,
  };
}

export interface SlabInput {
  id: string;
  thresholdValue: number | string | Decimal;
  rewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT';
  rewardValue: number | string | Decimal;
  altRewardType?: 'PERCENTAGE' | 'FIXED_PER_UNIT' | null;
  altRewardValue?: number | string | Decimal | null;
  sortOrder: number;
}

/**
 * Highest slab reached (the confirmed default): selects the single slab with the greatest
 * thresholdValue <= achieved basis (value or quantity, per measurementType).
 * Returns null if achievement is below every configured threshold (including
 * a scheme with no slabs at all, or all thresholds > 0 and achievement is 0) —
 * in that case there is no applicable reward, not a zero-slab default.
 */
export function selectSlab(
  slabs: SlabInput[],
  measurementType: 'VALUE' | 'QUANTITY',
  eligibleValue: Decimal,
  eligibleQuantity: Decimal
): SlabInput | null {
  const basis = measurementType === 'VALUE' ? eligibleValue : eligibleQuantity;
  const sorted = [...slabs].sort((a, b) => new D(a.thresholdValue as any).comparedTo(new D(b.thresholdValue as any)));
  let selected: SlabInput | null = null;
  for (const slab of sorted) {
    if (new D(slab.thresholdValue as any).lte(basis)) {
      selected = slab;
    } else {
      break;
    }
  }
  return selected;
}

export interface RewardResult {
  primaryRewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT';
  primaryRewardValue: Decimal;
  primaryIncentiveAmount: Decimal;
  altRewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT' | null;
  altRewardValue: Decimal | null;
  altIncentiveAmount: Decimal | null;
}

function applyReward(
  rewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT',
  rewardValue: Decimal,
  eligibleValue: Decimal,
  eligibleQuantity: Decimal
): Decimal {
  if (rewardType === 'PERCENTAGE') return eligibleValue.times(rewardValue).dividedBy(100);
  return eligibleQuantity.times(rewardValue);
}

/**
 * Compute the reward for a given slab against a given (eligibleValue, eligibleQuantity)
 * pair. Deliberately linear in both inputs, so calling this once with scheme-wide
 * totals (for the summary) and once per invoice (for each contribution's incentiveAmount)
 * produces per-invoice amounts that sum exactly to the scheme-wide total — no proration
 * step is needed. Never auto-selects between primary/alt; both are always returned.
 */
export function computeReward(
  slab: SlabInput | null,
  eligibleValue: Decimal,
  eligibleQuantity: Decimal
): RewardResult | null {
  if (!slab) return null;
  const primaryRewardValue = new D(slab.rewardValue as any);
  const primaryIncentiveAmount = applyReward(slab.rewardType, primaryRewardValue, eligibleValue, eligibleQuantity);

  let altRewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT' | null = null;
  let altRewardValue: Decimal | null = null;
  let altIncentiveAmount: Decimal | null = null;
  if (slab.altRewardType && slab.altRewardValue !== null && slab.altRewardValue !== undefined) {
    altRewardType = slab.altRewardType;
    altRewardValue = new D(slab.altRewardValue as any);
    altIncentiveAmount = applyReward(altRewardType, altRewardValue, eligibleValue, eligibleQuantity);
  }

  return {
    primaryRewardType: slab.rewardType,
    primaryRewardValue,
    primaryIncentiveAmount,
    altRewardType,
    altRewardValue,
    altIncentiveAmount,
  };
}

/** Round only for final display: half-up to 2 decimal places. Never used on intermediate sums. */
export function roundHalfUp2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
