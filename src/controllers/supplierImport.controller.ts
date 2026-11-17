import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { generateSupplierNo } from '../utils/generate';
import { csvToObjects } from './crm/shared';

// Supplier CSV import. The preview checks every row without writing anything; the import then
// creates the rows that passed. Headers are matched loosely (case and spaces ignored, and common
// aliases such as "GSTIN" / "GST No" or "Pincode" / "Zip" are accepted).

const MAX_IMPORT_ROWS = 2000;
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_HEADERS = ['name', 'suppliername', 'supplier', 'companyname', 'partyname'];

type SupplierData = Record<string, any> & { name: string; taxId?: string };
type ImportRow = { rowNo: number; status: 'READY' | 'DUPLICATE' | 'ERROR'; message?: string; data: SupplierData };

const pickCell = (raw: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};
const yes = (value: string) => ['yes', 'y', 'true', '1'].includes(value.trim().toLowerCase());

function normalizeSupplierRow(raw: Record<string, string>) {
  const errors: string[] = [];
  const name = pickCell(raw, ...NAME_HEADERS);
  const email = pickCell(raw, 'email', 'emailid', 'emailaddress').toLowerCase();
  const taxId = pickCell(raw, 'gstin', 'gst', 'gstno', 'gstnumber', 'taxid').toUpperCase().replace(/\s/g, '');
  const pan = pickCell(raw, 'pan', 'panno', 'pannumber').toUpperCase().replace(/\s/g, '');
  const termsText = pickCell(raw, 'paymentterms', 'paymenttermsdays', 'creditdays', 'terms');
  const currency = (pickCell(raw, 'currency') || 'INR').toUpperCase();
  const paymentTerms = termsText ? Number(termsText) : 30;
  const msmeCategory = pickCell(raw, 'msmecategory');
  const validGstin = Boolean(taxId) && GSTIN_PATTERN.test(taxId);

  if (!name) errors.push('Name is required');
  if (email && !EMAIL_PATTERN.test(email)) errors.push(`Email "${email}" is not valid`);
  if (taxId && !validGstin) errors.push(`GSTIN "${taxId}" is not valid (15 characters, e.g. 27ABCDE1234F1Z5)`);
  if (pan && !PAN_PATTERN.test(pan)) errors.push(`PAN "${pan}" is not valid (e.g. ABCDE1234F)`);
  if (!Number.isInteger(paymentTerms) || paymentTerms < 0 || paymentTerms > 365) errors.push('Payment terms must be a whole number of days from 0 to 365');
  if (!/^[A-Z]{3}$/.test(currency)) errors.push(`Currency "${currency}" must be a 3-letter code such as INR`);

  const data: SupplierData = {
    name,
    email: email || undefined,
    phone: pickCell(raw, 'phone', 'mobile', 'phoneno', 'contactnumber') || undefined,
    address: pickCell(raw, 'address', 'address1', 'addressline1') || undefined,
    city: pickCell(raw, 'city') || undefined,
    state: pickCell(raw, 'state') || undefined,
    country: pickCell(raw, 'country') || 'India',
    zip: pickCell(raw, 'zip', 'pincode', 'pin', 'postalcode') || undefined,
    taxId: taxId || undefined,
    // A GSTIN contains the PAN (characters 3-12), so fill it in when only the GSTIN is given.
    pan: pan || (validGstin ? taxId.slice(2, 12) : undefined),
    panAvailable: Boolean(pan) || validGstin,
    currency,
    paymentTerms: Number.isInteger(paymentTerms) ? paymentTerms : 30,
    bankName: pickCell(raw, 'bankname', 'bank') || undefined,
    bankAccount: pickCell(raw, 'bankaccount', 'accountnumber', 'accountno') || undefined,
    msmeRegistered: yes(pickCell(raw, 'msme', 'msmeregistered')) || Boolean(msmeCategory),
    msmeCategory: msmeCategory || undefined,
    msmeRegistrationNo: pickCell(raw, 'msmeregistrationno', 'udyamno', 'udyam') || undefined,
    notes: pickCell(raw, 'notes', 'remarks') || undefined,
  };
  return { data, errors };
}

/** Checks every row: required fields, formats, and duplicates against existing suppliers and earlier rows. */
async function checkSupplierCsv(csvText: unknown): Promise<{ rows?: ImportRow[]; error?: string }> {
  const text = String(csvText || '').replace(/^﻿/, '');
  if (!text.trim()) return { error: 'The CSV file is empty' };
  const parsed = csvToObjects(text);
  if (!parsed.length) return { error: 'The CSV file has a header row but no supplier rows' };
  if (parsed.length > MAX_IMPORT_ROWS) return { error: `A file can have at most ${MAX_IMPORT_ROWS} suppliers; this one has ${parsed.length}. Split it into smaller files.` };
  if (!Object.keys(parsed[0].raw).some((header) => NAME_HEADERS.includes(header))) {
    return { error: 'The CSV must have a "Name" column. Download the template to see the expected columns.' };
  }

  const existing = await prisma.supplier.findMany({ select: { name: true, taxId: true, supplierNo: true } });
  const byName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s.supplierNo]));
  const byTaxId = new Map(existing.filter((s) => s.taxId).map((s) => [String(s.taxId).toUpperCase(), s.supplierNo]));
  const seenNames = new Map<string, number>();
  const seenTaxIds = new Map<string, number>();

  const rows = parsed.map(({ rowNo, raw }): ImportRow => {
    const { data, errors } = normalizeSupplierRow(raw);
    if (errors.length) return { rowNo, status: 'ERROR', message: errors.join('; '), data };
    const nameKey = data.name.toLowerCase();
    if (byName.has(nameKey)) return { rowNo, status: 'DUPLICATE', message: `Supplier "${data.name}" already exists (${byName.get(nameKey)})`, data };
    if (data.taxId && byTaxId.has(data.taxId)) return { rowNo, status: 'DUPLICATE', message: `GSTIN ${data.taxId} already belongs to supplier ${byTaxId.get(data.taxId)}`, data };
    if (seenNames.has(nameKey)) return { rowNo, status: 'DUPLICATE', message: `Same name as row ${seenNames.get(nameKey)} in this file`, data };
    if (data.taxId && seenTaxIds.has(data.taxId)) return { rowNo, status: 'DUPLICATE', message: `Same GSTIN as row ${seenTaxIds.get(data.taxId)} in this file`, data };
    seenNames.set(nameKey, rowNo);
    if (data.taxId) seenTaxIds.set(data.taxId, rowNo);
    return { rowNo, status: 'READY', data };
  });
  return { rows };
}

const summarize = (rows: ImportRow[]) => ({
  totalRows: rows.length,
  readyRows: rows.filter((r) => r.status === 'READY').length,
  duplicateRows: rows.filter((r) => r.status === 'DUPLICATE').length,
  errorRows: rows.filter((r) => r.status === 'ERROR').length,
});

export const previewSupplierImport = async (req: Request, res: Response) => {
  try {
    const checked = await checkSupplierCsv(req.body.csvText);
    if (checked.error) return error(res, checked.error, 400, undefined, 'IMPORT_INVALID');
    return success(res, { ...summarize(checked.rows!), rows: checked.rows });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const importSuppliers = async (req: Request, res: Response) => {
  try {
    const checked = await checkSupplierCsv(req.body.csvText);
    if (checked.error) return error(res, checked.error, 400, undefined, 'IMPORT_INVALID');
    const rows = checked.rows!;
    const ready = rows.filter((r) => r.status === 'READY');
    if (!ready.length) return error(res, 'No new suppliers to import. Every row is a duplicate or has an error; check the preview.', 400, undefined, 'IMPORT_NOTHING_TO_DO');

    const created: Array<{ rowNo: number; supplierNo: string; name: string }> = [];
    const failed: Array<{ rowNo: number; message: string }> = [];
    for (const row of ready) {
      try {
        const supplierNo = await generateSupplierNo();
        const supplier = await prisma.supplier.create({ data: { ...row.data, supplierNo } as any });
        created.push({ rowNo: row.rowNo, supplierNo: supplier.supplierNo, name: supplier.name });
      } catch (rowErr: any) {
        failed.push({ rowNo: row.rowNo, message: rowErr?.code === 'P2002' ? 'Duplicate value' : 'Could not be saved' });
      }
    }
    const summary = summarize(rows);
    const parts = [
      `${created.length} supplier(s) imported`,
      summary.duplicateRows ? `${summary.duplicateRows} duplicate(s) skipped` : '',
      summary.errorRows ? `${summary.errorRows} row(s) with errors skipped` : '',
      failed.length ? `${failed.length} failed` : '',
    ].filter(Boolean);
    return success(res, {
      ...summary,
      createdRows: created.length,
      failedRows: failed.length,
      created,
      failed,
      skipped: rows.filter((r) => r.status !== 'READY').map((r) => ({ rowNo: r.rowNo, status: r.status, message: r.message })),
    }, parts.join(', '), 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
