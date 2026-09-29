// Repeatable Incentive Tracking POC runner.
//
// Run with:  npm run incentive:poc
// Cleanup only (no recreate): npm run incentive:poc -- --cleanup-only
//
// SAFETY MECHANISM (see docs/incentive-tracking-poc.md section H):
// This script NEVER touches any pre-existing tenant/company/product/supplier/
// invoice. It creates (or reuses, idempotently) its OWN dedicated Tenant +
// Company, identified by the fixed slugs below. Every record it creates
// (supplier, products, invoices, scheme) is additionally tagged with the
// POC_MARKER string in a code/name field. On each run, it first deletes only
// rows carrying that marker under its own company, then recreates them from
// scratch — so the script is safe to run repeatedly and never reaches outside
// its own sandboxed company.
//
// This script is DB-integration evidence, not a vitest unit test: it exercises
// real transactions, the real advisory lock, and the real partial unique index
// against the project's actual database, which this repo's existing test
// conventions (see src/services/tally/tallySync.test.ts) do not attempt —
// they mock Prisma entirely and never touch a live transaction. Pure
// calculation logic (eligibility/aggregation/slab/reward math) has its own
// deterministic vitest suite in incentiveCalculation.test.ts that runs with
// `npm test` and needs no database at all.

import prisma from '../../lib/prisma';
import { runWithTenant } from '../../utils/tenant';
import { createIncentiveScheme } from '../../services/incentives/incentiveScheme.service';
import { runIncentiveCalculation, reverseContributionForInvoice, type CalculationSummary } from '../../services/incentives/incentiveCalculation.service';

const POC_MARKER = 'POC-INCENTIVE-2026';
const TENANT_SLUG = 'poc-incentive-tenant';
const COMPANY_SLUG = 'poc-incentive-company';

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = String(actual) === String(expected);
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}: expected=${expected} actual=${actual}`);
  if (!pass) failures += 1;
}
function assertTrue(label: string, condition: boolean) {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}`);
  if (!condition) failures += 1;
}

async function ensurePocTenantAndCompany() {
  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: 'POC Incentive Tenant', slug: TENANT_SLUG } });
  }
  let company = await prisma.company.findUnique({ where: { slug: COMPANY_SLUG } });
  if (!company) {
    company = await prisma.company.create({ data: { tenantId: tenant.id, name: 'POC Incentive Company', slug: COMPANY_SLUG } });
  }
  return { tenantId: tenant.id, companyId: company.id };
}

/** Deletes only rows tagged with POC_MARKER under the POC company. Never touches other data. */
async function cleanupPocData(companyId: string) {
  const schemes = await prisma.incentiveScheme.findMany({ where: { companyId, code: { startsWith: POC_MARKER } } });
  for (const scheme of schemes) {
    await prisma.incentiveContributionItem.deleteMany({ where: { contribution: { schemeId: scheme.id } } });
    await prisma.incentiveContribution.deleteMany({ where: { schemeId: scheme.id } });
    await prisma.incentiveCalculationRun.deleteMany({ where: { schemeId: scheme.id } });
    await prisma.incentiveSlab.deleteMany({ where: { schemeId: scheme.id } });
    await prisma.incentiveScheme.delete({ where: { id: scheme.id } });
  }
  const invoices = await prisma.purchaseInvoice.findMany({ where: { companyId, invoiceNo: { startsWith: POC_MARKER } } });
  for (const inv of invoices) {
    await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: inv.id } });
    await prisma.purchaseInvoice.delete({ where: { id: inv.id } });
  }
  await prisma.product.deleteMany({ where: { companyId, sku: { startsWith: POC_MARKER } } });
  await prisma.supplier.deleteMany({ where: { companyId, supplierNo: { startsWith: POC_MARKER } } });
  console.log(`Cleanup complete: removed ${schemes.length} scheme(s), ${invoices.length} invoice(s), and their POC-tagged products/supplier.`);
}

function printEligibilityDetail(summary: CalculationSummary) {
  console.log('\n--- Per-invoice / per-line eligibility detail ---');
  for (const inv of summary.perInvoiceDetail) {
    console.log(`\nInvoice ${inv.invoiceNo} (id=${inv.purchaseInvoiceId})`);
    console.log(`  date=${inv.date.toISOString().slice(0, 10)} tradeType=${inv.tradeType ?? 'NULL'}`);
    console.log(`  invoiceLevelEligible=${inv.invoiceLevelEligible}${inv.invoiceExclusionReason ? ` reason=${inv.invoiceExclusionReason}` : ''}`);
    for (const line of inv.lines) {
      console.log(
        `    item=${line.purchaseInvoiceItemId} product=${line.productId} manufacturer="${line.manufacturerRaw}" (normalized="${line.manufacturerNormalized}") ` +
          `qty=${line.quantity} amount=${line.amount} eligible=${line.eligible}${line.exclusionReason ? ` reason=${line.exclusionReason}` : ''}`
      );
    }
    console.log(`  => invoice eligibleValue=${inv.eligibleValue} eligibleQuantity=${inv.eligibleQuantity}`);
  }
}

function printSummary(summary: CalculationSummary) {
  console.log('\n--- Calculation summary ---');
  console.log(`Run ID: ${summary.runId}`);
  console.log(`Invoices considered: ${summary.invoicesConsidered}, eligible: ${summary.invoicesEligible}`);
  console.log('Excluded invoices:', JSON.stringify(summary.invoicesExcluded, null, 2));
  console.log(`Total eligible value: ${summary.eligibleValue}`);
  console.log(`Total eligible quantity: ${summary.eligibleQuantity}`);
  console.log(`Selected slab: ${summary.selectedSlabId} (threshold=${summary.selectedSlabThreshold})`);
  console.log(`Primary reward: ${summary.primaryRewardType} @ ${summary.primaryRewardValue} => incentiveAmount=${summary.primaryIncentiveAmount}`);
  console.log(`Alt reward: ${summary.altRewardType ?? 'none'} @ ${summary.altRewardValue ?? '-'} => incentiveAmount=${summary.altIncentiveAmount ?? '-'}`);
  console.log(`Contributions created: ${summary.contributionsCreated}, superseded: ${summary.contributionsSuperseded}`);
}

async function main() {
  const cleanupOnly = process.argv.includes('--cleanup-only');
  const { tenantId, companyId } = await ensurePocTenantAndCompany();
  console.log(`Using POC tenant=${tenantId} company=${companyId} (dedicated sandbox, never touches other data)`);

  await runWithTenant({ tenantId, companyId }, async () => {
    console.log('\n=== Step 0: cleanup any data from a previous run ===');
    await cleanupPocData(companyId);
    if (cleanupOnly) {
      console.log('Cleanup-only mode: done.');
      return;
    }

    console.log('\n=== Step 1: create supplier + products ===');
    const supplier = await prisma.supplier.create({
      data: { supplierNo: `${POC_MARKER}-SUP-01`, name: 'POC Panasonic Distributor' },
    });

    const productAc = await prisma.product.create({
      data: { sku: `${POC_MARKER}-AC`, name: 'Panasonic AC (POC)', manufacturer: 'Panasonic', salePrice: 30000, costPrice: 30000 },
    });
    const productTv = await prisma.product.create({
      data: { sku: `${POC_MARKER}-TV`, name: 'Panasonic TV (POC)', manufacturer: 'Panasonic', salePrice: 40000, costPrice: 40000 },
    });
    const productSamsungTv = await prisma.product.create({
      data: { sku: `${POC_MARKER}-SAMSUNG-TV`, name: 'Samsung TV (POC)', manufacturer: 'Samsung', salePrice: 25000, costPrice: 25000 },
    });
    const productNullMfr = await prisma.product.create({
      data: { sku: `${POC_MARKER}-NULL-MFR`, name: 'Unbranded Cable (POC)', manufacturer: null, salePrice: 500, costPrice: 500 },
    });
    console.log(`Created products: ${productAc.name}, ${productTv.name}, ${productSamsungTv.name}, ${productNullMfr.name}`);

    console.log('\n=== Step 2: create incentive scheme + slabs ===');
    const scheme = (await createIncentiveScheme({
      manufacturerLabel: 'Panasonic',
      name: 'Panasonic FY2026 Trade Incentive (POC)',
      code: `${POC_MARKER}-PANASONIC-FY26`,
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T23:59:59.999Z'),
      measurementType: 'VALUE',
      eligibleTradeTypes: ['DISTRIBUTOR_SALE', 'SUPER_TRADE', 'SPECIAL_TRADE'],
      eligibleSupplierIds: [supplier.id],
      bookingChannel: 'eMitra', // informational only — see docs, no automated validation exists
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 0.1 },
        { thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 0.15 },
        { thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 0.25 },
      ],
    }))!;
    console.log(`Scheme created: ${scheme.id} (${scheme.code}), manufacturerKey="${scheme.manufacturerKey}"`);

    console.log('\n=== Step 3: create sample purchase invoices (Cases A-H) ===');

    async function makeInvoice(opts: {
      suffix: string;
      date: string;
      workflowStatus: 'DRAFT' | 'SUBMITTED' | 'CANCELLED';
      tradeType: 'DISTRIBUTOR_SALE' | 'SUPER_TRADE' | 'SPECIAL_TRADE' | 'PROJECT_NON_SPA' | 'PROJECT_SPA' | null;
      items: Array<{ productId: string; quantity: number; unitPrice: number; total: number }>;
    }) {
      return prisma.purchaseInvoice.create({
        data: {
          invoiceNo: `${POC_MARKER}-INV-${opts.suffix}`,
          supplierId: supplier.id,
          date: new Date(opts.date),
          workflowStatus: opts.workflowStatus,
          status: opts.workflowStatus === 'SUBMITTED' ? 'SENT' : opts.workflowStatus === 'CANCELLED' ? 'CANCELLED' : 'DRAFT',
          tradeType: opts.tradeType as any,
          subtotal: opts.items.reduce((s, i) => s + i.total, 0),
          total: opts.items.reduce((s, i) => s + i.total, 0),
          items: { create: opts.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })) },
        },
        include: { items: true },
      });
    }

    const invA = await makeInvoice({
      suffix: 'A',
      date: '2026-06-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [
        { productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 },
        { productId: productTv.id, quantity: 5, unitPrice: 40000, total: 200000 },
      ],
    });
    const invB = await makeInvoice({
      suffix: 'B',
      date: '2026-06-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [{ productId: productSamsungTv.id, quantity: 10, unitPrice: 25000, total: 250000 }],
    });
    const invC = await makeInvoice({
      suffix: 'C',
      date: '2026-06-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [
        { productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 },
        { productId: productSamsungTv.id, quantity: 10, unitPrice: 25000, total: 250000 },
      ],
    });
    const invD = await makeInvoice({
      suffix: 'D',
      date: '2026-06-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'PROJECT_NON_SPA',
      items: [{ productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 }],
    });
    const invE = await makeInvoice({
      suffix: 'E',
      date: '2025-01-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [{ productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 }],
    });
    const invF = await makeInvoice({
      suffix: 'F',
      date: '2026-06-01',
      workflowStatus: 'DRAFT',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [{ productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 }],
    });
    const invG = await makeInvoice({
      suffix: 'G',
      date: '2026-06-01',
      workflowStatus: 'SUBMITTED',
      tradeType: null,
      items: [{ productId: productAc.id, quantity: 10, unitPrice: 30000, total: 300000 }],
    });
    const invH = await makeInvoice({
      suffix: 'H',
      date: '2026-07-01',
      workflowStatus: 'SUBMITTED',
      tradeType: 'DISTRIBUTOR_SALE',
      items: [{ productId: productAc.id, quantity: 2, unitPrice: 30000, total: 60000 }],
    });
    console.log(`Created invoices: ${[invA, invB, invC, invD, invE, invF, invG, invH].map((i) => i.invoiceNo).join(', ')}`);

    console.log('\n=== Step 4: initial calculation ===');
    const initial = await runIncentiveCalculation(scheme.id, { reason: 'INITIAL', triggeredBy: 'poc-runner' });
    printEligibilityDetail(initial);
    printSummary(initial);

    console.log('\n=== Step 4 verification ===');
    // Manual expected total: A (500000) + C (300000, Panasonic line only) + H (60000) = 860000
    // B excluded (wrong manufacturer), D excluded (wrong trade type), E excluded (outside period),
    // F excluded (draft), G excluded (null tradeType).
    assertEqual('Case A included at full eligible value', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-A'))!.eligibleValue.toString(), '500000');
    assertEqual('Case B contributes zero (wrong manufacturer)', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-B'))!.eligibleValue.toString(), '0');
    assertEqual('Case C counts only Panasonic line, not full invoice', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-C'))!.eligibleValue.toString(), '300000');
    assertEqual('Case D excluded (wrong trade type)', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-D'))!.invoiceExclusionReason, 'TRADE_TYPE_NOT_ELIGIBLE');
    assertEqual('Case E excluded (outside scheme period)', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-E'))!.invoiceExclusionReason, 'OUTSIDE_SCHEME_PERIOD');
    assertEqual('Case F excluded (draft/not submitted)', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-F'))!.invoiceExclusionReason, 'NOT_SUBMITTED');
    assertEqual('Case G excluded (null tradeType)', initial.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-G'))!.invoiceExclusionReason, 'TRADE_TYPE_NULL');
    assertEqual('Total eligible value = 500000 + 300000 + 60000 = 860000', initial.eligibleValue, '860000.00');
    assertEqual('Selected slab is the ₹500,000 / 0.15% slab (860000 has crossed it but not ₹1,000,000)', initial.selectedSlabThreshold, '500000.00');
    assertEqual('Primary incentive amount = 860000 × 0.15% = 1290.00', initial.primaryIncentiveAmount, '1290.00');
    assertEqual('Contributions created = 3 (A, C, H — invoices with at least one eligible line)', initial.contributionsCreated, 3);
    assertEqual('Contributions superseded on first run = 0', initial.contributionsSuperseded, 0);

    const contributionsAfterInitial = await prisma.incentiveContribution.findMany({ where: { schemeId: scheme.id } });
    assertEqual('Exactly 3 ACTIVE contributions exist after initial run', contributionsAfterInitial.filter((c) => c.lifecycleStatus === 'ACTIVE').length, 3);

    console.log('\n=== Step 5: recalculation (no data changes) ===');
    const recalc = await runIncentiveCalculation(scheme.id, { reason: 'MANUAL_RECALC', triggeredBy: 'poc-runner' });
    printSummary(recalc);
    assertEqual('Recalculation supersedes exactly the 3 prior ACTIVE contributions', recalc.contributionsSuperseded, 3);
    assertEqual('Recalculation creates 3 new ACTIVE contributions', recalc.contributionsCreated, 3);

    const afterRecalc = await prisma.incentiveContribution.findMany({ where: { schemeId: scheme.id } });
    assertEqual('Old contributions are SUPERSEDED, not deleted', afterRecalc.filter((c) => c.lifecycleStatus === 'SUPERSEDED').length, 3);
    assertEqual('Exactly 3 ACTIVE contributions after recalculation (no duplicates)', afterRecalc.filter((c) => c.lifecycleStatus === 'ACTIVE').length, 3);
    assertEqual('Total contribution rows = 6 (3 superseded + 3 active), none deleted', afterRecalc.length, 6);
    const newActiveForA = afterRecalc.find((c) => c.purchaseInvoiceId === invA.id && c.lifecycleStatus === 'ACTIVE');
    assertTrue('New ACTIVE contribution for invoice A references its superseded predecessor via supersedesId', !!newActiveForA?.supersedesId);

    console.log('\n=== Step 6: cancellation / reversal (invoice H) ===');
    console.log('Simulating cancellation (no production cancelVoucher hook exists for this yet — see docs, section J):');
    await prisma.purchaseInvoice.update({ where: { id: invH.id }, data: { workflowStatus: 'CANCELLED', status: 'CANCELLED', cancelledAt: new Date() } });
    const reversed = await reverseContributionForInvoice(scheme.id, invH.id);
    assertTrue('Contribution for cancelled invoice H is now REVERSED', reversed?.lifecycleStatus === 'REVERSED');
    assertTrue('reversedAt timestamp was set', !!reversed?.reversedAt);

    console.log('\n=== Step 7: recalculation after cancellation ===');
    const afterCancelRecalc = await runIncentiveCalculation(scheme.id, { reason: 'INVOICE_CANCELLED', triggeredBy: 'poc-runner' });
    printSummary(afterCancelRecalc);
    // H is now workflowStatus=CANCELLED, so it is naturally excluded (NOT_SUBMITTED) and gets no new ACTIVE row.
    assertEqual('Invoice H excluded from recalculation after cancellation', afterCancelRecalc.perInvoiceDetail.find((i) => i.invoiceNo.endsWith('-INV-H'))!.invoiceExclusionReason, 'NOT_SUBMITTED');
    assertEqual('Only A and C now contribute -> total eligible value = 800000', afterCancelRecalc.eligibleValue, '800000.00');
    assertEqual('Contributions created this run = 2 (A, C only; H has no eligible lines anymore)', afterCancelRecalc.contributionsCreated, 2);
    // The run's supersede pass only supersedes currently-ACTIVE rows (A and C's from step 5); H's is
    // already REVERSED from step 6 and must NOT be touched again.
    assertEqual('Contributions superseded this run = 2 (A, C — H was already REVERSED, untouched)', afterCancelRecalc.contributionsSuperseded, 2);
    const hContributionAfter = await prisma.incentiveContribution.findFirst({ where: { schemeId: scheme.id, purchaseInvoiceId: invH.id, lifecycleStatus: 'REVERSED' } });
    assertTrue('Invoice H contribution remains REVERSED (untouched by the subsequent recalculation)', !!hContributionAfter);

    console.log('\n=== Step 8: duplicate-ACTIVE / partial-unique-index safety check ===');
    const activeNow = await prisma.incentiveContribution.findMany({ where: { schemeId: scheme.id, lifecycleStatus: 'ACTIVE' } });
    const pairs = activeNow.map((c) => `${c.schemeId}:${c.purchaseInvoiceId}`);
    assertEqual('No duplicate ACTIVE (schemeId, purchaseInvoiceId) pairs exist', new Set(pairs).size, pairs.length);

    console.log('\n=== Step 9: concurrent recalculation safety (advisory lock) ===');
    const [concA, concB] = await Promise.all([
      runIncentiveCalculation(scheme.id, { reason: 'MANUAL_RECALC', triggeredBy: 'poc-runner-concurrent-1' }),
      runIncentiveCalculation(scheme.id, { reason: 'MANUAL_RECALC', triggeredBy: 'poc-runner-concurrent-2' }),
    ]);
    console.log(`Concurrent run 1 -> runId=${concA.runId}, contributionsCreated=${concA.contributionsCreated}`);
    console.log(`Concurrent run 2 -> runId=${concB.runId}, contributionsCreated=${concB.contributionsCreated}`);
    const activeAfterConcurrent = await prisma.incentiveContribution.findMany({ where: { schemeId: scheme.id, lifecycleStatus: 'ACTIVE' } });
    const pairsAfterConcurrent = activeAfterConcurrent.map((c) => `${c.schemeId}:${c.purchaseInvoiceId}`);
    assertEqual(
      'After two concurrent recalculations, still exactly 2 ACTIVE contributions, no duplicates (advisory lock serialized them)',
      new Set(pairsAfterConcurrent).size === pairsAfterConcurrent.length ? pairsAfterConcurrent.length : 'DUPLICATE_DETECTED',
      2
    );

    console.log('\n=== Step 10: failed-run persistence demonstration ===');
    console.log('(Demonstrates the commit-RUNNING-first / separate-FAILED-update pattern used inside runIncentiveCalculation,');
    console.log(' since deterministically forcing a real mid-transaction DB error requires fault injection not worth adding to production code.)');
    const demoRun = await prisma.incentiveCalculationRun.create({ data: { schemeId: scheme.id, status: 'RUNNING', reason: 'MANUAL_RECALC', triggeredBy: 'poc-failure-demo' } });
    try {
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `incentive-scheme:${scheme.id}`);
        throw new Error('Simulated calculation failure for POC demonstration — password=should-never-appear-in-output secret_token=abc123');
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const redacted = raw.replace(/(password|token|secret|apikey|api_key)\s*[=:]\s*[^\s&"']+/gi, '$1=[redacted]');
      await prisma.incentiveCalculationRun.update({ where: { id: demoRun.id }, data: { status: 'FAILED', completedAt: new Date(), errorMessage: redacted } });
    }
    const failedRun = await prisma.incentiveCalculationRun.findUnique({ where: { id: demoRun.id } });
    assertTrue('Failed run is persisted with status=FAILED (not lost)', failedRun?.status === 'FAILED');
    assertTrue('errorMessage was stored', !!failedRun?.errorMessage);
    assertTrue('errorMessage does not contain the literal secret value', !failedRun?.errorMessage?.includes('should-never-appear-in-output'));
    console.log(`  Stored errorMessage: "${failedRun?.errorMessage}"`);

    console.log('\n=== Final database state ===');
    const finalContributions = await prisma.incentiveContribution.findMany({
      where: { schemeId: scheme.id },
      orderBy: { calculatedAt: 'asc' },
      include: { lines: true },
    });
    for (const c of finalContributions) {
      console.log(
        `Contribution ${c.id} invoice=${c.purchaseInvoiceId} status=${c.lifecycleStatus} eligibleValue=${c.eligibleValue} ` +
          `incentiveAmount=${c.incentiveAmount} lines=${c.lines.length} supersedes=${c.supersedesId ?? '-'}`
      );
    }
    const finalRuns = await prisma.incentiveCalculationRun.findMany({ where: { schemeId: scheme.id }, orderBy: { startedAt: 'asc' } });
    for (const r of finalRuns) {
      console.log(`Run ${r.id} reason=${r.reason} status=${r.status} triggeredBy=${r.triggeredBy}${r.errorMessage ? ` error="${r.errorMessage}"` : ''}`);
    }

    console.log(`\n=== POC RESULT: ${failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} ASSERTION(S) FAILED`} ===`);
    if (failures > 0) process.exitCode = 1;
  });
}

main()
  .catch((err) => {
    console.error('POC runner crashed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
