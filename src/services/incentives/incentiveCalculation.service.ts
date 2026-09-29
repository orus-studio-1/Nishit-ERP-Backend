// Incentive scheme calculation service — Phase 2 (calculation service only;
// no routes/controllers/UI, per the approved Phase 2 scope).
//
// Pure business logic (eligibility, aggregation, slab selection, reward math)
// lives in ./incentiveCalculation.ts and is unit-tested without a database;
// this file only wires that logic to real data and handles transactions,
// advisory locking, and calculation-run lifecycle.
//
// RECALCULATION SCOPE (requirement 5): every call to runIncentiveCalculation
// re-evaluates the scheme's ENTIRE period from scratch — every PurchaseInvoice
// against evaluateInvoiceEligibility(), not just invoices added/changed since
// the last run. There is no incremental/partial-period recalculation in V1.
// This is deliberate: the slab thresholds are cumulative over the whole scheme
// period, so a partial recalculation could not correctly redetermine which
// slab applies without re-summing the full period anyway. Nothing in the
// existing codebase's conventions requires a different (e.g. date-windowed)
// scope, so "full scheme period, every time" is the V1 default.
//
// Amounts: PurchaseInvoiceItem.total is NOT used. The ERP stores it as net PLUS GST, and `discount` is a
// percentage. Each line's amount is quantity x unit price (pre-tax, before discount, the confirmed rule),
// or after discount when the scheme's amountBasis says so. See linePreTaxAmount().
//
// Supplier: an invoice counts only if its supplier is one of the scheme's eligible suppliers (or the
// scheme allows any supplier), in addition to the product manufacturer matching.
//
// STILL OUT OF SCOPE for this phase (unchanged from the POC — see
// docs/incentive-tracking-poc.md):
// - No automatic hook into submitPurchaseInvoice/cancelVoucher. Cancellation
//   reversal is triggered explicitly via reverseContributionForInvoice() —
//   a caller (script, future controller, or invoice-lifecycle hook) must
//   invoke it when an invoice is cancelled.
// - No settlement/credit-note processing.
// - Booking channel is informational only (no automated eMitra eligibility check).
// - No returns/PurchaseReturn handling.

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  aggregateAchievement,
  evaluateInvoiceEligibility,
  linePreTaxAmount,
  normalizeManufacturer,
  type EligibilityInvoiceInput,
  type EvaluatedInvoice,
} from './incentiveCalculation';
import { allocateInvoiceRewards, computeSchemeReward, validateSlabConfiguration } from './incentiveSlabModes';

const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Strip anything that looks like a connection string / credential and cap length before persisting to IncentiveCalculationRun.errorMessage. */
function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const redacted = raw
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-connection-string]')
    .replace(/(password|token|secret|apikey|api_key)\s*[=:]\s*[^\s&"']+/gi, '$1=[redacted]');
  return redacted.length > MAX_ERROR_MESSAGE_LENGTH ? redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '…' : redacted;
}

export interface CalculationSummary {
  runId: string;
  schemeId: string;
  eligibleValue: string;
  eligibleQuantity: string;
  rewardEligibleValue: string;
  rewardEligibleQuantity: string;
  selectedSlabId: string | null;
  selectedSlabThreshold: string | null;
  primaryRewardType: string | null;
  primaryRewardValue: string | null;
  primaryIncentiveAmount: string | null;
  altRewardType: string | null;
  altRewardValue: string | null;
  altIncentiveAmount: string | null;
  invoicesConsidered: number;
  invoicesEligible: number;
  invoicesExcluded: Array<{ invoiceNo: string; reason: string }>;
  contributionsCreated: number;
  contributionsSuperseded: number;
  perInvoiceDetail: EvaluatedInvoice[];
}

/**
 * Run (or re-run) incentive calculation for a scheme.
 *
 * Transaction design (per V1 design approval, corrected per review):
 *  1. The RUNNING run row is created and committed in its own transaction
 *     BEFORE calculation starts, so it survives even if calculation fails.
 *  2. All eligibility evaluation + contribution writes happen inside ONE
 *     transaction, guarded by a scheme-scoped advisory lock (serializes
 *     concurrent recalculations of the SAME scheme; different schemes can
 *     calculate concurrently without blocking each other).
 *  3. On success, that same transaction also flips the run to COMPLETED —
 *     atomic with the contribution writes.
 *  4. On failure, the transaction rolls back entirely (no partial
 *     contributions), and a SEPARATE transaction (the run row already
 *     exists from step 1) updates it to FAILED with a sanitized error
 *     message.
 *
 * Concurrency notes (see docs/incentive-tracking-poc.md section on failure handling):
 *  - Two simultaneous calculations for the SAME scheme: the advisory lock
 *    serializes them at the DB level; the second waits for the first's
 *    transaction to commit/rollback, then proceeds against the now-current
 *    ACTIVE rows. Neither can observe the other's half-written state.
 *  - Two calculations for DIFFERENT schemes: run fully in parallel, no
 *    shared lock key.
 *  - If application logic ever raced despite the lock, the partial unique
 *    index `IncentiveContribution_active_scheme_invoice_unique` is the DB-level
 *    backstop — a duplicate ACTIVE (schemeId, purchaseInvoiceId) insert is
 *    rejected, the transaction rolls back, and the run is marked FAILED.
 *  - A stale RUNNING run from a crashed process is NOT auto-detected or
 *    cleaned up by this function — it is a known limitation, not silently
 *    papered over. It has no effect on new runs (no gating on "is another
 *    run RUNNING"), but a human should notice a RUNNING run that never
 *    completes.
 */
export async function runIncentiveCalculation(
  schemeId: string,
  options: { reason: 'INITIAL' | 'INVOICE_SUBMITTED' | 'INVOICE_CANCELLED' | 'MANUAL_RECALC'; triggeredBy?: string }
): Promise<CalculationSummary> {
  const scheme = await prisma.incentiveScheme.findUnique({ where: { id: schemeId }, include: { slabs: true } });
  if (!scheme) throw new Error(`IncentiveScheme not found: ${schemeId}`);
  if (scheme.status !== 'ACTIVE') {
    throw new Error(`Cannot calculate scheme ${schemeId}: status is ${scheme.status}, expected ACTIVE`);
  }
  if (scheme.startDate > scheme.endDate) {
    throw new Error(`Cannot calculate scheme ${schemeId}: startDate is after endDate`);
  }
  const slabProblems = validateSlabConfiguration(scheme.slabs as any, scheme.slabMode, scheme.measurementType);
  if (slabProblems.length) {
    throw new Error(`Cannot calculate scheme ${schemeId}: ${slabProblems.join(' ')}`);
  }
  if (!scheme.allowAnySupplier && scheme.eligibleSupplierIds.length === 0) {
    throw new Error(`Cannot calculate scheme ${schemeId}: choose the eligible supplier(s) or allow any supplier`);
  }
  if (scheme.slabMode === 'PROGRESSIVE' && scheme.rewardExcludedProductIds.length > 0) {
    throw new Error(`Cannot calculate scheme ${schemeId}: reward-excluded products are not supported with PROGRESSIVE slabs`);
  }

  // Step 1: RUNNING run row, committed on its own before calculation starts.
  const run = await prisma.incentiveCalculationRun.create({
    data: { schemeId, status: 'RUNNING', reason: options.reason, triggeredBy: options.triggeredBy },
  });

  try {
    const summary = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `incentive-scheme:${schemeId}`);

      // Deliberately NOT pre-filtered by workflowStatus/date/tradeType at the
      // query level: every invoice (in this tenant's scope) is fetched and run
      // through evaluateInvoiceEligibility() so the calculation summary can
      // report an exact exclusion reason for every candidate, not just the
      // ones that happened to already pass. At POC data volumes this is cheap;
      // a production version would push status/date filtering into the query
      // for the "considered" set once the reporting requirement is relaxed.
      const candidateInvoices = await tx.purchaseInvoice.findMany({
        include: { 
          items: { include: { product: true } },
          purchaseReceipt: true
        },
      });
      
      const invoiceIds = candidateInvoices.map((i: any) => i.id);
      const payments = await tx.supplierPayment.groupBy({
        by: ['purchaseInvoiceId'],
        where: { purchaseInvoiceId: { in: invoiceIds }, status: 'SUBMITTED' },
        _max: { date: true },
      });
      const paymentDates = new Map(payments.filter((p: any) => p.purchaseInvoiceId).map((p: any) => [p.purchaseInvoiceId, p._max.date]));

      const manufacturerKey = normalizeManufacturer(scheme.manufacturerKey);
      const evaluated: EvaluatedInvoice[] = candidateInvoices.map((invoice: any) => {
        const input: EligibilityInvoiceInput = {
          purchaseInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          date: invoice.date,
          grnDate: invoice.purchaseReceipt?.postingDate ?? null,
          fullyPaidAt: Number(invoice.outstandingAmount) === 0 ? (paymentDates.get(invoice.id) ?? invoice.date) : null,
          workflowStatus: invoice.workflowStatus,
          supplierId: invoice.supplierId,
          tradeType: invoice.tradeType,
          branchId: invoice.branchId ?? invoice.costCenter?.branchId ?? null,
          items: invoice.items.map((item: any) => ({
            purchaseInvoiceItemId: item.id,
            productId: item.productId,
            categoryId: item.product?.categoryId ?? null,
            productName: item.product?.name,
            manufacturer: item.product?.manufacturer ?? null,
            quantity: item.quantity,
            amount: linePreTaxAmount({ quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discount }, scheme.amountBasis),
            tradeType: item.tradeType ?? null,
          })),
        };
        return evaluateInvoiceEligibility(input, {
          manufacturerKey,
          startDate: scheme.startDate,
          endDate: scheme.endDate,
          eligibleTradeTypes: scheme.eligibleTradeTypes,
          allowAnyTradeType: scheme.allowAnyTradeType,
          eligibleSupplierIds: scheme.eligibleSupplierIds,
          allowAnySupplier: scheme.allowAnySupplier,
          rewardExcludedProductIds: scheme.rewardExcludedProductIds,
          includedProductIds: scheme.includedProductIds,
          includedCategoryIds: scheme.includedCategoryIds,
          returnHandling: scheme.returnHandling as any,
          paymentConditionDays: scheme.paymentConditionDays,
          minInvoiceValue: scheme.minInvoiceValue ? new Prisma.Decimal(scheme.minInvoiceValue as any) : null,
          maximumIncentiveCap: scheme.maximumIncentiveCap ? new Prisma.Decimal(scheme.maximumIncentiveCap as any) : null,
          baselineVolume: scheme.baselineVolume ? new Prisma.Decimal(scheme.baselineVolume as any) : null,
          eligibilityDateBasis: scheme.eligibilityDateBasis as any,
          autoCalculate: scheme.autoCalculate as any,
          eligibleBranchIds: scheme.eligibleBranchIds,
          allowAnyBranch: scheme.allowAnyBranch,
        });
      });

      const { eligibleValue, eligibleQuantity, rewardEligibleValue, rewardEligibleQuantity, perInvoice } = aggregateAchievement(evaluated);
      // Slab mode is a per-scheme setting (HIGHEST_SLAB_WINS is the confirmed default). The slab is chosen on
      // the slab amount; the reward is paid on the reward amount (slab amount minus reward-excluded products).
      const { slab, reward: schemeReward } = computeSchemeReward(
        scheme.slabs as any,
        scheme.slabMode,
        scheme.measurementType,
        eligibleValue,
        eligibleQuantity,
        rewardEligibleValue,
        rewardEligibleQuantity,
        scheme.baselineVolume ? new Prisma.Decimal(scheme.baselineVolume as any) : null,
        scheme.maximumIncentiveCap ? new Prisma.Decimal(scheme.maximumIncentiveCap as any) : null
      );
      // Invoices are ordered by date then invoice number so PROGRESSIVE mode's marginal
      // allocation is deterministic; HIGHEST_SLAB_WINS is order independent.
      const contributingInvoices = perInvoice
        .filter((inv) => inv.lines.some((l) => l.eligible))
        .sort((a, b) => a.date.getTime() - b.date.getTime() || a.invoiceNo.localeCompare(b.invoiceNo));
      const allocations = allocateInvoiceRewards(
        contributingInvoices.map((inv) => ({ key: inv.purchaseInvoiceId, eligibleValue: inv.eligibleValue, eligibleQuantity: inv.eligibleQuantity, rewardEligibleValue: inv.rewardEligibleValue, rewardEligibleQuantity: inv.rewardEligibleQuantity })),
        scheme.slabs as any,
        scheme.slabMode,
        scheme.measurementType,
        scheme.baselineVolume ? new Prisma.Decimal(scheme.baselineVolume as any) : null,
        scheme.maximumIncentiveCap ? new Prisma.Decimal(scheme.maximumIncentiveCap as any) : null
      );

      // Supersede every currently-ACTIVE contribution for this scheme — the
      // partial unique index guarantees there is at most one per invoice, so
      // this is a plain "flip status" pass, not a search-then-decide dance.
      const existingActive = await tx.incentiveContribution.findMany({
        where: { schemeId, lifecycleStatus: 'ACTIVE' },
      });
      let contributionsSuperseded = 0;
      const priorByInvoice = new Map<string, any>();
      for (const prior of existingActive) {
        priorByInvoice.set(prior.purchaseInvoiceId, prior);
        await tx.incentiveContribution.update({
          where: { id: prior.id },
          data: { lifecycleStatus: 'SUPERSEDED', supersededAt: new Date() },
        });
        contributionsSuperseded += 1;
      }

      let contributionsCreated = 0;
      for (const invEval of contributingInvoices) {
        const eligibleLines = invEval.lines.filter((l) => l.eligible);
        const invoiceReward = allocations.get(invEval.purchaseInvoiceId);
        const prior = priorByInvoice.get(invEval.purchaseInvoiceId);

        const contribution = await tx.incentiveContribution.create({
          data: {
            schemeId,
            purchaseInvoiceId: invEval.purchaseInvoiceId,
            runId: run.id,
            slabId: slab?.id ?? null,
            eligibleValue: invEval.eligibleValue.toFixed(6),
            eligibleQuantity: invEval.eligibleQuantity.toFixed(6),
            rewardEligibleValue: invEval.rewardEligibleValue.toFixed(6),
            rewardEligibleQuantity: invEval.rewardEligibleQuantity.toFixed(6),
            incentiveAmount: (invoiceReward?.primary ?? 0).toString(),
            altIncentiveAmount: invoiceReward?.alt ? invoiceReward.alt.toString() : null,
            lifecycleStatus: 'ACTIVE',
            supersedesId: prior ? prior.id : null,
          },
        });
        contributionsCreated += 1;

        for (const line of eligibleLines) {
          await tx.incentiveContributionItem.create({
            data: {
              contributionId: contribution.id,
              purchaseInvoiceItemId: line.purchaseInvoiceItemId,
              productId: line.productId,
              quantity: line.quantity.toFixed(6),
              eligibleValue: line.amount.toFixed(6),
              countForReward: line.rewardEligible,
            },
          });
        }
      }

      await tx.incentiveCalculationRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      const result: CalculationSummary = {
        runId: run.id,
        schemeId,
        eligibleValue: eligibleValue.toFixed(2),
        eligibleQuantity: eligibleQuantity.toFixed(2),
        rewardEligibleValue: rewardEligibleValue.toFixed(2),
        rewardEligibleQuantity: rewardEligibleQuantity.toFixed(2),
        selectedSlabId: slab?.id ?? null,
        selectedSlabThreshold: slab ? new Prisma.Decimal(slab.thresholdValue as any).toFixed(2) : null,
        primaryRewardType: schemeReward?.primaryRewardType ?? null,
        primaryRewardValue: schemeReward?.primaryRewardValue.toFixed(4) ?? null,
        primaryIncentiveAmount: schemeReward ? schemeReward.primaryIncentiveAmount.toFixed(2) : null,
        altRewardType: schemeReward?.altRewardType ?? null,
        altRewardValue: schemeReward?.altRewardValue ? schemeReward.altRewardValue.toFixed(4) : null,
        altIncentiveAmount: schemeReward?.altIncentiveAmount ? schemeReward.altIncentiveAmount.toFixed(2) : null,
        invoicesConsidered: evaluated.length,
        invoicesEligible: perInvoice.filter((i) => i.lines.some((l) => l.eligible)).length,
        invoicesExcluded: evaluated
          .filter((i) => !i.lines.some((l) => l.eligible))
          .map((i) => ({
            invoiceNo: i.invoiceNo,
            reason:
              i.invoiceExclusionReason ??
              i.lines.find((l) => l.exclusionReason)?.exclusionReason ??
              (i.lines.length ? 'NO_ELIGIBLE_LINES' : 'NO_LINES'),
          })),
        contributionsCreated,
        contributionsSuperseded,
        perInvoiceDetail: evaluated,
      };
      return result;
    });

    return summary;
  } catch (err) {
    // Step 4: separate transaction — the RUNNING row from step 1 was already
    // committed, so it can be updated to FAILED even though the calculation
    // transaction above rolled back in full.
    await prisma.incentiveCalculationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', completedAt: new Date(), errorMessage: safeErrorMessage(err) },
    });
    throw err;
  }
}

/**
 * Reverses the current ACTIVE contribution (if any) for a given
 * (schemeId, purchaseInvoiceId) pair, WITHOUT touching PurchaseInvoice
 * itself — the caller is responsible for the invoice's own workflowStatus
 * transition. This is invoked explicitly (by a script, a future controller,
 * or a future invoice-lifecycle hook) rather than automatically, since no
 * production hook into cancelVoucher()/submitPurchaseInvoice() exists yet
 * (requirement 17 excludes wiring that hook in this phase).
 */
export async function reverseContributionForInvoice(schemeId: string, purchaseInvoiceId: string) {
  return prisma.$transaction(async (tx: any) => {
    const active = await tx.incentiveContribution.findFirst({
      where: { schemeId, purchaseInvoiceId, lifecycleStatus: 'ACTIVE' },
    });
    if (!active) return null;
    return tx.incentiveContribution.update({
      where: { id: active.id },
      data: { lifecycleStatus: 'REVERSED', reversedAt: new Date() },
    });
  });
}
