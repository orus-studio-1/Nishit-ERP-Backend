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
  let series = await client.numberingSeries.findFirst({ where: { tenantId: context?.tenantId, companyId: currentCompanyId(), branchId: context?.branchId, documentType, name: 'Default', isActive: true, isDefault: true } });
  if (!series) {
    series = await client.numberingSeries.create({ data: { tenantId: context?.tenantId, companyId: currentCompanyId(), branchId: context?.branchId, documentType, name: 'Default', pattern: '{PREFIX}{FY}{BRANCH}{SEQ}', prefix, digits, current: 0, resetPeriod: 'FISCAL_YEAR', isDefault: true, isActive: true } });
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
