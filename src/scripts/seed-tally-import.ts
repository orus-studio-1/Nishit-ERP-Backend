/**
 * One-time import of Tally Prime JSON exports into a company.
 *
 *   Master.json     -> Units, Categories (stock groups), Warehouses (godowns), Products (stock items),
 *                      opening stock (StockLedgerEntry + StockLevel + StockMovement)
 *   Bills.json      -> open receivables -> Customers + SalesInvoices (opening balances)
 *   bills-pay.json  -> open payables    -> Suppliers + PurchaseInvoices (opening balances)
 *
 * Every opening balance is booked against "3000 Opening Balance Equity" so the GL stays balanced:
 *   stock:    Dr 1200 Stock In Hand        / Cr 3000
 *   AR bills: Dr 1100 Accounts Receivable  / Cr 3000   (per invoice, tagged with customer)
 *   AP bills: Dr 3000                      / Cr 2000 Accounts Payable (per invoice, tagged with supplier)
 *
 * Re-runnable: masters are upserted, and opening stock / bills already imported are skipped.
 *
 * Usage:
 *   npx tsx src/scripts/seed-tally-import.ts --company "<name or slug>" --dir <folder with json files> --dry-run
 *   npx tsx src/scripts/seed-tally-import.ts --company "<name or slug>" --dir <folder with json files>
 * Options:
 *   --only masters,stock,movements,bills   run a subset of steps (default: all)
 *   --stock-date YYYY-MM-DD      posting date of opening stock (default 2025-04-01, Tally books start)
 *   --cutover-date YYYY-MM-DD    GL posting date for opening bills (default today)
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { runWithTenant, currentTenantContext, currentCompanyId } from '../utils/tenant';
import { generateCustomerNo, generateSupplierNo } from '../utils/generate';
import { normalizeName } from '../services/tally/entityResolver';
import { ensureLedgerAccount, postToLedger, recomputeAccountBalances } from '../services/accounting/ledger.service';

const D = Prisma.Decimal;
const OPENING_STOCK_VOUCHER = 'TALLY-OPENING';
const AR_GUID_PREFIX = 'TALLY-OB-AR-';
const AP_GUID_PREFIX = 'TALLY-OB-AP-';
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// ---------------------------------------------------------------- args

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const company = get('--company');
  const dir = get('--dir');
  if (!company || !dir) {
    console.error('Usage: tsx src/scripts/seed-tally-import.ts --company "<name or slug>" --dir <folder with json files> [--dry-run] [--only masters,stock,movements,bills]');
    process.exit(1);
  }
  const only = (get('--only') || 'masters,stock,movements,bills').split(',').map((s) => s.trim());
  const today = new Date().toISOString().slice(0, 10);
  return {
    company,
    dir,
    dryRun: argv.includes('--dry-run'),
    steps: new Set(only),
    stockDate: new Date(`${get('--stock-date') || '2025-04-01'}T00:00:00.000Z`),
    cutoverDate: new Date(`${get('--cutover-date') || today}T00:00:00.000Z`),
  };
}

// ---------------------------------------------------------------- tally parsing helpers

/** Tally exports JSON as UTF-16LE with a BOM. */
function loadTallyJson(file: string): any {
  const buf = readFileSync(file);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

/** Trims Tally's padded strings and drops its "\u0004 Not Applicable" style sentinels. */
function clean(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s.startsWith('\u0004')) return null;
  return s;
}

/** "58 Pcs" -> 58, "-3 Coil" -> -3 */
function parseQty(value: unknown): number {
  const m = clean(value)?.match(/^(-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
}

/** "214.93/Pcs" -> 214.93 */
function parseRate(value: unknown): number {
  const m = clean(value)?.match(/^(-?[\d.]+)/);
  return m ? Math.abs(Number(m[1])) : 0;
}

/** "19-Nov-12" -> 2012-11-19 */
function parseTallyDate(value: unknown): Date | null {
  const m = clean(value)?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(year, month, Number(m[1])));
}

/** Same SKU scheme as findOrCreateProduct so voucher syncs and this import agree. */
function tallySku(key: string) {
  const skuBase = key.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').toUpperCase().slice(0, 40) || 'ITEM';
  const skuHash = createHash('sha1').update(key).digest('hex').slice(0, 6).toUpperCase();
  return `TALLY-${skuBase}-${skuHash}`;
}

function codeFromName(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'GROUP';
}

function shortHash(input: string, len: number) {
  return createHash('sha1').update(input).digest('hex').slice(0, len).toUpperCase();
}

function latestGstRate(item: any): number {
  const details = Array.isArray(item.gstdetails) ? item.gstdetails : [];
  for (let i = details.length - 1; i >= 0; i--) {
    for (const state of details[i].statewisedetails || []) {
      const igst = (state.ratedetails || []).find((r: any) => r.gstratedutyhead === 'IGST');
      const rate = clean(igst?.gstrate);
      if (rate) return Number(rate);
    }
  }
  return 0;
}

function latestHsn(item: any): string | null {
  const details = Array.isArray(item.hsndetails) ? item.hsndetails : [];
  for (let i = details.length - 1; i >= 0; i--) {
    const code = clean(details[i].hsncode);
    if (code) return code;
  }
  return null;
}

function byGuid<T extends { guid?: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) if (row.guid && !seen.has(row.guid)) seen.set(row.guid, row);
  return [...seen.values()];
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Refuses to post into a pre-existing account 3000 that is something other than opening balance equity. */
async function openingEquityAccount(tx: any) {
  const existing = await tx.account.findFirst({ where: { code: '3000' } });
  if (existing && !/opening/i.test(existing.name)) {
    throw new Error(`Account code 3000 is already "${existing.name}" — rename/recode it or change the equity code in this script`);
  }
  return ensureLedgerAccount(tx, '3000', 'Opening Balance Equity', 'EQUITY');
}

// ---------------------------------------------------------------- parse files

type OpeningRow = { godown: string; qty: number; rate: number };
type ParsedItem = { name: string; key: string; group: string | null; unit: string | null; description: string | null; hsn: string | null; gstRate: number; opening: OpeningRow[] };
type ParsedBill = { party: string; ref: string; date: Date; dueDate: Date | null; amount: number; overdueDays: number | null; raw: any };

function parseMaster(file: string) {
  const messages: any[] = loadTallyJson(file).tallymessage || [];
  const ofType = (t: string) => byGuid(messages.filter((m) => m?.metadata?.type === t));

  const units = ofType('Unit').map((u) => normalizeName(u.metadata.name)).filter(Boolean);

  const groups = ofType('Stock Group').map((g) => ({
    name: normalizeName(g.metadata.name),
    parent: clean(g.parent) ? normalizeName(g.parent) : null,
  }));

  const godowns = ofType('Godown').map((g) => {
    const lines = Array.isArray(g.address) ? g.address.filter((l: unknown) => typeof l === 'string') : [];
    return { name: normalizeName(g.metadata.name), address: lines.join(', ') || null };
  });

  const items: ParsedItem[] = ofType('Stock Item').map((it) => {
    const name = normalizeName(it.metadata.name);
    const opening: OpeningRow[] = [];
    for (const b of it.batchallocations || []) {
      const qty = parseQty(b.openingbalance);
      if (!qty) continue;
      const value = Math.abs(Number(clean(b.openingvalue) || 0));
      const rate = parseRate(b.openingrate) || (value ? value / Math.abs(qty) : 0);
      opening.push({ godown: normalizeName(b.godownname), qty, rate });
    }
    const description = clean(it.description);
    return {
      name,
      key: name.toLowerCase(),
      group: clean(it.parent) ? normalizeName(it.parent) : null,
      unit: clean(it.baseunits) ? normalizeName(it.baseunits) : null,
      description: description && description !== clean(it.parent) ? description : null,
      hsn: latestHsn(it),
      gstRate: latestGstRate(it),
      opening,
    };
  });

  return { units, groups, godowns, items };
}

function parseBills(file: string): ParsedBill[] {
  const rows: any[] = loadTallyJson(file)?.billbody?.billdetail || [];
  const bills: ParsedBill[] = [];
  for (const r of rows) {
    const party = normalizeName(r.billfixed?.billparty);
    const ref = clean(r.billfixed?.billref) || 'NA';
    const date = parseTallyDate(r.billfixed?.billdate);
    const amount = Math.abs(Number((r.billcl || [])[0] || 0));
    if (!party || !date || !amount) {
      console.warn(`  ! skipping unreadable bill in ${path.basename(file)}: ${JSON.stringify(r.billfixed)}`);
      continue;
    }
    bills.push({
      party,
      ref,
      date,
      dueDate: parseTallyDate(r.billdue),
      amount,
      overdueDays: clean(r.billoverdue) ? Number(clean(r.billoverdue)) : null,
      raw: r,
    });
  }
  return bills;
}

const billGuid = (prefix: string, b: ParsedBill) => prefix + shortHash(`${b.party.toLowerCase()}|${b.ref}|${b.date.toISOString()}`, 16);
const billInvoiceNo = (kind: 'AR' | 'AP', b: ParsedBill) =>
  `OB-${kind}-${b.ref.replace(/[^A-Za-z0-9/-]+/g, '').slice(0, 30) || 'NA'}-${shortHash(`${b.party.toLowerCase()}|${b.ref}|${b.date.toISOString()}`, 5)}`;

// ---------------------------------------------------------------- steps

async function importMasters(companyId: string, tenantId: string, master: ReturnType<typeof parseMaster>, dryRun: boolean) {
  console.log('\n== Masters');

  // Units
  const existingUnits = await prisma.unit.findMany({ where: { companyId }, select: { id: true, name: true } });
  const unitIds = new Map(existingUnits.map((u) => [u.name.toLowerCase(), u.id]));
  const newUnits = master.units.filter((u) => !unitIds.has(u.toLowerCase()));
  console.log(`  Units: ${master.units.length} in file, ${newUnits.length} new`);

  // Categories
  const existingCats = await prisma.category.findMany({ where: { companyId }, select: { id: true, code: true, name: true, parentId: true } });
  const catByCode = new Map(existingCats.filter((c) => c.code).map((c) => [c.code!, c]));
  const newCats = master.groups.filter((g) => !catByCode.has(codeFromName(g.name)));
  console.log(`  Categories: ${master.groups.length} in file, ${newCats.length} new`);

  // Warehouses
  const existingWh = await prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } });
  const whByName = new Map(existingWh.map((w) => [w.name.toLowerCase(), w.id]));
  const newWh = master.godowns.filter((g) => !whByName.has(g.name.toLowerCase()));
  console.log(`  Warehouses: ${master.godowns.length} in file, ${newWh.length} new (${master.godowns.map((g) => g.name).join(', ')})`);

  // Products
  const existingProducts = await prisma.product.findMany({
    where: { companyId },
    select: { id: true, name: true, unitId: true, categoryId: true, hsnCode: true, taxRate: true, description: true, maintainStock: true },
  });
  const productByName = new Map(existingProducts.map((p) => [p.name.toLowerCase(), p]));
  const toCreate = master.items.filter((i) => !productByName.has(i.key));
  const toLink = master.items.filter((i) => productByName.has(i.key));
  console.log(`  Products: ${master.items.length} in file, ${toCreate.length} new, ${toLink.length} already exist (missing fields will be filled)`);

  if (dryRun) return;

  for (const name of newUnits) {
    const unit = await prisma.unit.create({ data: { companyId, name, symbol: name } });
    unitIds.set(name.toLowerCase(), unit.id);
  }

  for (const g of newCats) {
    const cat = await prisma.category.create({ data: { companyId, name: g.name, code: codeFromName(g.name), description: 'Imported from Tally stock group' } });
    catByCode.set(cat.code!, cat);
  }
  // Second pass so parents can be linked regardless of file order.
  for (const g of master.groups) {
    if (!g.parent) continue;
    const cat = catByCode.get(codeFromName(g.name));
    const parent = catByCode.get(codeFromName(g.parent));
    if (cat && parent && !cat.parentId && cat.id !== parent.id) {
      await prisma.category.update({ where: { id: cat.id }, data: { parentId: parent.id } });
    }
  }
  const catIdByName = new Map([...catByCode.values()].map((c) => [codeFromName(c.name), c.id]));

  for (const g of newWh) {
    const wh = await prisma.warehouse.create({
      data: { companyId, tenantId, name: g.name, code: codeFromName(g.name).slice(0, 30), address: g.address, country: 'India', isActive: true },
    });
    whByName.set(g.name.toLowerCase(), wh.id);
  }

  const productData = (i: ParsedItem) => {
    const firstRate = i.opening.find((o) => o.rate > 0)?.rate || 0;
    return {
      unitId: i.unit ? unitIds.get(i.unit.toLowerCase()) : undefined,
      categoryId: i.group ? catIdByName.get(codeFromName(i.group)) : undefined,
      hsnCode: i.hsn,
      taxRate: i.gstRate,
      description: i.description,
      costPrice: firstRate,
      allowNegativeStock: i.opening.some((o) => o.qty < 0),
    };
  };

  let created = 0;
  for (const rows of chunk(toCreate, 500)) {
    const inserted = await prisma.product.createManyAndReturn({
      data: rows.map((i) => ({
        companyId,
        sku: tallySku(i.key),
        name: i.name,
        maintainStock: true,
        valuationMethod: 'MOVING_AVERAGE' as const,
        ...productData(i),
      })),
      select: { id: true, name: true },
    });
    for (const p of inserted) productByName.set(p.name.toLowerCase(), p as any);
    created += inserted.length;
    console.log(`  ... created ${created}/${toCreate.length} products`);
  }

  for (const i of toLink) {
    const p = productByName.get(i.key)!;
    const d = productData(i);
    const fill: any = { maintainStock: true };
    if (!p.unitId && d.unitId) fill.unitId = d.unitId;
    if (!p.categoryId && d.categoryId) fill.categoryId = d.categoryId;
    if (!p.hsnCode && d.hsnCode) fill.hsnCode = d.hsnCode;
    if (new D(p.taxRate || 0).eq(0) && d.taxRate) fill.taxRate = d.taxRate;
    if (!p.description && d.description) fill.description = d.description;
    if (d.allowNegativeStock) fill.allowNegativeStock = true;
    await prisma.product.update({ where: { id: p.id }, data: fill });
  }

  // Map every imported item so later Tally voucher syncs resolve to these products.
  for (const rows of chunk(master.items, 1000)) {
    await prisma.tallyEntityMap.createMany({
      data: rows.map((i) => ({ companyId, entityType: 'PRODUCT', tallyKey: i.key, erpId: productByName.get(i.key)!.id })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ Masters done (${created} products created, ${toLink.length} linked)`);
}

// The remaining steps talk to a remote database, so they compute everything in memory and write in
// bulk (createMany) rather than one round trip per row.

type FiscalCtx = { fiscalYearId: string; periodId: string | null };
type GlLine = { accountId: string; debit: number; credit: number; partyType?: 'CUSTOMER' | 'SUPPLIER'; partyId?: string; invoiceId?: string; remarks: string };
type GlVoucher = { voucherType: 'SALES_INVOICE' | 'PURCHASE_INVOICE'; voucherId: string; voucherNo: string; lines: GlLine[] };

/** Same row shape postToLedger writes, for vouchers that share one posting date / fiscal period. */
function glRows(ctx: FiscalCtx, postingDate: Date, v: GlVoucher) {
  return v.lines.map((line) => ({
    postingDate,
    fiscalYearId: ctx.fiscalYearId,
    periodId: ctx.periodId,
    accountId: line.accountId,
    customerId: line.partyType === 'CUSTOMER' ? line.partyId : undefined,
    partyType: line.partyType,
    partyId: line.partyId,
    voucherType: v.voucherType,
    voucherId: v.voucherId,
    invoiceId: line.invoiceId,
    debit: new D(line.debit),
    credit: new D(line.credit),
    currency: 'INR',
    exchangeRate: new D(1),
    debitBase: new D(line.debit),
    creditBase: new D(line.credit),
    remarks: line.remarks || v.voucherNo,
    isReversal: false,
  }));
}

/** Posts many vouchers: the first through postToLedger (validates accounts, resolves the fiscal period), the rest in bulk. */
async function bulkPostLedger(postingDate: Date, vouchers: GlVoucher[]) {
  if (!vouchers.length) return;
  const [first, ...rest] = vouchers;
  const ctx: FiscalCtx = await prisma.$transaction((tx: any) => postToLedger(tx, { ...first, postingDate }));
  const rows = rest.flatMap((v) => glRows(ctx, postingDate, v));
  for (const part of chunk(rows, 1000)) await prisma.generalLedgerEntry.createMany({ data: part as any });
  await prisma.$transaction((tx: any) => recomputeAccountBalances(tx, [...new Set(first.lines.map((l) => l.accountId))]), { timeout: 300_000 });
}

/**
 * Allocates `count` customer/supplier numbers from the company's default numbering series in one go.
 * The first comes from the normal allocator (which creates the series if needed); the rest are reserved by
 * bumping the series counter once, under the same advisory lock allocateDocumentNo uses.
 */
async function allocateNumbers(documentType: 'CUSTOMER' | 'SUPPLIER', count: number): Promise<string[]> {
  if (!count) return [];
  const first = documentType === 'CUSTOMER' ? await generateCustomerNo() : await generateSupplierNo();
  if (count === 1) return [first];
  return prisma.$transaction(async (tx: any) => {
    const context = currentTenantContext();
    const lockKey = `${context?.tenantId || 'GLOBAL'}:${currentCompanyId() || 'GLOBAL'}:${context?.branchId || 'ALL'}:${documentType}`;
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);
    const series = await tx.numberingSeries.findFirst({ where: { tenantId: context?.tenantId, companyId: currentCompanyId(), branchId: context?.branchId, documentType, name: 'Default', isActive: true, isDefault: true } });
    const digits = series?.digits || 5;
    if (!series || series.suffix || !String(series.pattern || '').endsWith('{SEQ}')) {
      throw new Error(`Unexpected ${documentType} numbering series format; cannot bulk-allocate numbers`);
    }
    const updated = await tx.numberingSeries.update({ where: { id: series.id }, data: { current: { increment: count - 1 } } });
    const base = first.slice(0, -digits);
    const numbers = [first];
    for (let seq = updated.current - (count - 2); seq <= updated.current; seq++) numbers.push(base + String(seq).padStart(digits, '0'));
    return numbers;
  });
}

/** Finds existing customers/suppliers by name, bulk-creates the rest, and records them in TallyEntityMap. */
async function resolveParties(companyId: string, kind: 'CUSTOMER' | 'SUPPLIER', names: string[]) {
  const existing: Array<{ id: string; name: string }> = kind === 'CUSTOMER'
    ? await prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true } })
    : await prisma.supplier.findMany({ where: { companyId }, select: { id: true, name: true } });
  const ids = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));
  const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
  const missing = unique.filter((n) => !ids.has(n.toLowerCase()));

  const numbers = await allocateNumbers(kind, missing.length);
  for (const [i, part] of chunk(missing, 500).entries()) {
    const offset = i * 500;
    const data = part.map((name, j) => (kind === 'CUSTOMER'
      ? { companyId, customerNo: numbers[offset + j], name, currency: 'INR' }
      : { companyId, supplierNo: numbers[offset + j], name, currency: 'INR' }));
    const created: Array<{ id: string; name: string }> = kind === 'CUSTOMER'
      ? await prisma.customer.createManyAndReturn({ data: data as any, select: { id: true, name: true } })
      : await prisma.supplier.createManyAndReturn({ data: data as any, select: { id: true, name: true } });
    for (const p of created) ids.set(p.name.toLowerCase(), p.id);
  }

  await prisma.tallyEntityMap.createMany({
    data: unique.map((n) => ({ companyId, entityType: kind, tallyKey: n.toLowerCase(), erpId: ids.get(n.toLowerCase())! })),
    skipDuplicates: true,
  });
  return { ids, created: missing.length };
}

async function importOpeningStock(companyId: string, master: ReturnType<typeof parseMaster>, stockDate: Date, dryRun: boolean) {
  console.log('\n== Opening stock');
  // Merge multiple Tally batch rows for the same item+godown.
  const rows = new Map<string, { key: string; godown: string; qty: number; value: number }>();
  for (const i of master.items) {
    for (const o of i.opening) {
      const k = `${i.key}|${o.godown.toLowerCase()}`;
      const row = rows.get(k) || { key: i.key, godown: o.godown, qty: 0, value: 0 };
      row.qty += o.qty;
      row.value += o.qty * o.rate;
      rows.set(k, row);
    }
  }
  const all = [...rows.values()].filter((r) => r.qty !== 0);
  const negatives = all.filter((r) => r.qty < 0).length;
  const totalValue = all.reduce((s, r) => s + r.value, 0);
  console.log(`  ${all.length} item/godown balances, ${negatives} negative (kept as in Tally), net value ₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  if (dryRun) return;

  const products = await prisma.product.findMany({ where: { companyId }, select: { id: true, name: true } });
  const productId = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));
  const warehouses = await prisma.warehouse.findMany({ where: { companyId }, select: { id: true, name: true } });
  const warehouseId = new Map(warehouses.map((w) => [w.name.toLowerCase(), w.id]));

  const done = await prisma.stockLedgerEntry.findMany({
    where: { companyId, voucherType: 'OPENING_STOCK', voucherNo: OPENING_STOCK_VOUCHER, isCancelled: false },
    select: { productId: true, warehouseId: true },
  });
  if (done.length) {
    console.log(`  opening stock already imported (${done.length} balances) — skipping`);
    return;
  }

  const levels = await prisma.stockLevel.findMany({ where: { companyId }, select: { productId: true, warehouseId: true, quantity: true } });
  const levelQty = new Map(levels.map((l) => [`${l.productId}|${l.warehouseId}`, new D(l.quantity)]));

  const ledgerRows: any[] = [];
  const newLevels: any[] = [];
  const changedLevels: Array<{ productId: string; warehouseId: string; quantity: Prisma.Decimal }> = [];
  let postedValue = new D(0);
  for (const r of all) {
    const pid = productId.get(r.key);
    const wid = warehouseId.get(r.godown.toLowerCase());
    if (!pid || !wid) {
      console.warn(`  ! no product/warehouse for "${r.key}" @ "${r.godown}" — run the masters step first`);
      continue;
    }
    const qty = new D(r.qty);
    const rate = new D(Math.abs(r.value / r.qty));
    const before = levelQty.get(`${pid}|${wid}`);
    const afterQty = (before || new D(0)).plus(qty);
    const valueDiff = qty.mul(rate);
    ledgerRows.push({
      companyId,
      productId: pid,
      warehouseId: wid,
      postingDate: stockDate,
      voucherType: 'OPENING_STOCK',
      voucherNo: OPENING_STOCK_VOUCHER,
      actualQty: qty,
      qtyAfterTransaction: afterQty,
      incomingRate: qty.gt(0) ? rate : null,
      outgoingRate: qty.lt(0) ? rate : null,
      valuationRate: rate,
      stockValue: afterQty.mul(rate),
      stockValueDifference: valueDiff,
      remarks: 'Opening stock imported from Tally',
    });
    if (before) changedLevels.push({ productId: pid, warehouseId: wid, quantity: afterQty });
    else newLevels.push({ companyId, productId: pid, warehouseId: wid, quantity: afterQty });
    postedValue = postedValue.plus(valueDiff);
  }

  // One transaction: stock ledger, stock levels and the GL entry land together or not at all.
  await prisma.$transaction(async (tx: any) => {
    for (const part of chunk(ledgerRows, 500)) await tx.stockLedgerEntry.createMany({ data: part });
    for (const part of chunk(newLevels, 500)) await tx.stockLevel.createMany({ data: part });
    for (const l of changedLevels) {
      await tx.stockLevel.update({ where: { productId_warehouseId: { productId: l.productId, warehouseId: l.warehouseId } }, data: { quantity: l.quantity } });
    }
    if (!postedValue.eq(0)) {
      const stock = await ensureLedgerAccount(tx, '1200', 'Stock In Hand', 'ASSET');
      const equity = await openingEquityAccount(tx);
      const amount = postedValue.abs();
      const stockIsDebit = postedValue.gt(0);
      await postToLedger(tx, {
        voucherType: 'STOCK_ENTRY',
        voucherId: `${OPENING_STOCK_VOUCHER}-${Date.now()}`,
        voucherNo: OPENING_STOCK_VOUCHER,
        postingDate: stockDate,
        lines: [
          { accountId: stock.id, debit: stockIsDebit ? amount : 0, credit: stockIsDebit ? 0 : amount, remarks: 'Opening stock from Tally' },
          { accountId: equity.id, debit: stockIsDebit ? 0 : amount, credit: stockIsDebit ? amount : 0, remarks: 'Opening stock from Tally' },
        ],
      });
    }
  }, { timeout: 600_000, maxWait: 60_000 });
  console.log(`  ✅ Opening stock done (${ledgerRows.length} balances, GL ₹${postedValue.toFixed(2)})`);
}

/** Mirrors imported opening balances into StockMovement, the table behind the Stock Movements page.
 * Nothing reads this table for balances, so this only adds history and doesn't change stock. */
async function importOpeningMovements(companyId: string, stockDate: Date, dryRun: boolean) {
  console.log('\n== Opening stock movements');
  const entries = await prisma.stockLedgerEntry.findMany({
    where: { companyId, voucherType: 'OPENING_STOCK', voucherNo: OPENING_STOCK_VOUCHER, isCancelled: false },
    select: { productId: true, warehouseId: true, actualQty: true, valuationRate: true },
  });
  const existing = await prisma.stockMovement.count({ where: { companyId, reference: OPENING_STOCK_VOUCHER } });
  console.log(`  ${entries.length} opening balances, ${existing} movements already imported`);
  if (dryRun) return;
  if (existing) {
    console.log('  opening movements already imported — skipping');
    return;
  }
  const rows = entries.map((e) => ({
    companyId,
    productId: e.productId,
    warehouseId: e.warehouseId,
    type: (new D(e.actualQty).lt(0) ? 'OUT' : 'IN') as 'IN' | 'OUT',
    quantity: new D(e.actualQty).abs(),
    unitCost: e.valuationRate,
    reference: OPENING_STOCK_VOUCHER,
    notes: 'Opening stock imported from Tally',
    createdAt: stockDate,
  }));
  await prisma.$transaction(async (tx: any) => {
    for (const part of chunk(rows, 500)) await tx.stockMovement.createMany({ data: part });
  }, { timeout: 300_000, maxWait: 60_000 });
  console.log(`  ✅ Opening stock movements done (${rows.length})`);
}

/** Vouchers already in the GL for these invoice ids, so a re-run only posts what is missing. */
async function postedVoucherIds(voucherType: GlVoucher['voucherType'], ids: string[]) {
  const posted = new Set<string>();
  for (const part of chunk(ids, 1000)) {
    const rows = await prisma.generalLedgerEntry.findMany({ where: { voucherType, voucherId: { in: part } }, select: { voucherId: true }, distinct: ['voucherId'] });
    for (const r of rows) posted.add(r.voucherId);
  }
  return posted;
}

async function importReceivables(companyId: string, bills: ParsedBill[], cutoverDate: Date, dryRun: boolean) {
  console.log('\n== Receivables (Bills.json)');
  const existing = await prisma.salesInvoice.findMany({ where: { companyId, tallyGuid: { startsWith: AR_GUID_PREFIX } }, select: { tallyGuid: true } });
  const seen = new Set(existing.map((e) => e.tallyGuid));
  const pending = bills.filter((b) => !seen.has(billGuid(AR_GUID_PREFIX, b)));
  const parties = new Set(bills.map((b) => b.party.toLowerCase()));
  const total = bills.reduce((s, b) => s + b.amount, 0);
  console.log(`  ${bills.length} bills, ${parties.size} customers, ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}; ${bills.length - pending.length} already imported, ${pending.length} to import`);
  if (dryRun) return;

  if (pending.length) {
    const { ids: customerIds, created } = await resolveParties(companyId, 'CUSTOMER', pending.map((b) => b.party));
    console.log(`  customers resolved (${created} created)`);
    for (const part of chunk(pending, 500)) {
      await prisma.salesInvoice.createMany({
        data: part.map((b) => ({
          companyId,
          invoiceNo: billInvoiceNo('AR', b),
          tallyGuid: billGuid(AR_GUID_PREFIX, b),
          tallyRawData: b.raw,
          customerId: customerIds.get(b.party.toLowerCase())!,
          date: b.date,
          dueDate: b.dueDate,
          submittedAt: b.date,
          status: 'SUBMITTED' as const,
          paymentStatus: (b.dueDate && b.dueDate < cutoverDate ? 'OVERDUE' : 'UNPAID') as any,
          subtotal: b.amount,
          total: b.amount,
          grandTotal: b.amount,
          outstandingAmount: b.amount,
          notes: `Opening balance imported from Tally (bill ref ${b.ref})`,
          tags: ['tally-opening'],
        })),
      });
    }
    console.log(`  ${pending.length} sales invoices created`);
  }

  const invoices = await prisma.salesInvoice.findMany({
    where: { companyId, tallyGuid: { startsWith: AR_GUID_PREFIX } },
    select: { id: true, invoiceNo: true, customerId: true, outstandingAmount: true, notes: true },
  });
  const posted = await postedVoucherIds('SALES_INVOICE', invoices.map((i) => i.id));
  const unposted = invoices.filter((i) => !posted.has(i.id));
  if (unposted.length) {
    const [ar, equity] = await prisma.$transaction(async (tx: any) => [
      await ensureLedgerAccount(tx, '1100', 'Accounts Receivable', 'ASSET'),
      await openingEquityAccount(tx),
    ]);
    await bulkPostLedger(cutoverDate, unposted.map((i) => {
      const amount = Number(i.outstandingAmount);
      const remarks = `Opening receivable ${i.invoiceNo}`;
      return {
        voucherType: 'SALES_INVOICE' as const,
        voucherId: i.id,
        voucherNo: i.invoiceNo,
        lines: [
          { accountId: ar.id, debit: amount, credit: 0, partyType: 'CUSTOMER' as const, partyId: i.customerId, invoiceId: i.id, remarks },
          { accountId: equity.id, debit: 0, credit: amount, remarks },
        ],
      };
    }));
  }
  console.log(`  ✅ Receivables done (${unposted.length} posted to GL)`);
}

async function importPayables(companyId: string, bills: ParsedBill[], cutoverDate: Date, dryRun: boolean) {
  console.log('\n== Payables (bills-pay.json)');
  const existing = await prisma.purchaseInvoice.findMany({ where: { companyId, tallyGuid: { startsWith: AP_GUID_PREFIX } }, select: { tallyGuid: true } });
  const seen = new Set(existing.map((e) => e.tallyGuid));
  const pending = bills.filter((b) => !seen.has(billGuid(AP_GUID_PREFIX, b)));
  const parties = new Set(bills.map((b) => b.party.toLowerCase()));
  const total = bills.reduce((s, b) => s + b.amount, 0);
  console.log(`  ${bills.length} bills, ${parties.size} suppliers, ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}; ${bills.length - pending.length} already imported, ${pending.length} to import`);
  if (dryRun) return;

  if (pending.length) {
    const { ids: supplierIds, created } = await resolveParties(companyId, 'SUPPLIER', pending.map((b) => b.party));
    console.log(`  suppliers resolved (${created} created)`);
    for (const part of chunk(pending, 500)) {
      await prisma.purchaseInvoice.createMany({
        data: part.map((b) => ({
          companyId,
          invoiceNo: billInvoiceNo('AP', b),
          supplierInvoiceNo: b.ref,
          tallyGuid: billGuid(AP_GUID_PREFIX, b),
          tallyRawData: b.raw,
          supplierId: supplierIds.get(b.party.toLowerCase())!,
          date: b.date,
          dueDate: b.dueDate,
          submittedAt: b.date,
          status: (b.dueDate && b.dueDate < cutoverDate ? 'OVERDUE' : 'SENT') as any,
          workflowStatus: 'SUBMITTED' as const,
          subtotal: b.amount,
          total: b.amount,
          baseTotal: b.amount,
          outstandingAmount: b.amount,
          notes: `Opening balance imported from Tally (bill ref ${b.ref})`,
        })),
      });
    }
    console.log(`  ${pending.length} purchase invoices created`);
  }

  const invoices = await prisma.purchaseInvoice.findMany({
    where: { companyId, tallyGuid: { startsWith: AP_GUID_PREFIX } },
    select: { id: true, invoiceNo: true, supplierId: true, outstandingAmount: true },
  });
  const posted = await postedVoucherIds('PURCHASE_INVOICE', invoices.map((i) => i.id));
  const unposted = invoices.filter((i) => !posted.has(i.id));
  if (unposted.length) {
    const [ap, equity] = await prisma.$transaction(async (tx: any) => [
      await ensureLedgerAccount(tx, '2000', 'Accounts Payable', 'LIABILITY'),
      await openingEquityAccount(tx),
    ]);
    await bulkPostLedger(cutoverDate, unposted.map((i) => {
      const amount = Number(i.outstandingAmount);
      const remarks = `Opening payable ${i.invoiceNo}`;
      return {
        voucherType: 'PURCHASE_INVOICE' as const,
        voucherId: i.id,
        voucherNo: i.invoiceNo,
        lines: [
          { accountId: equity.id, debit: amount, credit: 0, remarks },
          { accountId: ap.id, debit: 0, credit: amount, partyType: 'SUPPLIER' as const, partyId: i.supplierId, remarks },
        ],
      };
    }));
  }
  console.log(`  ✅ Payables done (${unposted.length} posted to GL)`);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs();
  const dbHost = (() => {
    try { return new URL(process.env.DATABASE_URL || '').host; } catch { return 'unknown'; }
  })();
  console.log(`Tally import -> database ${dbHost}${args.dryRun ? '  [DRY RUN — nothing will be written]' : ''}`);

  console.log('Reading files...');
  const master = parseMaster(path.join(args.dir, 'Master.json'));
  const receivables = parseBills(path.join(args.dir, 'Bills.json'));
  const payables = parseBills(path.join(args.dir, 'bills-pay.json'));
  console.log(
    `  Master: ${master.units.length} units, ${master.groups.length} stock groups, ${master.godowns.length} godowns, ${master.items.length} items ` +
    `(${master.items.filter((i) => i.opening.length).length} with opening stock)\n` +
    `  Receivables: ${receivables.length} bills | Payables: ${payables.length} bills`
  );

  const company = await prisma.company.findFirst({
    where: { OR: [{ slug: args.company }, { name: { equals: args.company, mode: 'insensitive' } }] },
  });
  if (!company) throw new Error(`Company "${args.company}" not found`);
  console.log(`Company: ${company.name} (${company.slug}, id ${company.id})`);

  await runWithTenant({ tenantId: company.tenantId, companyId: company.id, userId: 'tally-import' }, async () => {
    if (args.steps.has('masters')) await importMasters(company.id, company.tenantId, master, args.dryRun);
    if (args.steps.has('stock')) await importOpeningStock(company.id, master, args.stockDate, args.dryRun);
    if (args.steps.has('movements')) await importOpeningMovements(company.id, args.stockDate, args.dryRun);
    if (args.steps.has('bills')) {
      await importReceivables(company.id, receivables, args.cutoverDate, args.dryRun);
      await importPayables(company.id, payables, args.cutoverDate, args.dryRun);
    }
  });

  console.log(args.dryRun ? '\nDry run complete. Re-run without --dry-run to import.' : '\nTally import complete.');
}

main()
  .catch((e) => {
    console.error('Tally import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
