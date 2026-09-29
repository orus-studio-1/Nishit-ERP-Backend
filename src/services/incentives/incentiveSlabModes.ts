// Per-scheme slab modes, slab validation, per-invoice reward allocation and slab progress.
// Pure and DB-free, built on the primitives in ./incentiveCalculation.ts.
//
// Slab modes (IncentiveScheme.slabMode):
// - HIGHEST_SLAB_WINS (default, confirmed for Panasonic): the single highest slab reached applies its
//   rate to the whole reward amount.
// - PROGRESSIVE: each slab's rate applies only to the band of achievement between that
//   slab's threshold and the next slab's threshold (like tax brackets).

import { Prisma } from '@prisma/client';
import { computeReward, selectSlab, type Decimal, type RewardResult, type SlabInput } from './incentiveCalculation';

const D = Prisma.Decimal;

export type SlabMode = 'HIGHEST_SLAB_WINS' | 'PROGRESSIVE';
export type MeasurementType = 'VALUE' | 'QUANTITY';

const sortByThreshold = (slabs: SlabInput[]) =>
  [...slabs].sort((a, b) => new D(a.thresholdValue as any).comparedTo(new D(b.thresholdValue as any)));

/**
 * Validates that a scheme's slab configuration can be calculated in its mode.
 * Returns human-readable problems (an empty list means valid).
 *
 * PROGRESSIVE is only well defined when the reward basis matches the measurement:
 * VALUE schemes pay PERCENTAGE, QUANTITY schemes pay FIXED_PER_UNIT. A mix (a per-unit
 * reward on a value-measured scheme) would need the quantity that fell inside a value
 * band, which cannot be derived, so it is rejected rather than guessed. Alternate rewards
 * in PROGRESSIVE mode must be set on every slab or on none, so the alternate total is
 * never partial. HIGHEST_SLAB_WINS has no such restriction.
 */
export function validateSlabConfiguration(slabs: SlabInput[], slabMode: SlabMode, measurementType: MeasurementType): string[] {
  const problems: string[] = [];
  if (slabs.length === 0) problems.push('At least one slab is required.');

  for (const slab of slabs) {
    if (new D(slab.thresholdValue as any).isNegative()) problems.push(`Slab threshold cannot be negative (slab ${slab.id}).`);
    if (new D(slab.rewardValue as any).isNegative()) problems.push(`Slab reward cannot be negative (slab ${slab.id}).`);
    const hasAltType = !!slab.altRewardType;
    const hasAltValue = slab.altRewardValue !== null && slab.altRewardValue !== undefined;
    if (hasAltType !== hasAltValue) problems.push(`Alternate reward needs both a type and a value (slab ${slab.id}).`);
  }

  if (slabMode === 'PROGRESSIVE') {
    const expected = measurementType === 'VALUE' ? 'PERCENTAGE' : 'FIXED_PER_UNIT';
    for (const slab of slabs) {
      if (slab.rewardType !== expected) {
        problems.push(`PROGRESSIVE mode on a ${measurementType} scheme requires ${expected} rewards (slab ${slab.id} is ${slab.rewardType}).`);
      }
      if (slab.altRewardType && slab.altRewardType !== expected) {
        problems.push(`PROGRESSIVE mode on a ${measurementType} scheme requires ${expected} alternate rewards (slab ${slab.id} is ${slab.altRewardType}).`);
      }
    }
    const withAlt = slabs.filter((s) => !!s.altRewardType).length;
    if (withAlt !== 0 && withAlt !== slabs.length) {
      problems.push('In PROGRESSIVE mode, alternate rewards must be set on every slab or on none.');
    }
  }
  return problems;
}

function bandAmount(sorted: SlabInput[], measurementType: MeasurementType, basis: Decimal, pick: (s: SlabInput) => Decimal): Decimal {
  let total = new D(0);
  for (let i = 0; i < sorted.length; i++) {
    const lower = new D(sorted[i].thresholdValue as any);
    const upper = i + 1 < sorted.length ? new D(sorted[i + 1].thresholdValue as any) : null;
    const top = upper && upper.lt(basis) ? upper : basis;
    const band = top.minus(lower);
    if (band.lte(0)) continue;
    const rate = pick(sorted[i]);
    total = total.plus(measurementType === 'VALUE' ? band.times(rate).dividedBy(100) : band.times(rate));
  }
  return total;
}

/**
 * Mode-aware scheme reward for a cumulative achievement.
 * `slab` is always the highest slab reached. In PROGRESSIVE mode the primaryRewardType/Value on the
 * result describe that top slab, while the amount is the sum over all bands.
 * Throws if the configuration is invalid for the mode (see validateSlabConfiguration).
 */
export function computeSchemeReward(
  slabs: SlabInput[],
  slabMode: SlabMode,
  measurementType: MeasurementType,
  eligibleValue: Decimal,
  eligibleQuantity: Decimal,
  rewardEligibleValue: Decimal = eligibleValue,
  rewardEligibleQuantity: Decimal = eligibleQuantity,
  baselineVolume?: Decimal | null,
  maximumIncentiveCap?: Decimal | null
): { slab: SlabInput | null; reward: RewardResult | null } {
  const problems = validateSlabConfiguration(slabs, slabMode, measurementType);
  if (problems.length) throw new Error(`Invalid slab configuration: ${problems.join(' ')}`);

  let effectiveEligibleValue = eligibleValue;
  let effectiveEligibleQuantity = eligibleQuantity;
  let effectiveRewardValue = rewardEligibleValue;
  let effectiveRewardQuantity = rewardEligibleQuantity;

  if (baselineVolume && baselineVolume.gt(0)) {
    if (measurementType === 'VALUE') {
      effectiveEligibleValue = D.max(0, eligibleValue.minus(baselineVolume));
      effectiveRewardValue = D.max(0, rewardEligibleValue.minus(baselineVolume));
    } else {
      effectiveEligibleQuantity = D.max(0, eligibleQuantity.minus(baselineVolume));
      effectiveRewardQuantity = D.max(0, rewardEligibleQuantity.minus(baselineVolume));
    }
  }

  const slab = selectSlab(slabs, measurementType, effectiveEligibleValue, effectiveEligibleQuantity);

  let primaryIncentiveAmount = new D(0);
  let altIncentiveAmount: Decimal | null = null;
  let primaryRewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT' | null = null;
  let primaryRewardValue: Decimal | null = null;
  let altRewardType: 'PERCENTAGE' | 'FIXED_PER_UNIT' | null = null;
  let altRewardValue: Decimal | null = null;

  if (slabMode === 'HIGHEST_SLAB_WINS') {
    const reward = computeReward(slab, effectiveRewardValue, effectiveRewardQuantity);
    if (reward) {
      primaryRewardType = reward.primaryRewardType;
      primaryRewardValue = reward.primaryRewardValue;
      primaryIncentiveAmount = reward.primaryIncentiveAmount;
      altRewardType = reward.altRewardType;
      altRewardValue = reward.altRewardValue;
      altIncentiveAmount = reward.altIncentiveAmount;
    }
  } else if (slab) {
    const sorted = sortByThreshold(slabs);
    const basis = measurementType === 'VALUE' ? effectiveEligibleValue : effectiveEligibleQuantity;
    primaryIncentiveAmount = bandAmount(sorted, measurementType, basis, (s) => new D(s.rewardValue as any));
    const hasAlt = sorted.every((s) => !!s.altRewardType);
    altIncentiveAmount = hasAlt ? bandAmount(sorted, measurementType, basis, (s) => new D(s.altRewardValue as any)) : null;
    
    primaryRewardType = slab.rewardType;
    primaryRewardValue = new D(slab.rewardValue as any);
    altRewardType = hasAlt ? slab.altRewardType! : null;
    altRewardValue = hasAlt ? new D(slab.altRewardValue as any) : null;
  }

  if (maximumIncentiveCap && maximumIncentiveCap.gt(0)) {
    const totalReward = primaryIncentiveAmount.plus(altIncentiveAmount ?? 0);
    if (totalReward.gt(maximumIncentiveCap)) {
      if (altIncentiveAmount !== null && totalReward.gt(0)) {
        const ratio = maximumIncentiveCap.dividedBy(totalReward);
        primaryIncentiveAmount = primaryIncentiveAmount.times(ratio);
        altIncentiveAmount = altIncentiveAmount.times(ratio);
      } else {
        primaryIncentiveAmount = maximumIncentiveCap;
      }
    }
  }

  if (!slab) return { slab: null, reward: null };

  return {
    slab,
    reward: {
      primaryRewardType: primaryRewardType!,
      primaryRewardValue: primaryRewardValue!,
      primaryIncentiveAmount,
      altRewardType,
      altRewardValue,
      altIncentiveAmount,
    },
  };
}

export interface InvoiceAchievement {
  key: string;
  eligibleValue: Decimal;
  eligibleQuantity: Decimal;
  rewardEligibleValue?: Decimal;
  rewardEligibleQuantity?: Decimal;
}

/**
 * Splits a scheme's incentive across invoices so the per-invoice amounts add up to the scheme total.
 * - HIGHEST_SLAB_WINS: the reward is linear, so each invoice is rewarded at the scheme's slab.
 * - PROGRESSIVE: invoices are taken in the order given (callers pass date, then invoice number) and
 *   each gets the marginal increase in the scheme incentive it caused (incentive after minus
 *   incentive before). This telescopes exactly to the scheme total.
 */
export function allocateInvoiceRewards(
  invoicesInOrder: InvoiceAchievement[],
  slabs: SlabInput[],
  slabMode: SlabMode,
  measurementType: MeasurementType,
  baselineVolume?: Decimal | null,
  maximumIncentiveCap?: Decimal | null
): Map<string, { primary: Decimal; alt: Decimal | null }> {
  const result = new Map<string, { primary: Decimal; alt: Decimal | null }>();
  const totalValue = invoicesInOrder.reduce((s, i) => s.plus(i.eligibleValue), new D(0));
  const totalQty = invoicesInOrder.reduce((s, i) => s.plus(i.eligibleQuantity), new D(0));

  if (slabMode === 'HIGHEST_SLAB_WINS') {
    const { slab } = computeSchemeReward(slabs, slabMode, measurementType, totalValue, totalQty, undefined, undefined, baselineVolume, maximumIncentiveCap);
    let cumPrimaryAllocated = new D(0);
    let cumAltAllocated = new D(0);
    
    for (const inv of invoicesInOrder) {
      const reward = computeReward(slab, inv.rewardEligibleValue ?? inv.eligibleValue, inv.rewardEligibleQuantity ?? inv.eligibleQuantity);
      let invPrimary = reward?.primaryIncentiveAmount ?? new D(0);
      let invAlt = reward?.altIncentiveAmount ?? null;

      if (maximumIncentiveCap && maximumIncentiveCap.gt(0)) {
        if (cumPrimaryAllocated.plus(invPrimary).gt(maximumIncentiveCap)) {
          invPrimary = D.max(0, maximumIncentiveCap.minus(cumPrimaryAllocated));
        }
        cumPrimaryAllocated = cumPrimaryAllocated.plus(invPrimary);
        // Note: For simplicity if capping is hit in HIGHEST_SLAB_WINS, we truncate per-invoice linearly until exhausted.
      }

      result.set(inv.key, { primary: invPrimary, alt: invAlt });
    }
    return result;
  }

  let cumValue = new D(0);
  let cumQty = new D(0);
  let prevPrimary = new D(0);
  let prevAlt = new D(0);
  for (const inv of invoicesInOrder) {
    cumValue = cumValue.plus(inv.eligibleValue);
    cumQty = cumQty.plus(inv.eligibleQuantity);
    const { reward } = computeSchemeReward(slabs, slabMode, measurementType, cumValue, cumQty, undefined, undefined, baselineVolume, maximumIncentiveCap);
    const primary = reward?.primaryIncentiveAmount ?? new D(0);
    const alt = reward?.altIncentiveAmount ?? null;
    result.set(inv.key, { primary: primary.minus(prevPrimary), alt: alt ? alt.minus(prevAlt) : null });
    prevPrimary = primary;
    if (alt) prevAlt = alt;
  }
  return result;
}

export interface SlabProgress {
  achievedBasis: Decimal;
  currentSlab: SlabInput | null;
  nextSlab: SlabInput | null;
  remainingToNext: Decimal | null;
  progressToNextPercent: Decimal | null;
}

/** Where a cumulative achievement stands on the slab ladder: current slab, next slab, and the gap to it. */
export function computeSlabProgress(
  slabs: SlabInput[],
  measurementType: MeasurementType,
  eligibleValue: Decimal,
  eligibleQuantity: Decimal
): SlabProgress {
  const achievedBasis = measurementType === 'VALUE' ? eligibleValue : eligibleQuantity;
  const sorted = sortByThreshold(slabs);
  const currentSlab = selectSlab(slabs, measurementType, eligibleValue, eligibleQuantity);
  const nextSlab = sorted.find((s) => new D(s.thresholdValue as any).gt(achievedBasis)) ?? null;
  if (!nextSlab) return { achievedBasis, currentSlab, nextSlab: null, remainingToNext: null, progressToNextPercent: null };
  const nextThreshold = new D(nextSlab.thresholdValue as any);
  return {
    achievedBasis,
    currentSlab,
    nextSlab,
    remainingToNext: nextThreshold.minus(achievedBasis),
    progressToNextPercent: nextThreshold.isZero() ? null : achievedBasis.dividedBy(nextThreshold).times(100),
  };
}
