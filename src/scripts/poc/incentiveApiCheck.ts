// End-to-end check of the incentive API (routes, permission checks, controller, services)
// against the real database, using the same sandbox company idea as incentiveTrackingPoc.ts.
//
// Run with: npm run incentive:api-check     (cleanup only: npm run incentive:api-check -- --cleanup-only)
//
// Only authentication is stubbed: a header picks a test role and the request runs inside the
// sandbox company's tenant context. The real router, requirePermission checks, controller,
// services and Prisma tenant proxy are all exercised. Everything created carries the marker
// below and lives under dedicated sandbox companies; cleanup deletes only marker-tagged rows.

import express from 'express';
import request from 'supertest';
import prisma from '../../lib/prisma';
import { runWithTenant } from '../../utils/tenant';
import { createIncentiveRouter } from '../../routes/incentives.routes';

const MARKER = 'POC-INCENTIVE-API-2026';
const TENANT_SLUG = 'poc-incentive-tenant';
const COMPANY_SLUG = 'poc-incentive-company';
const OTHER_COMPANY_SLUG = 'poc-incentive-other-company';

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const pass = String(actual) === String(expected);
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}: expected=${expected} actual=${actual}`);
  if (!pass) failures += 1;
}
function checkTrue(label: string, condition: boolean) {
  checks += 1;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}`);
  if (!condition) failures += 1;
}

const ROLES: Record<string, string[]> = {
  admin: ['incentives:schemes:manage', 'incentives:calculations:manage', 'incentives:contributions:manage', 'incentives:invoices:manage'],
  reader: ['incentives:schemes:read', 'incentives:contributions:read', 'incentives:calculations:read'],
  none: [],
};

async function ensureSandbox() {
  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) tenant = await prisma.tenant.create({ data: { name: 'POC Incentive Tenant', slug: TENANT_SLUG } });
  const ensureCompany = async (slug: string, name: string) =>
    (await prisma.company.findUnique({ where: { slug } })) ?? prisma.company.create({ data: { tenantId: tenant!.id, name, slug } });
  const company = await ensureCompany(COMPANY_SLUG, 'POC Incentive Company');
  const other = await ensureCompany(OTHER_COMPANY_SLUG, 'POC Incentive Other Company');
  return { tenantId: tenant.id, companyId: company.id, otherCompanyId: other.id };
}

async function cleanup(companyId: string) {
  await runWithTenant({ companyId }, async () => {
    const schemes = await prisma.incentiveScheme.findMany({ where: { code: { startsWith: MARKER } } });
    for (const scheme of schemes) {
      await prisma.incentiveContributionItem.deleteMany({ where: { contribution: { schemeId: scheme.id } } });
      await prisma.incentiveContribution.deleteMany({ where: { schemeId: scheme.id } });
      await prisma.incentiveCalculationRun.deleteMany({ where: { schemeId: scheme.id } });
      await prisma.incentiveSlab.deleteMany({ where: { schemeId: scheme.id } });
      await prisma.incentiveScheme.delete({ where: { id: scheme.id } });
    }
    const invoices = await prisma.purchaseInvoice.findMany({ where: { invoiceNo: { startsWith: MARKER } } });
    for (const inv of invoices) {
      await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: inv.id } });
      await prisma.purchaseInvoice.delete({ where: { id: inv.id } });
    }
    await prisma.product.deleteMany({ where: { sku: { startsWith: MARKER } } });
    await prisma.supplier.deleteMany({ where: { supplierNo: { startsWith: MARKER } } });
    console.log(`Cleanup complete: removed ${schemes.length} scheme(s) and ${invoices.length} invoice(s).`);
  });
}

async function main() {
  const { tenantId, companyId, otherCompanyId } = await ensureSandbox();
  console.log(`Sandbox tenant=${tenantId} company=${companyId} otherCompany=${otherCompanyId}`);
  await cleanup(companyId);
  if (process.argv.includes('--cleanup-only')) return;

  // Seed purchase data directly (invoice entry is not part of the incentive API).
  const seed = await runWithTenant({ tenantId, companyId }, async () => {
    const supplier = await prisma.supplier.create({ data: { supplierNo: `${MARKER}-SUP`, name: 'API Check Supplier' } });
    const mk = (suffix: string, manufacturer: string, price: number) =>
      prisma.product.create({ data: { sku: `${MARKER}-${suffix}`, name: `${manufacturer} ${suffix}`, manufacturer, salePrice: price, costPrice: price } });
    const ac = await mk('AC', 'Panasonic', 30000);
    const tv = await mk('TV', 'Panasonic', 40000);
    const samsung = await mk('SAMSUNG', 'Samsung', 25000);
    const inv = (suffix: string, date: string, tradeType: any, items: Array<{ p: string; q: number; t: number }>) =>
      prisma.purchaseInvoice.create({
        data: {
          invoiceNo: `${MARKER}-${suffix}`,
          supplierId: supplier.id,
          date: new Date(date),
          workflowStatus: 'SUBMITTED',
          status: 'SENT',
          tradeType,
          subtotal: items.reduce((s, i) => s + i.t, 0),
          total: items.reduce((s, i) => s + i.t, 0),
          items: { create: items.map((i) => ({ productId: i.p, quantity: i.q, unitPrice: i.t / i.q, total: i.t })) },
        },
      });
    // Dates are distinct so PROGRESSIVE allocation order (date, then invoice number) is deterministic.
    await inv('A', '2026-06-01', 'DISTRIBUTOR_SALE', [{ p: ac.id, q: 10, t: 300000 }, { p: tv.id, q: 5, t: 200000 }]);
    await inv('C', '2026-06-02', 'SUPER_TRADE', [{ p: ac.id, q: 10, t: 300000 }, { p: samsung.id, q: 10, t: 250000 }]);
    await inv('D', '2026-06-03', 'PROJECT_SPA', [{ p: ac.id, q: 4, t: 100000 }]);
    await inv('H', '2026-06-04', null, [{ p: ac.id, q: 2, t: 60000 }]);
    const otherSupplier = await prisma.supplier.create({ data: { supplierNo: `${MARKER}-SUP2`, name: 'Other Merchant' } });
    // Same Panasonic product, bought from a different merchant: must never qualify.
    await prisma.purchaseInvoice.create({
      data: {
        invoiceNo: `${MARKER}-X`, supplierId: otherSupplier.id, date: new Date('2026-06-05'), workflowStatus: 'SUBMITTED', status: 'SENT',
        tradeType: 'DISTRIBUTOR_SALE', subtotal: 90000, total: 90000,
        items: { create: [{ productId: ac.id, quantity: 3, unitPrice: 30000, total: 90000 }] },
      },
    });
    return { supplierId: supplier.id, ac: ac.id, tv: tv.id };
  });

  // App with ONLY authentication stubbed.
  const stubAuth: express.RequestHandler = (req: any, res, next) => {
    const role = String(req.headers['x-test-role'] ?? 'admin');
    const useOther = req.headers['x-test-company'] === 'other';
    req.user = { id: 'poc-api-user', email: 'poc@example.com', role: 'ADMIN' };
    req.access = { isSuperAdmin: false, permissions: ROLES[role] ?? [], deniedPermissions: [], roles: [] };
    runWithTenant({ tenantId, companyId: useOther ? otherCompanyId : companyId, userId: 'poc-api-user' }, () => next());
  };
  const app = express();
  app.use(express.json());
  app.use('/api/incentives', createIncentiveRouter(stubAuth));
  const api = request(app);
  const as = (role: string) => ({ 'x-test-role': role });

  const slabs = [
    { thresholdValue: 0, rewardType: 'PERCENTAGE', rewardValue: 0.1 },
    { thresholdValue: 500000, rewardType: 'PERCENTAGE', rewardValue: 0.15 },
    { thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 0.25 },
  ];
  const schemeBody = (code: string, extra: Record<string, unknown> = {}) => ({
    manufacturerLabel: 'Panasonic',
    name: `API check ${code}`,
    code: `${MARKER}-${code}`,
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    measurementType: 'VALUE',
    eligibleSupplierIds: [seed.supplierId],
    slabs,
    ...extra,
  });

  console.log('\n=== 1. Permissions ===');
  check('reader can list schemes', (await api.get('/api/incentives/schemes').set(as('reader'))).status, 200);
  check('user with no permissions cannot list schemes', (await api.get('/api/incentives/schemes').set(as('none'))).status, 403);
  check('reader cannot create a scheme', (await api.post('/api/incentives/schemes').set(as('reader')).send(schemeBody('P'))).status, 403);
  check('reader cannot trigger a calculation', (await api.post('/api/incentives/schemes/x/calculate').set(as('reader'))).status, 403);

  console.log('\n=== 2. Validation ===');
  const bad = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('V', { measurementType: 'MONEY' }));
  check('bad measurementType is rejected', bad.status, 400);
  check('error carries a machine readable code', bad.body.code, 'VALIDATION_FAILED');
  const noTrade = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('V', { eligibleTradeTypes: [] }));
  check('no trade types without allowAnyTradeType is rejected', noTrade.status, 400);
  const mismatch = await api
    .post('/api/incentives/schemes')
    .set(as('admin'))
    .send(schemeBody('V', { allowAnyTradeType: true, slabMode: 'PROGRESSIVE', slabs: [{ thresholdValue: 0, rewardType: 'FIXED_PER_UNIT', rewardValue: 5 }] }));
  check('progressive with a per-unit reward on a value scheme is rejected', mismatch.status, 400);
  checkTrue('the rejection explains why', JSON.stringify(mismatch.body.errors).includes('requires PERCENTAGE'));

  console.log('\n=== 3. Scheme 1: any trade type, highest slab wins ===');
  const created = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('ANY', { allowAnyTradeType: true }));
  check('scheme created', created.status, 201);
  const s1 = created.body.data.id as string;
  check('defaults to DRAFT', created.body.data.status, 'DRAFT');
  check('defaults to HIGHEST_SLAB_WINS', created.body.data.slabMode, 'HIGHEST_SLAB_WINS');
  check('slabs stored in ascending threshold order', created.body.data.slabs.map((s: any) => s.sortOrder).join(','), '0,1,2');
  const draftCalc = await api.post(`/api/incentives/schemes/${s1}/calculate`).set(as('admin'));
  check('a DRAFT scheme cannot be calculated', draftCalc.status, 400);
  check('with a clear code', draftCalc.body.code, 'CALCULATION_NOT_ALLOWED');
  check('activation works', (await api.patch(`/api/incentives/schemes/${s1}/status`).set(as('admin')).send({ status: 'ACTIVE' })).body.data.status, 'ACTIVE');

  const calc1 = await api.post(`/api/incentives/schemes/${s1}/calculate`).set(as('admin'));
  check('calculation succeeds', calc1.status, 200);
  // A 500000 + C 300000 (Panasonic line) + D 100000 + H 60000 (null trade type counts because allowAnyTradeType) = 960000
  check('all four invoices count, only Panasonic lines', calc1.body.data.eligibleValue, '960000.00');
  check('slab is the 500,000 one', calc1.body.data.selectedSlabThreshold, '500000.00');
  check('incentive = 960000 x 0.15% = 1440', calc1.body.data.primaryIncentiveAmount, '1440.00');
  check('only the other-merchant invoice is excluded', calc1.body.data.invoicesExcluded.map((e: any) => e.reason).join(','), 'SUPPLIER_NOT_ELIGIBLE');
  check('reward amount equals slab amount when nothing is reward-excluded', calc1.body.data.rewardEligibleValue, '960000.00');

  console.log('\n=== 4. Same scheme switched to PROGRESSIVE ===');
  const switched = await api.put(`/api/incentives/schemes/${s1}`).set(as('admin')).send({ slabMode: 'PROGRESSIVE' });
  check('switch accepted', switched.status, 200);
  check('caller is told to recalculate', switched.body.data.recalculationRecommended, true);
  const calc2 = await api.post(`/api/incentives/schemes/${s1}/calculate`).set(as('admin'));
  // 500000 x 0.10% = 500, plus 460000 x 0.15% = 690  => 1190
  check('progressive incentive = 500 + 690 = 1190', calc2.body.data.primaryIncentiveAmount, '1190.00');
  check('previous four contributions superseded', calc2.body.data.contributionsSuperseded, 4);
  check('four new contributions', calc2.body.data.contributionsCreated, 4);

  const active = await api.get(`/api/incentives/schemes/${s1}/contributions`).set(as('reader'));
  check('four ACTIVE contributions listed by default', active.body.data.total, 4);
  const perInvoice: Record<string, string> = {};
  for (const c of active.body.data.items) perInvoice[c.purchaseInvoice.invoiceNo.replace(`${MARKER}-`, '')] = new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 6 }).format(Number(c.incentiveAmount));
  // Marginal, in date order: A 500, C 450, D 150, H 90 (sums to 1190)
  check('per-invoice amounts are marginal', Object.keys(perInvoice).sort().map((k) => `${k}=${perInvoice[k]}`).join(','), 'A=500,C=450,D=150,H=90');
  check('per-invoice amounts add up to the scheme total', Object.values(perInvoice).reduce((s, v) => s + Number(v), 0), 1190);
  const all = await api.get(`/api/incentives/schemes/${s1}/contributions?status=ALL`).set(as('reader'));
  check('history is kept: 8 rows with status=ALL', all.body.data.total, 8);
  check('an invalid status filter is rejected', (await api.get(`/api/incentives/schemes/${s1}/contributions?status=NOPE`).set(as('reader'))).status, 400);
  const paged = await api.get(`/api/incentives/schemes/${s1}/contributions?status=ALL&limit=3&page=2`).set(as('reader'));
  check('pagination returns the requested page', `${paged.body.data.items.length}/${paged.body.data.page}/${paged.body.data.totalPages}`, '3/2/3');

  console.log('\n=== 5. Summary and progress ===');
  const summary = await api.get(`/api/incentives/schemes/${s1}/summary`).set(as('reader'));
  check('summary eligible value', summary.body.data.achievement.eligibleValue, '960000');
  check('summary incentive', Number(summary.body.data.incentive.primaryAmount), 1190);
  check('current slab', summary.body.data.progress.currentSlab.thresholdValue, '500000');
  check('next slab', summary.body.data.progress.nextSlab.thresholdValue, '1000000');
  check('remaining to next slab', summary.body.data.progress.remainingToNextSlab, '40000');
  check('progress to next slab %', summary.body.data.progress.progressToNextSlabPercent, '96');
  check('freshness shows the last completed run', summary.body.data.freshness.lastRun.status, 'COMPLETED');

  console.log('\n=== 6. Runs ===');
  const runs = await api.get(`/api/incentives/schemes/${s1}/runs`).set(as('reader'));
  check('two runs recorded', runs.body.data.total, 2);
  check('both completed', runs.body.data.items.every((r: any) => r.status === 'COMPLETED'), true);
  check('runs record who triggered them', runs.body.data.items[0].triggeredBy, 'poc-api-user');

  console.log('\n=== 7. Scheme 2: named trade types, highest slab wins ===');
  const created2 = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('TRADE', { eligibleTradeTypes: ['DISTRIBUTOR_SALE'], status: 'ACTIVE' }));
  check('created directly as ACTIVE', created2.body.data.status, 'ACTIVE');
  const calc3 = await api.post(`/api/incentives/schemes/${created2.body.data.id}/calculate`).set(as('admin')).query({ detail: 'true' });
  check('only invoice A qualifies', calc3.body.data.eligibleValue, '500000.00');
  const reasons = Object.fromEntries(calc3.body.data.invoicesExcluded.map((e: any) => [e.invoiceNo.replace(`${MARKER}-`, ''), e.reason]));
  check('C excluded for trade type', reasons.C, 'TRADE_TYPE_NOT_ELIGIBLE');
  check('D excluded for trade type', reasons.D, 'TRADE_TYPE_NOT_ELIGIBLE');
  check('H excluded for NULL trade type', reasons.H, 'TRADE_TYPE_NULL');
  check('incentive = 500000 x 0.15% = 750', calc3.body.data.primaryIncentiveAmount, '750.00');
  checkTrue('detail=true adds per-invoice detail', Array.isArray(calc3.body.data.perInvoiceDetail));

  console.log('\n=== 8. Slab management ===');
  const s2 = created2.body.data.id as string;
  const added = await api.post(`/api/incentives/schemes/${s2}/slabs`).set(as('admin')).send({ thresholdValue: 250000, rewardType: 'PERCENTAGE', rewardValue: 0.12 });
  check('slab added', added.status, 201);
  const dupe = await api.post(`/api/incentives/schemes/${s2}/slabs`).set(as('admin')).send({ thresholdValue: 250000, rewardType: 'PERCENTAGE', rewardValue: 0.2 });
  check('duplicate threshold rejected', dupe.status, 400);
  const afterAdd = await api.get(`/api/incentives/schemes/${s2}`).set(as('reader'));
  check('new slab slots into the middle with sortOrder kept ascending', afterAdd.body.data.slabs.map((s: any) => `${Number(s.thresholdValue)}:${s.sortOrder}`).join(','), '0:0,250000:1,500000:2,1000000:3');
  const edited = await api.put(`/api/incentives/schemes/${s2}/slabs/${added.body.data.id}`).set(as('admin')).send({ thresholdValue: 300000, rewardType: 'PERCENTAGE', rewardValue: 0.13 });
  check('slab edited', edited.status, 200);
  const used = afterAdd.body.data.slabs.find((s: any) => Number(s.thresholdValue) === 500000).id;
  const delUsed = await api.delete(`/api/incentives/schemes/${s2}/slabs/${used}`).set(as('admin'));
  check('a slab used by past calculations cannot be deleted', delUsed.status, 400);
  check('a slab nothing refers to can be deleted', (await api.delete(`/api/incentives/schemes/${s2}/slabs/${added.body.data.id}`).set(as('admin'))).status, 200);
  check('reader cannot delete slabs', (await api.delete(`/api/incentives/schemes/${s2}/slabs/${used}`).set(as('reader'))).status, 403);

  console.log('\n=== 9. Listing and filtering ===');
  const listed = await api.get(`/api/incentives/schemes?manufacturer=%20PANASONIC%20&search=${MARKER}`).set(as('reader'));
  check('manufacturer filter is normalised; both schemes found', listed.body.data.total, 2);
  check('status filter', (await api.get(`/api/incentives/schemes?status=DRAFT&search=${MARKER}`).set(as('reader'))).body.data.total, 0);
  check('invalid status filter rejected', (await api.get('/api/incentives/schemes?status=NOPE').set(as('reader'))).status, 400);

  console.log('\n=== 10. Company isolation ===');
  const other = { ...as('admin'), 'x-test-company': 'other' };
  check('another company cannot read the scheme', (await api.get(`/api/incentives/schemes/${s1}`).set(other)).status, 404);
  check('another company cannot calculate it', (await api.post(`/api/incentives/schemes/${s1}/calculate`).set(other)).status, 404);
  check('another company cannot see its contributions', (await api.get(`/api/incentives/schemes/${s1}/contributions`).set(other)).status, 404);
  check('another company cannot edit its slabs', (await api.post(`/api/incentives/schemes/${s1}/slabs`).set(other).send({ thresholdValue: 1, rewardType: 'PERCENTAGE', rewardValue: 1 })).status, 404);
  check('another company sees none of these schemes in its list', (await api.get(`/api/incentives/schemes?search=${MARKER}`).set(other)).body.data.total, 0);

  console.log('\n=== 11. Status rules ===');
  check('closing works', (await api.patch(`/api/incentives/schemes/${s2}/status`).set(as('admin')).send({ status: 'CLOSED' })).body.data.status, 'CLOSED');
  const closedCalc = await api.post(`/api/incentives/schemes/${s2}/calculate`).set(as('admin'));
  check('a CLOSED scheme cannot be calculated', closedCalc.status, 400);
  check('cancelling a CLOSED scheme is not an allowed transition', (await api.patch(`/api/incentives/schemes/${s2}/status`).set(as('admin')).send({ status: 'CANCELLED' })).status, 400);
  check('an unknown status is rejected', (await api.patch(`/api/incentives/schemes/${s2}/status`).set(as('admin')).send({ status: 'DONE' })).status, 400);
  check('unknown scheme is a 404', (await api.get('/api/incentives/schemes/does-not-exist').set(as('reader'))).status, 404);

  console.log('\n=== 12. Supplier, billing type and reward exclusions ===');
  const noSupplier = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('S', { eligibleSupplierIds: [] }));
  check('a scheme with no eligible supplier is rejected', noSupplier.status, 400);
  const ghost = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('S', { eligibleSupplierIds: ['no-such-supplier'] }));
  check('an unknown supplier is rejected', ghost.status, 400);
  const anySupplier = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('ANYSUP', { allowAnyTradeType: true, allowAnySupplier: true, eligibleSupplierIds: [], status: 'ACTIVE' }));
  const calcAny = await api.post(`/api/incentives/schemes/${anySupplier.body.data.id}/calculate`).set(as('admin'));
  check('allowAnySupplier also counts the other merchant invoice: 960000 + 90000', calcAny.body.data.eligibleValue, '1050000.00');

  const excluded = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('REWARDX', { allowAnyTradeType: true, rewardExcludedProductIds: [seed.tv], slabs: [{ thresholdValue: 700000, rewardType: 'PERCENTAGE', rewardValue: 1 }], status: 'ACTIVE' }));
  check('a scheme with reward-excluded products is created', excluded.status, 201);
  const calcEx = await api.post(`/api/incentives/schemes/${excluded.body.data.id}/calculate`).set(as('admin'));
  // Slab amount 960000 (reaches the 700000 slab). TV lines (200000) earn nothing, so reward amount = 760000 x 1% = 7600.
  check('slab amount still includes the excluded product', calcEx.body.data.eligibleValue, '960000.00');
  check('reward amount leaves the excluded product out', calcEx.body.data.rewardEligibleValue, '760000.00');
  check('reward = 760000 x 1%', calcEx.body.data.primaryIncentiveAmount, '7600.00');
  const exSummary = await api.get(`/api/incentives/schemes/${excluded.body.data.id}/summary`).set(as('reader'));
  check('summary reports both amounts', `${exSummary.body.data.achievement.eligibleValue}/${exSummary.body.data.achievement.rewardEligibleValue}`, '960000/760000');
  const progEx = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('PROGX', { allowAnyTradeType: true, slabMode: 'PROGRESSIVE', rewardExcludedProductIds: [seed.tv] }));
  check('reward-excluded products with progressive slabs are rejected', progEx.status, 400);

  // Billing type: the user provides it, per invoice and optionally per line.
  const inv = await runWithTenant({ tenantId, companyId }, () => prisma.purchaseInvoice.findFirst({ where: { invoiceNo: `${MARKER}-H` }, include: { items: true } }));
  const setType = await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({ tradeType: 'SPECIAL_TRADE' });
  check('billing type can be set on an invoice', setType.body.data.invoice.tradeType, 'SPECIAL_TRADE');
  check('and the caller is told to recalculate', setType.body.data.recalculationRecommended, true);
  const lineType = await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({ items: [{ itemId: inv!.items[0].id, tradeType: 'DISTRIBUTOR_SALE' }] });
  check('a single line can carry its own billing type', lineType.body.data.invoice.items[0].tradeType, 'DISTRIBUTOR_SALE');
  const billScheme = await api.post('/api/incentives/schemes').set(as('admin')).send(schemeBody('BILL', { eligibleTradeTypes: ['DISTRIBUTOR_SALE'], status: 'ACTIVE' }));
  const trade = await api.post(`/api/incentives/schemes/${billScheme.body.data.id}/calculate`).set(as('admin')).query({ detail: 'true' });
  // This scheme accepts DISTRIBUTOR_SALE only. H is now SPECIAL_TRADE overall, but its one line is DISTRIBUTOR_SALE, so it counts.
  check('the line billing type overrides the invoice for eligibility: 500000 + 60000', trade.body.data.eligibleValue, '560000.00');
  check('invalid billing type rejected', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({ tradeType: 'RETAIL' })).status, 400);
  check('a line from another invoice is rejected', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({ items: [{ itemId: 'nope', tradeType: null }] })).status, 400);
  check('empty request rejected', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({})).status, 400);
  check('reader cannot set billing type', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('reader')).send({ tradeType: null })).status, 403);
  check('another company cannot set billing type', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(other).send({ tradeType: null })).status, 404);
  check('billing type can be cleared', (await api.put(`/api/incentives/invoices/${inv!.id}/billing-type`).set(as('admin')).send({ tradeType: null, items: [{ itemId: inv!.items[0].id, tradeType: null }] })).body.data.invoice.tradeType, null);

  console.log(`\n=== API CHECK RESULT: ${checks} checks, ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ===`);
  if (failures > 0) process.exitCode = 1;
  await cleanup(companyId);
}

main()
  .catch(async (err) => {
    console.error('API check crashed:', err);
    process.exitCode = 1;
    // Never leave sandbox rows behind: other scripts share this company.
    const sandbox = await ensureSandbox();
    await cleanup(sandbox.companyId);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
