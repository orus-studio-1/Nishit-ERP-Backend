import { createHash } from 'crypto';
import { generateCustomerNo, generateSupplierNo } from '../../utils/generate';

export interface ResolveResult {
  id: string;
  created: boolean;
}

/** Collapses internal whitespace and trims. Used as the canonical comparison/storage form for Tally party & item names. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

/**
 * Serializes find-or-create for a given (companyId, entityType, key) using a Postgres
 * advisory lock scoped to the transaction, so two concurrent syncs for the same party/item
 * can't both pass the "not found" check and create duplicates. Mirrors the locking pattern
 * already used by allocateDocumentNo in utils/generate.ts.
 */
async function withEntityLock<T>(
  client: any,
  companyId: string,
  entityType: string,
  key: string,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  return client.$transaction(async (tx: any) => {
    const lockKey = `tally-entity:${companyId}:${entityType}:${key}`;
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);
    return fn(tx);
  });
}

async function upsertMap(tx: any, companyId: string, entityType: string, tallyKey: string, erpId: string) {
  const existing = await tx.tallyEntityMap.findFirst({ where: { companyId, entityType, tallyKey } });
  if (!existing) {
    await tx.tallyEntityMap.create({ data: { companyId, entityType, tallyKey, erpId } });
  } else if (existing.erpId !== erpId) {
    await tx.tallyEntityMap.update({ where: { id: existing.id }, data: { erpId } });
  }
}

export async function findOrCreateCustomer(
  client: any,
  companyId: string,
  rawName: string | null | undefined
): Promise<ResolveResult | null> {
  const name = normalizeName(rawName);
  if (!name) return null;
  const key = name.toLowerCase();

  return withEntityLock(client, companyId, 'CUSTOMER', key, async (tx) => {
    const map = await tx.tallyEntityMap.findFirst({ where: { companyId, entityType: 'CUSTOMER', tallyKey: key } });
    if (map) {
      const existing = await tx.customer.findFirst({ where: { id: map.erpId, companyId } });
      if (existing) return { id: existing.id, created: false };
    }

    const found = await tx.customer.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true }
    });
    if (found) {
      await upsertMap(tx, companyId, 'CUSTOMER', key, found.id);
      return { id: found.id, created: false };
    }

    const customerNo = await generateCustomerNo(tx);
    const created = await tx.customer.create({
      data: { companyId, customerNo, name, currency: 'INR' },
      select: { id: true }
    });
    console.log(`[TallySync] Created customer "${name}" from Tally`);
    await upsertMap(tx, companyId, 'CUSTOMER', key, created.id);
    return { id: created.id, created: true };
  });
}

export async function findOrCreateSupplier(
  client: any,
  companyId: string,
  rawName: string | null | undefined
): Promise<ResolveResult | null> {
  const name = normalizeName(rawName);
  if (!name) return null;
  const key = name.toLowerCase();

  return withEntityLock(client, companyId, 'SUPPLIER', key, async (tx) => {
    const map = await tx.tallyEntityMap.findFirst({ where: { companyId, entityType: 'SUPPLIER', tallyKey: key } });
    if (map) {
      const existing = await tx.supplier.findFirst({ where: { id: map.erpId, companyId } });
      if (existing) return { id: existing.id, created: false };
    }

    const found = await tx.supplier.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true }
    });
    if (found) {
      await upsertMap(tx, companyId, 'SUPPLIER', key, found.id);
      return { id: found.id, created: false };
    }

    const supplierNo = await generateSupplierNo(tx);
    const created = await tx.supplier.create({
      data: { companyId, supplierNo, name, currency: 'INR' },
      select: { id: true }
    });
    console.log(`[TallySync] Created supplier "${name}" from Tally`);
    await upsertMap(tx, companyId, 'SUPPLIER', key, created.id);
    return { id: created.id, created: true };
  });
}

export interface ProductHints {
  unit?: string | null;
  rate?: number | null;
}

/**
 * Finds or creates a basic Product master from a Tally stock item name. Only safe/generic
 * fields are populated (name, sku, unit, rate-as-salePrice); tax/HSN/accounting fields are
 * intentionally left at their schema defaults ("pending configuration") rather than guessed.
 */
export async function findOrCreateProduct(
  client: any,
  companyId: string,
  rawName: string | null | undefined,
  hints: ProductHints = {}
): Promise<ResolveResult | null> {
  const name = normalizeName(rawName);
  if (!name) return null;
  const key = name.toLowerCase();

  return withEntityLock(client, companyId, 'PRODUCT', key, async (tx) => {
    const map = await tx.tallyEntityMap.findFirst({ where: { companyId, entityType: 'PRODUCT', tallyKey: key } });
    if (map) {
      const existing = await tx.product.findFirst({ where: { id: map.erpId, companyId } });
      if (existing) return { id: existing.id, created: false };
    }

    const found = await tx.product.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true }
    });
    if (found) {
      await upsertMap(tx, companyId, 'PRODUCT', key, found.id);
      return { id: found.id, created: false };
    }

    let unitId: string | undefined;
    const unitName = normalizeName(hints.unit);
    if (unitName) {
      const unit = await tx.unit.upsert({
        where: { companyId_name: { companyId, name: unitName } },
        update: {},
        create: { companyId, name: unitName, symbol: unitName }
      });
      unitId = unit.id;
    }

    const skuBase = key.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').toUpperCase().slice(0, 40) || 'ITEM';
    const skuHash = createHash('sha1').update(key).digest('hex').slice(0, 6).toUpperCase();
    const sku = `TALLY-${skuBase}-${skuHash}`;
    const rate = typeof hints.rate === 'number' && Number.isFinite(hints.rate) ? Math.abs(hints.rate) : 0;

    const created = await tx.product.create({
      data: {
        companyId,
        sku,
        name,
        unitId,
        salePrice: rate,
        costPrice: 0,
        maintainStock: false
      },
      select: { id: true }
    });
    console.log(`[TallySync] Created item "${name}" from Tally (pending full configuration)`);
    await upsertMap(tx, companyId, 'PRODUCT', key, created.id);
    return { id: created.id, created: true };
  });
}
