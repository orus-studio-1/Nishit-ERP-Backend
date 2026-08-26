import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';

export type TenantContext = { tenantId?: string | null; companyId?: string | null; branchId?: string | null; userId?: string; requestId?: string };

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const tenantModels = new Set([
  'Account',
  'FiscalYear',
  'JournalEntry',
  'NumberingSeries',
  'Category',
  'Unit',
  'Product',
  'Warehouse',
  'StockLevel',
  'StockMovement',
  'StockLedgerEntry',
  'InventoryValuationLayer',
  'StockReservation',
  'StockEntry',
  'Batch',
  'SerialNumber',
  'PriceList',
  'ItemPrice',
  'PricingRule',
  'ProductUomConversion',
  'ProductAttribute',
  'ProductAttributeValue',
  'Department',
  'Position',
  'ShiftType',
  'LeaveType',
  'LeavePeriod',
  'LeavePolicy',
  'SalaryComponent',
  'SalaryStructure',
  'PayrollEntry',
  'CostCenter',
  'PeriodClosingVoucher',
  'FixedAsset',
  'JournalEntryTemplate',
  'RecurringJournalEntry',
  'Customer',
  'Supplier',
  'Quotation',
  'SalesOrder',
  'SalesInvoice',
  'DeliveryNote',
  'TaxTemplate',
  'Payment',
  'PaymentEntry',
  'CreditNote',
  'GeneralLedgerEntry',
  'Budget',
  'BankStatementLine',
  'PrintFormat',
  'SubscriptionTemplate',
  'AuditLog',
  'PurchaseOrder',
  'PurchaseInvoice',
  'BuyingSettings',
  'PaymentTermsTemplate',
  'SupplierItem',
  'MaterialRequest',
  'RequestForQuotation',
  'SupplierQuotation',
  'BlanketPurchaseOrder',
  'PurchaseReceipt',
  'QualityInspection',
  'LandedCostVoucher',
  'SupplierPayment',
  'SupplierCommunicationLog',
  'Lead',
  'Contact',
  'Opportunity',
  'Activity',
  'CrmOrganization',
  'CrmAssignmentRule',
  'LeadImportBatch',
  'CrmSavedView',
  'Project',
  'ProjectMember',
  'Task',
  'Milestone',
  'Document',
  'Comment',
  'Notification',
]);
for (const model of Prisma.dmmf.datamodel.models) {
  if (model.fields.some((field) => field.name === 'companyId')) tenantModels.add(model.name);
}
export const tenantIdModels = new Set(Prisma.dmmf.datamodel.models.filter((model) => model.fields.some((field) => field.name === 'tenantId')).map((model) => model.name.toLowerCase()));
const normalizedTenantModels = new Set(Array.from(tenantModels).map((model) => model.toLowerCase()));

const readOperations = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy']);

export function runWithTenant<T>(context: TenantContext | string | null | undefined, callback: () => T) {
  let store: TenantContext;
  if (typeof context === 'string') store = { companyId: context };
  else if (context == null) store = { companyId: null };
  else store = context;
  return tenantStorage.run(store, callback);
}

export function currentTenantContext() { return tenantStorage.getStore(); }

export function currentCompanyId() {
  return tenantStorage.getStore()?.companyId || null;
}

export function tenantWhere(companyId: string | null | undefined) {
  return companyId ? { companyId } : {};
}

export function applyTenantToPrismaArgs(model: string | undefined, operation: string, args: any) {
  const companyId = currentCompanyId();
  const tenantId = currentTenantContext()?.tenantId;
  if (!model) return args;
  const normalized = model.toLowerCase();
  const usesCompany = normalizedTenantModels.has(normalized);
  const usesTenant = tenantIdModels.has(normalized);
  if ((!usesCompany || !companyId) && (!usesTenant || !tenantId)) return args;
  const scope = { ...(usesTenant && tenantId ? { tenantId } : {}), ...(usesCompany && companyId ? { companyId } : {}) };

  if (readOperations.has(operation)) {
    return { ...args, where: { ...(args?.where || {}), ...scope } };
  }

  if (operation === 'create') {
    return { ...args, data: { ...(args?.data || {}), ...scope } };
  }

  if (operation === 'createMany') {
    const data = Array.isArray(args?.data) ? args.data : [];
    return { ...args, data: data.map((row: any) => ({ ...row, ...scope })) };
  }

  if (['update', 'delete', 'updateMany', 'deleteMany'].includes(operation)) {
    return { ...args, where: { ...(args?.where || {}), ...scope } };
  }

  if (operation === 'upsert') {
    return {
      ...args,
      where: { ...(args?.where || {}), ...scope },
      create: { ...(args?.create || {}), ...scope },
    };
  }

  return args;
}
