// Demo data for the Incentive Tracking frontend (/incentives and /incentives/[id]).
//
//   npm run seed:incentives -- --company <slug-or-id>
//   npm run seed:incentives -- --company <slug-or-id> --cleanup-only
//
// The company can also come from the first plain argument or the SEED_INCENTIVES_COMPANY env var.
// With no company given, the available companies are listed.
//
// Safe to run repeatedly: everything created carries the marker below (scheme code, invoice number,
// product SKU, supplier number). Each run first deletes only marker-tagged rows in the chosen
// company, then recreates them. Nothing untagged is read for writing or modified. The one exception
// is described under --detach-others.
//
// Rules shown by the demo data (confirmed): amounts are pre-tax and before discount; only purchases from the
// Panasonic supplier count (one invoice is from another merchant); billing type is per scheme and can differ per
// line; some products count towards the slab but earn no reward.
//
// The demo invoices are inserted directly as SUBMITTED (they do not go through the ERP's submit flow,
// so they have no ledger or stock entries). They exist only to feed the incentive calculation.
//
// --detach-others: if a scheme YOU created has already counted demo invoices, its contribution rows
// point at rows this script wants to delete. By default the script stops and names those schemes. With
// this flag it deletes just those contribution rows (recalculate those schemes afterwards).

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { runWithTenant } from '../utils/tenant';
import { ensureCompanyDefaultRoles, ensureSystemPermissions } from '../utils/accessControl';
import { createIncentiveScheme, changeSchemeStatus, type SchemeInputDto } from '../services/incentives/incentiveScheme.service';
import { reverseContributionForInvoice, runIncentiveCalculation, type CalculationSummary } from '../services/incentives/incentiveCalculation.service';

const D = Prisma.Decimal;
const MARKER = 'SEED-INCENTIVE-DEMO';
const TRIGGERED_BY = 'seed-incentives';

type TradeType = 'DISTRIBUTOR_SALE' | 'SUPER_TRADE' | 'SPECIAL_TRADE' | 'PROJECT_NON_SPA' | 'PROJECT_SPA';
const TRADE_TRIO: TradeType[] = ['DISTRIBUTOR_SALE', 'SUPER_TRADE', 'SPECIAL_TRADE'];

// ---------------------------------------------------------------------------
// Demo catalogue
// ---------------------------------------------------------------------------

interface ProductDef {
  key: string;
  sku: string;
  name: string;
  manufacturer: string;
  unitPrice: number;
  note?: string;
}

const PRODUCTS: ProductDef[] = [
  { key: 'MCB', sku: 'PAN-MCB-32A', name: 'Panasonic MCB 32A DP', manufacturer: 'Panasonic', unitPrice: 1850 },
  { key: 'RCCB', sku: 'PAN-RCCB-40A', name: 'Panasonic RCCB 40A 30mA', manufacturer: 'Panasonic', unitPrice: 3600 },
  { key: 'ISO', sku: 'PAN-ISO-63A', name: 'Panasonic Isolator 63A', manufacturer: 'Panasonic', unitPrice: 950 },
  { key: 'SWITCH', sku: 'PAN-SWITCH-ROMA', name: 'Panasonic Roma Modular Switch', manufacturer: 'Panasonic', unitPrice: 120 },
  { key: 'WIRE', sku: 'PAN-WIRE-1.5', name: 'Panasonic FR Wire 1.5 sq mm 90m', manufacturer: ' PANASONIC ', unitPrice: 1650, note: 'manufacturer stored as " PANASONIC " (spacing and case), still matches after normalisation' },
  { key: 'FAN', sku: 'PAN-FAN-1200', name: 'Panasonic India Ceiling Fan 1200mm', manufacturer: 'Panasonic India', unitPrice: 3200, note: 'manufacturer "Panasonic India" does NOT match "Panasonic" (exact match only)' },
  { key: 'HAV', sku: 'HAV-CABLE-4', name: 'Havells Copper Cable 4 sq mm', manufacturer: 'Havells', unitPrice: 4200 },
];

interface LineDef {
  product: string;
  qty: number;
  /** Discount percent, as the ERP stores it. Never changes the incentive amount. */
  discount?: number;
  /** Billing type for this line only; overrides the invoice billing type. */
  tradeType?: TradeType;
}

interface InvoiceDef {
  no: string;
  date: string;
  /** Final status. INV-17 starts SUBMITTED and is cancelled part-way through the script. */
  status: 'SUBMITTED' | 'DRAFT' | 'CANCELLED';
  tradeType: TradeType | null;
  lines: LineDef[];
  purpose: string;
  /** Bought from a merchant other than the Panasonic supplier. */
  otherMerchant?: boolean;
}

const INVOICES: InvoiceDef[] = [
  { no: '01', date: '2026-07-08', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 100 }, { product: 'RCCB', qty: 20, discount: 5 }], purpose: 'Distributor sale in Q2; one line has a 5% discount (does not change the counted amount)' },
  { no: '02', date: '2026-07-22', status: 'SUBMITTED', tradeType: 'SUPER_TRADE', lines: [{ product: 'MCB', qty: 80 }, { product: 'ISO', qty: 60 }], purpose: 'Super trade in Q2' },
  { no: '03', date: '2026-08-05', status: 'SUBMITTED', tradeType: 'SPECIAL_TRADE', lines: [{ product: 'RCCB', qty: 32 }, { product: 'WIRE', qty: 18 }], purpose: 'Special trade; wire line uses the odd-cased manufacturer' },
  { no: '04', date: '2026-08-19', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 60 }, { product: 'HAV', qty: 15 }, { product: 'FAN', qty: 10 }], purpose: 'Mixed invoice: only the Panasonic MCB line counts' },
  { no: '05', date: '2026-09-10', status: 'SUBMITTED', tradeType: 'SUPER_TRADE', lines: [{ product: 'ISO', qty: 120 }, { product: 'SWITCH', qty: 100, tradeType: 'PROJECT_NON_SPA' }], purpose: 'Two billing types on one invoice: the switch line is Project (non SPA)' },
  { no: '06', date: '2026-08-12', status: 'SUBMITTED', tradeType: 'PROJECT_NON_SPA', lines: [{ product: 'MCB', qty: 200 }], purpose: 'Project (non SPA): excluded by trade type' },
  { no: '07', date: '2026-08-26', status: 'SUBMITTED', tradeType: 'PROJECT_SPA', lines: [{ product: 'RCCB', qty: 50 }], purpose: 'Project (SPA): excluded by trade type' },
  { no: '08', date: '2026-09-08', status: 'SUBMITTED', tradeType: null, lines: [{ product: 'MCB', qty: 40 }], purpose: 'No trade type set: excluded unless the scheme allows any trade type' },
  { no: '09', date: '2026-05-14', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 150 }, { product: 'WIRE', qty: 100, discount: 10 }], purpose: 'Before Q2 but inside the half-year scheme; 10% discount on the wire line' },
  { no: '10', date: '2026-06-20', status: 'SUBMITTED', tradeType: 'SPECIAL_TRADE', lines: [{ product: 'MCB', qty: 300 }, { product: 'RCCB', qty: 100 }], purpose: 'Large special trade in the half-year scheme' },
  { no: '11', date: '2027-01-15', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 50 }], purpose: 'Outside every scheme period' },
  { no: '12', date: '2026-08-08', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'HAV', qty: 40 }], purpose: 'Other manufacturer only' },
  { no: '13', date: '2026-09-03', status: 'SUBMITTED', tradeType: 'SPECIAL_TRADE', lines: [{ product: 'ISO', qty: 60 }], purpose: 'September special trade' },
  { no: '14', date: '2026-09-15', status: 'SUBMITTED', tradeType: 'PROJECT_SPA', lines: [{ product: 'MCB', qty: 40 }], purpose: 'September project SPA: counts only for the any-trade-type scheme' },
  { no: '15', date: '2026-09-12', status: 'DRAFT', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 30 }], purpose: 'Draft: excluded until submitted' },
  { no: '16', date: '2026-06-05', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'RCCB', qty: 200 }], purpose: 'Large distributor sale in the half-year scheme' },
  { no: '18', date: '2026-07-15', status: 'SUBMITTED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 70 }], otherMerchant: true, purpose: 'Same Panasonic product bought from another merchant: never qualifies' },
  { no: '17', date: '2026-09-05', status: 'CANCELLED', tradeType: 'DISTRIBUTOR_SALE', lines: [{ product: 'MCB', qty: 20 }], purpose: 'Counted first, then cancelled: produces a REVERSED contribution' },
];

const CANCELLED_AFTER_FIRST_RUN = '17';

// ---------------------------------------------------------------------------
// Scheme definitions
// ---------------------------------------------------------------------------

interface SchemeDef {
  key: string;
  input: SchemeInputDto;
  /** How the script treats the scheme after creating it. */
  calculate: boolean;
  closeAfter?: boolean;
  cancelAfter?: boolean;
  /** Product keys that count towards the slab but earn no reward. */
  rewardExcludedKeys?: string[];
  intent: string;
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dEnd = (iso: string) => new Date(`${iso}T23:59:59.999Z`);
const code = (suffix: string) => `${MARKER}-${suffix}`;

const SCHEMES: SchemeDef[] = [
  {
    key: 'S1',
    intent: 'ACTIVE, value, highest slab wins; isolators count towards the slab but earn no reward; has SUPERSEDED and REVERSED history',
    calculate: true,
    rewardExcludedKeys: ['ISO'],
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Switchgear Quarterly Scheme Q2 (Demo)',
      code: code('SWG-Q2'),
      description: 'Demo data. Modelled on the Q2 switchgear circular; amounts are illustrative.',
      startDate: d('2026-07-01'),
      endDate: dEnd('2026-09-29'),
      measurementType: 'VALUE',
      slabMode: 'HIGHEST_SLAB_WINS',
      eligibleTradeTypes: TRADE_TRIO,
      bookingChannel: 'eMitra',
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 400000, rewardType: 'PERCENTAGE', rewardValue: 2.75 },
        { thresholdValue: 700000, rewardType: 'PERCENTAGE', rewardValue: 3.25 },
        { thresholdValue: 1100000, rewardType: 'PERCENTAGE', rewardValue: 3.75 },
      ],
    },
  },
  {
    key: 'S2',
    intent: 'ACTIVE, value, PROGRESSIVE; total crosses into the second band',
    calculate: true,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Wiring Devices H1 TOD (Demo)',
      code: code('WD-H1-TOD'),
      description: 'Demo data. Half-year scheme, progressive bands, distributor and special trade only.',
      startDate: d('2026-04-01'),
      endDate: dEnd('2026-09-29'),
      measurementType: 'VALUE',
      slabMode: 'PROGRESSIVE',
      eligibleTradeTypes: ['DISTRIBUTOR_SALE', 'SPECIAL_TRADE'],
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 1000000, rewardType: 'PERCENTAGE', rewardValue: 0.75 },
        { thresholdValue: 2500000, rewardType: 'PERCENTAGE', rewardValue: 1.0 },
        { thresholdValue: 5500000, rewardType: 'PERCENTAGE', rewardValue: 1.2 },
      ],
    },
  },
  {
    key: 'S3',
    intent: 'ACTIVE, quantity, per-unit rewards, PROGRESSIVE, allowAnyTradeType (counts the NULL trade type invoice)',
    calculate: true,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Isolator Monthly Scheme Sep (Demo)',
      code: code('ISO-SEP'),
      description: 'Demo data. Counts every Panasonic unit in September, whatever the trade type.',
      startDate: d('2026-09-01'),
      endDate: dEnd('2026-09-29'),
      measurementType: 'QUANTITY',
      slabMode: 'PROGRESSIVE',
      allowAnyTradeType: true,
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 120, rewardType: 'FIXED_PER_UNIT', rewardValue: 5 },
        { thresholdValue: 270, rewardType: 'FIXED_PER_UNIT', rewardValue: 8 },
        { thresholdValue: 450, rewardType: 'FIXED_PER_UNIT', rewardValue: 11 },
      ],
    },
  },
  {
    key: 'S4',
    intent: 'ACTIVE, quantity, highest slab wins, slabs carry an alternate reward (a percentage of value)',
    calculate: true,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'RCCB Special Offer Aug (Demo)',
      code: code('RCCB-AUG'),
      description: 'Demo data. Primary reward is rupees per piece. The alternate reward (a percentage of value) is invented for the demo.',
      startDate: d('2026-08-01'),
      endDate: dEnd('2026-08-15'),
      measurementType: 'QUANTITY',
      slabMode: 'HIGHEST_SLAB_WINS',
      eligibleTradeTypes: TRADE_TRIO,
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 18, rewardType: 'FIXED_PER_UNIT', rewardValue: 30, altRewardType: 'PERCENTAGE', altRewardValue: 1.0 },
        { thresholdValue: 35, rewardType: 'FIXED_PER_UNIT', rewardValue: 40, altRewardType: 'PERCENTAGE', altRewardValue: 1.25 },
        { thresholdValue: 70, rewardType: 'FIXED_PER_UNIT', rewardValue: 55, altRewardType: 'PERCENTAGE', altRewardValue: 1.5 },
      ],
    },
  },
  {
    key: 'S5',
    intent: 'DRAFT with no slabs',
    calculate: false,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Modular Magic Scheme (Demo draft)',
      code: code('MODULAR-DRAFT'),
      description: 'Demo data. A scheme still being set up: no slabs yet.',
      startDate: d('2026-07-01'),
      endDate: dEnd('2026-09-29'),
      measurementType: 'VALUE',
      eligibleTradeTypes: TRADE_TRIO,
      status: 'DRAFT',
      slabs: [],
    },
  },
  {
    key: 'S6',
    intent: 'CLOSED with results, but achievement is below the first slab, so the incentive is zero',
    calculate: true,
    closeAfter: true,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Isolator Monthly Scheme Aug (Demo closed)',
      code: code('ISO-AUG-CLOSED'),
      description: 'Demo data. A finished month where the first slab was not reached.',
      startDate: d('2026-08-01'),
      endDate: dEnd('2026-08-31'),
      measurementType: 'QUANTITY',
      slabMode: 'HIGHEST_SLAB_WINS',
      eligibleTradeTypes: TRADE_TRIO,
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 120, rewardType: 'FIXED_PER_UNIT', rewardValue: 5 },
        { thresholdValue: 270, rewardType: 'FIXED_PER_UNIT', rewardValue: 8 },
        { thresholdValue: 450, rewardType: 'FIXED_PER_UNIT', rewardValue: 11 },
      ],
    },
  },
  {
    key: 'S7',
    intent: 'CANCELLED, never calculated',
    calculate: false,
    cancelAfter: true,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Legacy Switchgear Offer (Demo cancelled)',
      code: code('OLD-CANCELLED'),
      description: 'Demo data. A scheme the manufacturer withdrew.',
      startDate: d('2026-04-01'),
      endDate: dEnd('2026-06-30'),
      measurementType: 'VALUE',
      eligibleTradeTypes: TRADE_TRIO,
      status: 'DRAFT',
      slabs: [{ thresholdValue: 300000, rewardType: 'PERCENTAGE', rewardValue: 2.0 }],
    },
  },
  {
    key: 'S8',
    intent: 'ACTIVE but never calculated (empty state)',
    calculate: false,
    input: {
      manufacturerLabel: 'Panasonic',
      name: 'Modular Magic Q3 (Demo, not yet calculated)',
      code: code('MODULAR-Q3'),
      description: 'Demo data. An upcoming scheme with no calculation run yet.',
      startDate: d('2026-10-01'),
      endDate: dEnd('2026-12-31'),
      measurementType: 'VALUE',
      slabMode: 'HIGHEST_SLAB_WINS',
      eligibleTradeTypes: TRADE_TRIO,
      status: 'ACTIVE',
      slabs: [
        { thresholdValue: 2100000, rewardType: 'PERCENTAGE', rewardValue: 1.5 },
        { thresholdValue: 4800000, rewardType: 'PERCENTAGE', rewardValue: 2.25 },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Independent expected-result calculator.
// Deliberately written from the documented rules, without importing the engine, so that comparing
// it with the engine's output is a real check and not the engine agreeing with itself.
// ---------------------------------------------------------------------------

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
const productByKey = new Map(PRODUCTS.map((p) => [p.key, p]));
/** Counted amount: pre-tax and before discount, so discount and GST never matter. */
const lineAmount = (l: LineDef) => new D(productByKey.get(l.product)!.unitPrice).times(l.qty);
/** What the ERP stores on the line: net after the percentage discount, plus 18% GST. */
const storedLineTotal = (l: LineDef) => lineAmount(l).times(new D(100).minus(l.discount ?? 0)).dividedBy(100).times(1.18);
const storedLineNet = (l: LineDef) => lineAmount(l).times(new D(100).minus(l.discount ?? 0)).dividedBy(100);

interface Expected {
  counted: Array<{ no: string; value: Prisma.Decimal; qty: Prisma.Decimal; skippedLines: string[] }>;
  excluded: Array<{ no: string; reason: string }>;
  /** Slab amount and quantity. */
  value: Prisma.Decimal;
  qty: Prisma.Decimal;
  /** Reward amount and quantity (slab amount minus reward-excluded products). */
  rewardValue: Prisma.Decimal;
  rewardQty: Prisma.Decimal;
  slabThreshold: Prisma.Decimal | null;
  primary: Prisma.Decimal | null;
  alt: Prisma.Decimal | null;
}

function expectedFor(def: SchemeDef): Expected {
  const s = def.input;
  const start = s.startDate as Date;
  const end = s.endDate as Date;
  const key = norm(s.manufacturerLabel);
  const noReward = new Set(def.rewardExcludedKeys ?? []);
  const counted: Expected['counted'] = [];
  const excluded: Expected['excluded'] = [];
  let rewardValue = new D(0);
  let rewardQty = new D(0);

  for (const inv of INVOICES) {
    const date = d(inv.date);
    let reason: string | null = null;
    if (inv.status !== 'SUBMITTED') reason = 'NOT_SUBMITTED';
    else if (date < start || date > end) reason = 'OUTSIDE_SCHEME_PERIOD';
    else if (!s.allowAnySupplier && inv.otherMerchant) reason = 'SUPPLIER_NOT_ELIGIBLE';
    if (reason) {
      excluded.push({ no: inv.no, reason });
      continue;
    }
    let value = new D(0);
    let qty = new D(0);
    const skipped: string[] = [];
    let firstSkipReason: string | null = null;
    for (const line of inv.lines) {
      const product = productByKey.get(line.product)!;
      const billingType = line.tradeType ?? inv.tradeType;
      let skip: string | null = null;
      if (!s.allowAnyTradeType) {
        if (billingType === null) skip = 'TRADE_TYPE_NULL';
        else if (!(s.eligibleTradeTypes ?? []).includes(billingType)) skip = 'TRADE_TYPE_NOT_ELIGIBLE';
      }
      if (!skip && norm(product.manufacturer) !== key) skip = 'MANUFACTURER_MISMATCH';
      if (skip) {
        skipped.push(`${product.name} (${skip})`);
        firstSkipReason = firstSkipReason ?? skip;
        continue;
      }
      value = value.plus(lineAmount(line));
      qty = qty.plus(line.qty);
      if (!noReward.has(line.product)) {
        rewardValue = rewardValue.plus(lineAmount(line));
        rewardQty = rewardQty.plus(line.qty);
      }
    }
    if (qty.isZero()) excluded.push({ no: inv.no, reason: firstSkipReason ?? 'MANUFACTURER_MISMATCH' });
    else counted.push({ no: inv.no, value, qty, skippedLines: skipped });
  }

  const value = counted.reduce((sum, c) => sum.plus(c.value), new D(0));
  const qty = counted.reduce((sum, c) => sum.plus(c.qty), new D(0));
  const basis = s.measurementType === 'VALUE' ? value : qty;
  const slabs = [...(s.slabs ?? [])].sort((a, b) => new D(a.thresholdValue).comparedTo(new D(b.thresholdValue)));
  const reached = slabs.filter((slab) => new D(slab.thresholdValue).lte(basis));
  const top = reached[reached.length - 1];
  if (!top) return { counted, excluded, value, qty, rewardValue, rewardQty, slabThreshold: null, primary: null, alt: null };

  const pay = (type: string, rate: number | string, v: Prisma.Decimal, q: Prisma.Decimal) =>
    type === 'PERCENTAGE' ? v.times(rate).dividedBy(100) : q.times(rate);

  let primary: Prisma.Decimal;
  let alt: Prisma.Decimal | null = null;
  if (s.slabMode === 'PROGRESSIVE') {
    primary = new D(0);
    slabs.forEach((slab, i) => {
      const lower = new D(slab.thresholdValue);
      const next = slabs[i + 1] ? new D(slabs[i + 1].thresholdValue) : null;
      const upper = next && next.lt(basis) ? next : basis;
      const band = upper.minus(lower);
      if (band.lte(0)) return;
      primary = primary.plus(s.measurementType === 'VALUE' ? band.times(slab.rewardValue).dividedBy(100) : band.times(slab.rewardValue));
    });
  } else {
    // The slab is chosen on the slab amount; the rate is paid on the reward amount.
    primary = pay(top.rewardType, top.rewardValue, rewardValue, rewardQty);
    if (top.altRewardType && top.altRewardValue !== undefined && top.altRewardValue !== null) alt = pay(top.altRewardType, top.altRewardValue, rewardValue, rewardQty);
  }
  return { counted, excluded, value, qty, rewardValue, rewardQty, slabThreshold: new D(top.thresholdValue), primary, alt };
}

// ---------------------------------------------------------------------------
// CLI, company selection, permissions
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cleanupOnly = args.includes('--cleanup-only');
const detachOthers = args.includes('--detach-others');

function companyArgument(): string | undefined {
  const flagIndex = args.indexOf('--company');
  if (flagIndex >= 0 && args[flagIndex + 1]) return args[flagIndex + 1];
  const inline = args.find((a) => a.startsWith('--company='));
  if (inline) return inline.slice('--company='.length);
  return args.find((a) => !a.startsWith('--')) ?? process.env.SEED_INCENTIVES_COMPANY;
}

async function listCompanies() {
  const companies = await prisma.company.findMany({ include: { tenant: { select: { slug: true } } }, orderBy: { createdAt: 'asc' } });
  const userCounts = await prisma.user.groupBy({ by: ['companyId'], _count: { _all: true } });
  const counts = new Map(userCounts.map((u) => [u.companyId, u._count._all]));
  console.log('\nAvailable companies:\n');
  console.log('  slug'.padEnd(34) + 'name'.padEnd(34) + 'users  id');
  for (const c of companies) {
    console.log(`  ${c.slug.padEnd(32)}${(c.name ?? '').slice(0, 32).padEnd(34)}${String(counts.get(c.id) ?? 0).padEnd(7)}${c.id}`);
  }
  console.log('\nRe-run with the company your admin login belongs to, for example:');
  console.log('  npm run seed:incentives -- --company <slug-or-id>');
}

async function describeAdmins(companyId: string) {
  const users = await prisma.user.findMany({
    where: { companyId },
    select: { email: true, accessRoles: { select: { role: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nUsers in this company (log in as one holding ADMIN or SUPER_ADMIN to see the incentives pages):');
  if (users.length === 0) console.log('  (none)');
  for (const u of users) {
    const roles = u.accessRoles.map((r) => r.role.name).join(', ') || 'no access roles assigned';
    console.log(`  ${u.email}  [${roles}]`);
  }
  const hasPower = users.some((u) => u.accessRoles.some((r) => r.role.name === 'ADMIN' || r.role.name === 'SUPER_ADMIN'));
  if (!hasPower) console.log('  WARNING: no user here holds ADMIN or SUPER_ADMIN, so nobody can open the incentives pages yet.');
}

/**
 * Makes sure the company's Admin role can use the incentives module.
 * Reuses the access-control code: system permissions are ensured first. If the company has no Admin
 * role at all, the standard default roles are created. Otherwise ONLY the incentive permissions are
 * added to the existing Admin role, because ensureCompanyDefaultRoles would reset every system role
 * (and any customisation) to its defaults. Permissions are configuration, not demo data, so
 * --cleanup-only leaves them in place.
 */
async function ensureAdminIncentivePermissions(companyId: string): Promise<string> {
  await ensureSystemPermissions();
  const admin = await prisma.accessRole.findFirst({ where: { companyId, name: 'ADMIN' } });
  if (!admin) {
    await ensureCompanyDefaultRoles(companyId);
    return 'no ADMIN role existed, so the standard default roles were created (they include incentives)';
  }
  const permissions = await prisma.permission.findMany({ where: { module: 'incentives' }, select: { id: true } });
  const have = await prisma.rolePermission.findMany({ where: { roleId: admin.id, permissionId: { in: permissions.map((p) => p.id) } }, select: { permissionId: true } });
  const haveIds = new Set(have.map((h) => h.permissionId));
  const missing = permissions.filter((p) => !haveIds.has(p.id));
  if (missing.length) {
    await prisma.rolePermission.createMany({ data: missing.map((p) => ({ roleId: admin.id, permissionId: p.id, effect: 'ALLOW' as const })), skipDuplicates: true });
  }
  return missing.length ? `added ${missing.length} incentive permission(s) to the existing ADMIN role` : 'ADMIN role already had all incentive permissions';
}

// ---------------------------------------------------------------------------
// Cleanup (marker-tagged rows only)
// ---------------------------------------------------------------------------

async function cleanup() {
  const schemes = await prisma.incentiveScheme.findMany({ where: { code: { startsWith: MARKER } }, select: { id: true } });
  const schemeIds = schemes.map((s) => s.id);
  const invoices = await prisma.purchaseInvoice.findMany({ where: { invoiceNo: { startsWith: MARKER } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);

  // Contribution rows that belong to someone else's scheme but point at demo invoices.
  const foreign = invoiceIds.length
    ? await prisma.incentiveContribution.findMany({
        where: { purchaseInvoiceId: { in: invoiceIds }, schemeId: { notIn: schemeIds } },
        select: { id: true, scheme: { select: { name: true } } },
      })
    : [];
  if (foreign.length && !detachOthers) {
    const names = [...new Set(foreign.map((f) => f.scheme.name))];
    throw new Error(
      `Cannot remove the demo invoices: ${foreign.length} contribution row(s) from scheme(s) not created by this script still point at them: ${names.join(', ')}.\n` +
        'Re-run with --detach-others to delete just those contribution rows (then recalculate those schemes), or delete those schemes yourself.'
    );
  }
  if (foreign.length) {
    const ids = foreign.map((f) => f.id);
    await prisma.incentiveContributionItem.deleteMany({ where: { contributionId: { in: ids } } });
    await prisma.incentiveContribution.deleteMany({ where: { id: { in: ids } } });
    console.log(`  --detach-others: removed ${ids.length} contribution row(s) from other schemes that referenced demo invoices.`);
  }

  if (schemeIds.length) {
    // Collect run IDs first so we can clean up any contributions that reference them by runId
    // (this covers the case where a previous aborted cleanup deleted contributions by schemeId but
    // left the runs behind, causing the RESTRICT FK to fire on the next run).
    const runs = await prisma.incentiveCalculationRun.findMany({ where: { schemeId: { in: schemeIds } }, select: { id: true } });
    const runIds = runs.map((r) => r.id);
    if (runIds.length) {
      await prisma.incentiveContributionItem.deleteMany({ where: { contribution: { runId: { in: runIds } } } });
      await prisma.incentiveContribution.deleteMany({ where: { runId: { in: runIds } } });
    }
    await prisma.incentiveContributionItem.deleteMany({ where: { contribution: { schemeId: { in: schemeIds } } } });
    await prisma.incentiveContribution.deleteMany({ where: { schemeId: { in: schemeIds } } });
    await prisma.incentiveCalculationRun.deleteMany({ where: { schemeId: { in: schemeIds } } });
    await prisma.incentiveSlab.deleteMany({ where: { schemeId: { in: schemeIds } } });
    await prisma.incentiveScheme.deleteMany({ where: { id: { in: schemeIds } } });
  }
  if (invoiceIds.length) {
    await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: { in: invoiceIds } } });
    await prisma.purchaseInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  const products = await prisma.product.deleteMany({ where: { sku: { startsWith: MARKER } } });
  const suppliers = await prisma.supplier.deleteMany({ where: { supplierNo: { startsWith: MARKER } } });
  console.log(`  removed ${schemeIds.length} scheme(s), ${invoiceIds.length} invoice(s), ${products.count} product(s), ${suppliers.count} supplier(s)`);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const money = (v: Prisma.Decimal | null | undefined) => (v ? v.toDecimalPlaces(2).toFixed(2) : '-');

async function seedData() {
  const supplier = await prisma.supplier.create({
    data: { supplierNo: `${MARKER}-SUP-01`, name: 'Panasonic Life Solutions India (Demo)', city: 'Kolkata', country: 'India', currency: 'INR', notes: 'Demo data for incentive tracking.' },
  });
  const otherSupplier = await prisma.supplier.create({
    data: { supplierNo: `${MARKER}-SUP-02`, name: 'Local Electricals Trading (Demo)', city: 'Kolkata', country: 'India', currency: 'INR', notes: 'Demo data: a merchant that is not Panasonic.' },
  });

  const productIds = new Map<string, string>();
  for (const p of PRODUCTS) {
    const created = await prisma.product.create({
      data: {
        sku: `${MARKER}-${p.sku}`,
        name: p.name,
        manufacturer: p.manufacturer,
        brand: p.manufacturer.trim(),
        costPrice: p.unitPrice,
        salePrice: p.unitPrice,
        taxRate: 18,
        description: 'Demo data for incentive tracking.',
      },
    });
    productIds.set(p.key, created.id);
  }

  const invoiceIds = new Map<string, string>();
  for (const inv of INVOICES) {
    const lines = inv.lines.map((l) => ({ product: productByKey.get(l.product)!, def: l, total: storedLineTotal(l) }));
    const subtotal = inv.lines.reduce((sum, l) => sum.plus(storedLineNet(l)), new D(0));
    const tax = subtotal.times(0.18);
    const total = subtotal.plus(tax);
    // INV-17 is created SUBMITTED and cancelled later, so its first calculation counts it.
    const startsSubmitted = inv.status === 'SUBMITTED' || inv.no === CANCELLED_AFTER_FIRST_RUN;
    const created = await prisma.purchaseInvoice.create({
      data: {
        invoiceNo: `${MARKER}-INV-${inv.no}`,
        supplierInvoiceNo: `PLI/26-27/${1000 + Number(inv.no)}`,
        supplierId: inv.otherMerchant ? otherSupplier.id : supplier.id,
        date: d(inv.date),
        dueDate: new Date(d(inv.date).getTime() + 30 * 86400000),
        workflowStatus: startsSubmitted ? 'SUBMITTED' : 'DRAFT',
        status: startsSubmitted ? 'SENT' : 'DRAFT',
        submittedAt: startsSubmitted ? d(inv.date) : null,
        tradeType: inv.tradeType,
        subtotal: subtotal.toNumber(),
        taxAmount: tax.toNumber(),
        total: total.toNumber(),
        baseTotal: total.toFixed(6),
        outstandingAmount: startsSubmitted ? total.toFixed(6) : '0',
        notes: `Demo data: ${inv.purpose}`,
        items: {
          create: lines.map((l) => ({
            productId: productIds.get(l.def.product)!,
            description: l.product.name,
            quantity: l.def.qty,
            unitPrice: l.product.unitPrice,
            discount: l.def.discount ?? 0,
            taxRate: 18,
            total: l.total.toNumber(),
            tradeType: l.def.tradeType ?? null,
          })),
        },
      },
    });
    invoiceIds.set(inv.no, created.id);
  }
  return { invoiceIds, supplierId: supplier.id, productIds };
}

interface SchemeRun {
  def: SchemeDef;
  id: string;
  name: string;
  summary: CalculationSummary | null;
}

async function createSchemes(seeded: { supplierId: string; productIds: Map<string, string> }): Promise<SchemeRun[]> {
  const created: SchemeRun[] = [];
  for (const def of SCHEMES) {
    const scheme = await createIncentiveScheme({
      ...def.input,
      eligibleSupplierIds: [seeded.supplierId],
      rewardExcludedProductIds: (def.rewardExcludedKeys ?? []).map((k) => seeded.productIds.get(k)!),
    });
    created.push({ def, id: scheme.id, name: scheme.name, summary: null });
  }
  return created;
}

async function runCalculations(schemes: SchemeRun[], invoiceIds: Map<string, string>) {
  const byKey = new Map(schemes.map((s) => [s.def.key, s]));
  const s1 = byKey.get('S1')!;

  // S1: first run counts invoice 17; then the invoice is cancelled and its contribution reversed;
  // the second run supersedes the first run's rows. This leaves ACTIVE, SUPERSEDED and REVERSED rows.
  await runIncentiveCalculation(s1.id, { reason: 'INITIAL', triggeredBy: TRIGGERED_BY });
  const cancelledId = invoiceIds.get(CANCELLED_AFTER_FIRST_RUN)!;
  await prisma.purchaseInvoice.update({ where: { id: cancelledId }, data: { workflowStatus: 'CANCELLED', status: 'CANCELLED', cancelledAt: new Date() } });
  await reverseContributionForInvoice(s1.id, cancelledId);
  s1.summary = await runIncentiveCalculation(s1.id, { reason: 'MANUAL_RECALC', triggeredBy: TRIGGERED_BY });

  for (const s of schemes) {
    if (s.def.key === 'S1' || !s.def.calculate) continue;
    s.summary = await runIncentiveCalculation(s.id, { reason: 'INITIAL', triggeredBy: TRIGGERED_BY });
  }
  for (const s of schemes) {
    if (s.def.closeAfter) await changeSchemeStatus(s.id, 'CLOSED');
    if (s.def.cancelAfter) await changeSchemeStatus(s.id, 'CANCELLED');
  }
}

// ---------------------------------------------------------------------------
// Report and verification
// ---------------------------------------------------------------------------

async function report(schemes: SchemeRun[]) {
  let mismatches = 0;
  const foreignPanasonic = await prisma.purchaseInvoice.count({
    where: { invoiceNo: { not: { startsWith: MARKER } }, items: { some: { product: { manufacturer: { contains: 'panasonic', mode: 'insensitive' } } } } },
  });

  console.log('\n================ SEEDED INCENTIVE SCHEMES ================');
  for (const s of schemes) {
    const def = s.def;
    const exp = expectedFor(def);
    const input = def.input;
    const status = def.closeAfter ? 'CLOSED' : def.cancelAfter ? 'CANCELLED' : String(input.status);
    console.log(`\n${def.key}  ${s.name}`);
    console.log(`    id:        ${s.id}   (frontend: /incentives/${s.id})`);
    console.log(`    status:    ${status}   ${input.measurementType}   ${input.slabMode ?? 'HIGHEST_SLAB_WINS'}${input.allowAnyTradeType ? '   any trade type' : ''}`);
    console.log(`    period:    ${(input.startDate as Date).toISOString().slice(0, 10)} to ${(input.endDate as Date).toISOString().slice(0, 10)}`);
    console.log(`    purpose:   ${def.intent}`);

    if (!def.calculate) {
      console.log('    expected:  not calculated, so no contributions, no runs, and no progress on the detail page');
      continue;
    }

    const basisLabel = input.measurementType === 'VALUE' ? 'value' : 'quantity';
    console.log(`    expected:  slab amount ${money(exp.value)}, quantity ${exp.qty.toString()}, ${exp.counted.length} contributing invoice(s)`);
    if (!exp.rewardValue.equals(exp.value)) console.log(`               reward amount ${money(exp.rewardValue)} (products excluded from the reward still count towards the slab)`);
    if (exp.slabThreshold) {
      console.log(`               slab reached: ${basisLabel} threshold ${exp.slabThreshold.toString()}   primary incentive ${money(exp.primary)}${exp.alt ? `   alternate ${money(exp.alt)}` : ''}`);
    } else {
      console.log('               no slab reached, so the incentive is 0');
    }
    for (const c of exp.counted) {
      const skipped = c.skippedLines.length ? `   (lines skipped: ${c.skippedLines.join('; ')})` : '';
      console.log(`               counts: INV-${c.no}  value ${money(c.value)}  qty ${c.qty.toString()}${skipped}`);
    }
    for (const e of exp.excluded) console.log(`               excluded: INV-${e.no}  ${e.reason}`);

    const actual = s.summary!;
    const actualExcluded = new Set(actual.invoicesExcluded.filter((e) => e.invoiceNo.startsWith(MARKER)).map((e) => `${e.invoiceNo.replace(`${MARKER}-INV-`, '')}:${e.reason}`));
    const expectedExcluded = new Set(exp.excluded.map((e) => `${e.no}:${e.reason}`));
    const checks: Array<[string, boolean]> = [
      ['eligible value', new D(actual.eligibleValue).equals(exp.value.toDecimalPlaces(2))],
      ['eligible quantity', new D(actual.eligibleQuantity).equals(exp.qty.toDecimalPlaces(2))],
      ['reward amount', new D(actual.rewardEligibleValue).equals(exp.rewardValue.toDecimalPlaces(2)) && new D(actual.rewardEligibleQuantity).equals(exp.rewardQty.toDecimalPlaces(2))],
      ['slab', (actual.selectedSlabThreshold === null && exp.slabThreshold === null) || (!!actual.selectedSlabThreshold && !!exp.slabThreshold && new D(actual.selectedSlabThreshold).equals(exp.slabThreshold))],
      ['primary incentive', (actual.primaryIncentiveAmount === null && exp.primary === null) || (!!actual.primaryIncentiveAmount && !!exp.primary && new D(actual.primaryIncentiveAmount).equals(exp.primary.toDecimalPlaces(2)))],
      ['alternate incentive', (actual.altIncentiveAmount === null && exp.alt === null) || (!!actual.altIncentiveAmount && !!exp.alt && new D(actual.altIncentiveAmount).equals(exp.alt.toDecimalPlaces(2)))],
      ['contribution count', actual.contributionsCreated === exp.counted.length],
      ['excluded invoices and reasons', actualExcluded.size === expectedExcluded.size && [...expectedExcluded].every((x) => actualExcluded.has(x))],
    ];
    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length === 0) console.log('    verified:  engine output matches the expected figures above');
    else if (foreignPanasonic > 0) {
      console.log(`    NOTE:      engine output differs on: ${failed.join(', ')}.`);
      console.log(`               ${foreignPanasonic} other (untagged) invoice(s) in this company contain Panasonic products and are counted too, so this is expected.`);
    } else {
      mismatches += 1;
      console.log(`    MISMATCH:  engine output differs from the expected figures on: ${failed.join(', ')}`);
      console.log(`               engine says value ${actual.eligibleValue}, quantity ${actual.eligibleQuantity}, incentive ${actual.primaryIncentiveAmount}`);
    }
  }

  // Lifecycle rows for S1.
  const s1 = schemes.find((s) => s.def.key === 'S1')!;
  const rows = await prisma.incentiveContribution.groupBy({ by: ['lifecycleStatus'], where: { schemeId: s1.id }, _count: { _all: true } });
  console.log('DEBUG s1.id:', s1.id, 'rows:', JSON.stringify(rows));
  const counts = Object.fromEntries(rows.map((r) => [r.lifecycleStatus, r._count._all]));
  const expectedS1Active = expectedFor(s1.def).counted.length;
  const lifecycleOk = counts.ACTIVE === expectedS1Active && counts.REVERSED === 1 && (counts.SUPERSEDED ?? 0) === expectedS1Active;
  console.log(`\nS1 contribution history: ACTIVE ${counts.ACTIVE ?? 0}, SUPERSEDED ${counts.SUPERSEDED ?? 0}, REVERSED ${counts.REVERSED ?? 0}   ${lifecycleOk || foreignPanasonic > 0 ? '(as expected)' : '(UNEXPECTED)'}`);
  if (!lifecycleOk && foreignPanasonic === 0) mismatches += 1;
  const runs = await prisma.incentiveCalculationRun.groupBy({ by: ['schemeId'], where: { schemeId: { in: schemes.map((s) => s.id) } }, _count: { _all: true } });
  console.log(`Calculation runs created: ${runs.reduce((n, r) => n + r._count._all, 0)} across ${runs.length} scheme(s)`);

  console.log('\n================ DEMO INVOICES ================');
  console.log('  number   date        status      trade type         lines  pre-tax total   note   (pre-tax = quantity x price, before discount)');
  for (const inv of INVOICES) {
    const total = inv.lines.reduce((s, l) => s.plus(lineAmount(l)), new D(0));
    console.log(`  INV-${inv.no}   ${inv.date}  ${inv.status.padEnd(10)}  ${(inv.tradeType ?? 'NULL').padEnd(17)}  ${String(inv.lines.length).padEnd(5)}  ${money(total).padStart(12)}   ${inv.purpose}`);
  }
  console.log(`  (invoice numbers are stored as ${MARKER}-INV-NN)`);
  const odd = PRODUCTS.filter((p) => p.note);
  for (const p of odd) console.log(`  product note: ${p.name}: ${p.note}`);
  return mismatches;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const wanted = companyArgument();
  if (!wanted) {
    console.log('No company given.');
    await listCompanies();
    process.exitCode = 1;
    return;
  }
  const company = await prisma.company.findFirst({ where: { OR: [{ id: wanted }, { slug: wanted }] }, include: { tenant: { select: { slug: true } } } });
  if (!company) {
    console.log(`No company found with id or slug "${wanted}".`);
    await listCompanies();
    process.exitCode = 1;
    return;
  }
  console.log(`Company: ${company.name} (slug ${company.slug}, id ${company.id}, tenant ${company.tenant.slug})`);
  console.log(`Marker:  ${MARKER}  (only rows carrying it are removed or created)`);

  await runWithTenant({ tenantId: company.tenantId, companyId: company.id, userId: TRIGGERED_BY }, async () => {
    console.log('\n[1/5] Removing previous demo data');
    try {
      await cleanup();
    } catch (err: any) {
      if (err?.code === 'P2003') {
        throw new Error('A demo row is still referenced by something this script did not create (for example a stock or ledger record you added to a demo product). Remove that reference, or delete it in the app, then run again.');
      }
      throw err;
    }
    if (cleanupOnly) {
      console.log('\nCleanup-only mode: done. (Permissions granted earlier are configuration and were left in place.)');
      return;
    }

    console.log('\n[2/5] Admin role permissions');
    console.log(`  ${await ensureAdminIncentivePermissions(company.id)}`);

    console.log('\n[3/5] Creating supplier, products and purchase invoices');
    const seeded = await seedData();
    console.log(`  2 suppliers, ${PRODUCTS.length} products, ${INVOICES.length} invoices`);

    console.log('\n[4/5] Creating schemes through createIncentiveScheme()');
    const schemes = await createSchemes(seeded);
    console.log(`  ${schemes.length} schemes`);

    console.log('\n[5/5] Running calculations');
    await runCalculations(schemes, seeded.invoiceIds);

    const mismatches = await report(schemes);
    await describeAdmins(company.id);
    if (mismatches > 0) {
      console.log(`\nRESULT: ${mismatches} check(s) did not match the expected figures.`);
      process.exitCode = 1;
    } else {
      console.log('\nRESULT: seeded and verified. Run it again any time; it replaces only its own tagged data.');
    }
  });
}

main()
  .catch((err) => {
    console.error(`\nseed-incentives failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
