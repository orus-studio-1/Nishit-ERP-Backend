import prisma from '../lib/prisma';
import { currentCompanyId, currentTenantContext } from './tenant';

function tenantPrefix() {
  return (currentCompanyId() || 'GLOBAL').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
}

export async function allocateDocumentNo(documentType: string, prefix: string, digits = 6, client: any = prisma): Promise<string> {
  if (client === prisma) return prisma.$transaction((tx: any) => allocateDocumentNo(documentType, prefix, digits, tx));
  const context = currentTenantContext();
  const lockKey = `${context?.tenantId || 'GLOBAL'}:${currentCompanyId() || 'GLOBAL'}:${context?.branchId || 'ALL'}:${documentType}`;
  await client.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);
  const seriesWhere = { tenantId: context?.tenantId, companyId: currentCompanyId(), documentType, name: 'Default', isActive: true, isDefault: true };
  let series = await client.numberingSeries.findFirst({ where: { ...seriesWhere, branchId: context?.branchId } });
  // No series for this branch yet: use the company-wide one (no branch) if there is one, e.g. made
  // by a data import. Its numbers have the same format, so starting a second series at 1 would
  // hand out numbers that already exist.
  if (!series && context?.branchId) {
    series = await client.numberingSeries.findFirst({ where: { ...seriesWhere, branchId: null } });
  }
  // Never hand out a number below another series for the same document type and prefix (e.g. a
  // branch series and a company-wide series made by an import both produce CUST26-27xxxxx). If a
  // sibling is further ahead, continue after it instead of reissuing numbers that already exist.
  const siblings = await client.numberingSeries.findMany({ where: { tenantId: context?.tenantId, companyId: currentCompanyId(), documentType, prefix: series?.prefix ?? prefix, ...(series ? { id: { not: series.id } } : {}) }, select: { current: true } });
  const floor = siblings.reduce((max: number, s: { current: number }) => Math.max(max, s.current || 0), 0);
  if (!series) {
    series = await client.numberingSeries.create({ data: { tenantId: context?.tenantId, companyId: currentCompanyId(), branchId: context?.branchId, documentType, name: 'Default', pattern: '{PREFIX}{FY}{BRANCH}{SEQ}', prefix, digits, current: floor, resetPeriod: 'FISCAL_YEAR', isDefault: true, isActive: true } });
  } else if (floor > series.current) {
    series = await client.numberingSeries.update({ where: { id: series.id }, data: { current: floor } });
  }
  const updated = await client.numberingSeries.update({ where: { id: series.id }, data: { current: { increment: 1 } } });
  const now = new Date();
  const start = now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const fy = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
  const sequence = String(updated.current).padStart(updated.digits || digits, '0');
  return String(updated.pattern || '{PREFIX}{SEQ}')
    .replace('{PREFIX}', updated.prefix || prefix)
    .replace('{FY}', fy)
    .replace('{BRANCH}', updated.branch || '')
    .replace('{SEQ}', sequence)
    .replace(/\{SEQ:(\d+)\}/, (_: string, width: string) => String(updated.current).padStart(Number(width), '0')) + (updated.suffix || '');
}

export const generateInvoiceNo = (tx?: any) => allocateDocumentNo('SALES_INVOICE', 'INV', 6, tx || prisma);
export const generateOrderNo = (tx?: any) => allocateDocumentNo('SALES_ORDER', 'SO', 6, tx || prisma);
export const generatePONo = (tx?: any) => allocateDocumentNo('PURCHASE_ORDER', 'PO', 6, tx || prisma);
export const generateQuotationNo = (tx?: any) => allocateDocumentNo('QUOTATION', 'QT', 6, tx || prisma);
export const generateCustomerNo = (tx?: any) => allocateDocumentNo('CUSTOMER', 'CUST', 5, tx || prisma);
export const generateSupplierNo = (tx?: any) => allocateDocumentNo('SUPPLIER', 'SUPP', 5, tx || prisma);
export const generateEmployeeId = (tx?: any) => allocateDocumentNo('EMPLOYEE', 'EMP', 5, tx || prisma);
export const generateJournalNo = (tx?: any) => allocateDocumentNo('JOURNAL_ENTRY', 'JE', 6, tx || prisma);
export const generatePaymentNo = (tx?: any) => allocateDocumentNo('PAYMENT', 'PAY', 6, tx || prisma);
export const generatePurchaseInvoiceNo = (tx?: any) => allocateDocumentNo('PURCHASE_INVOICE', 'PINV', 6, tx || prisma);
