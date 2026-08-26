-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AccessEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "public"."AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."ActivityStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'FOLLOW_UP', 'STATUS_CHANGE', 'IMPORT', 'CONVERSION');

-- CreateEnum
CREATE TYPE "public"."AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "public"."CheckinType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "public"."CommunicationChannel" AS ENUM ('EMAIL', 'PHONE', 'PORTAL', 'NOTE');

-- CreateEnum
CREATE TYPE "public"."CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."CreditNoteReason" AS ENUM ('SALES_RETURN', 'RATE_ADJUSTMENT', 'DISCOUNT', 'TAX_CORRECTION', 'FULL_REVERSAL', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."CrmSyncStatus" AS ENUM ('NOT_SYNCED', 'QUEUED', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE');

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('QUOTATION', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE', 'PAYMENT_ENTRY', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_INVOICE', 'EMPLOYEE', 'ATTENDANCE', 'LEAVE_APPLICATION', 'PAYROLL_ENTRY', 'SALARY_SLIP', 'EMPLOYEE_LIFECYCLE', 'STOCK_ENTRY', 'MATERIAL_REQUEST', 'REQUEST_FOR_QUOTATION', 'SUPPLIER_QUOTATION', 'PURCHASE_RECEIPT', 'LANDED_COST_VOUCHER', 'BLANKET_PURCHASE_ORDER', 'QUALITY_INSPECTION', 'BUYING_SETTINGS', 'CUSTOMER', 'SUPPLIER', 'JOURNAL_ENTRY', 'PAYMENT', 'SUPPLIER_PAYMENT');

-- CreateEnum
CREATE TYPE "public"."EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED', 'PROBATION');

-- CreateEnum
CREATE TYPE "public"."EntryStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "public"."FixedAssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "public"."InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CREDITED');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."JournalEntryType" AS ENUM ('STANDARD', 'OPENING', 'CLOSING', 'RECURRING', 'EXCHANGE_REVALUATION', 'DEPRECIATION');

-- CreateEnum
CREATE TYPE "public"."LandedCostAllocationBasis" AS ENUM ('VALUE', 'QUANTITY', 'WEIGHT');

-- CreateEnum
CREATE TYPE "public"."LandedCostChargeType" AS ENUM ('FREIGHT', 'CUSTOMS', 'INSURANCE', 'HANDLING', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."LeadImportRowStatus" AS ENUM ('CREATED', 'SKIPPED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "public"."LeadImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'EMAIL', 'PHONE', 'ADVERTISEMENT', 'OTHER', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "public"."LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "public"."LeaveLedgerEntryType" AS ENUM ('ALLOCATION', 'APPLICATION', 'ENCASHMENT', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."LedgerVoucherType" AS ENUM ('SALES_INVOICE', 'PAYMENT_ENTRY', 'CREDIT_NOTE', 'CANCELLATION', 'JOURNAL_ENTRY', 'PURCHASE_INVOICE', 'STOCK_ENTRY', 'PERIOD_CLOSING', 'EXCHANGE_REVALUATION', 'ASSET_DEPRECIATION', 'PURCHASE_RECEIPT', 'SUPPLIER_PAYMENT', 'LANDED_COST_VOUCHER');

-- CreateEnum
CREATE TYPE "public"."LifecycleEventStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."LifecycleEventType" AS ENUM ('ONBOARDING', 'PROMOTION', 'TRANSFER', 'SEPARATION');

-- CreateEnum
CREATE TYPE "public"."MaterialRequestSource" AS ENUM ('MANUAL', 'REORDER', 'PROJECT');

-- CreateEnum
CREATE TYPE "public"."MaterialRequestType" AS ENUM ('PURCHASE', 'TRANSFER', 'MANUFACTURE');

-- CreateEnum
CREATE TYPE "public"."MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "public"."MovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'RETURN');

-- CreateEnum
CREATE TYPE "public"."NumberingResetPeriod" AS ENUM ('NEVER', 'FISCAL_YEAR', 'MONTHLY');

-- CreateEnum
CREATE TYPE "public"."OpportunityStage" AS ENUM ('PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "public"."PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "public"."PaymentAllocationType" AS ENUM ('INVOICE', 'ADVANCE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "public"."PaymentEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'CHEQUE', 'ONLINE', 'CARD', 'UPI');

-- CreateEnum
CREATE TYPE "public"."PaymentType" AS ENUM ('RECEIVED', 'MADE');

-- CreateEnum
CREATE TYPE "public"."PayrollEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PayrollItemType" AS ENUM ('EARNING', 'DEDUCTION', 'TAX');

-- CreateEnum
CREATE TYPE "public"."PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PermissionAction" AS ENUM ('READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'AMEND', 'APPROVE', 'EXPORT', 'IMPORT', 'PRINT', 'REPORT', 'MANAGE');

-- CreateEnum
CREATE TYPE "public"."PrintFormatDocType" AS ENUM ('SALES_INVOICE', 'CREDIT_NOTE', 'PAYMENT_ENTRY');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."ProductType" AS ENUM ('PRODUCT', 'SERVICE', 'DIGITAL');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'RECEIVING', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."QualityInspectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."ReconciliationStatus" AS ENUM ('UNRECONCILED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "public"."RecurrenceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "public"."RfqStatus" AS ENUM ('DRAFT', 'SENT', 'QUOTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RfqSupplierStatus" AS ENUM ('PENDING', 'SENT', 'RESPONDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "public"."SalaryComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'TAX', 'BENEFIT');

-- CreateEnum
CREATE TYPE "public"."SalarySlipStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SalaryType" AS ENUM ('HOURLY', 'DAILY', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "public"."SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."SerialNumberStatus" AS ENUM ('AVAILABLE', 'DELIVERED', 'RESERVED', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "public"."ShiftAssignmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."StockEntryPurpose" AS ENUM ('MATERIAL_RECEIPT', 'MATERIAL_ISSUE', 'MATERIAL_TRANSFER', 'STOCK_RECONCILIATION', 'OPENING_STOCK', 'REPACK');

-- CreateEnum
CREATE TYPE "public"."StockReservationStatus" AS ENUM ('ACTIVE', 'PARTIAL', 'FULFILLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "public"."SupplierPaymentType" AS ENUM ('ADVANCE', 'INVOICE_PAYMENT');

-- CreateEnum
CREATE TYPE "public"."SupplierQuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TaxChargeType" AS ENUM ('ON_NET_TOTAL', 'ON_PREVIOUS_ROW_AMOUNT', 'ON_PREVIOUS_ROW_TOTAL');

-- CreateEnum
CREATE TYPE "public"."TaxTemplateScope" AS ENUM ('ITEM', 'INVOICE', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE', 'ACCOUNTANT', 'HR_MANAGER', 'SALES_REP', 'PURCHASE_MANAGER', 'HR_OFFICER', 'PAYROLL_OFFICER');

-- CreateEnum
CREATE TYPE "public"."ValuationMethod" AS ENUM ('FIFO', 'MOVING_AVERAGE', 'STANDARD');

-- CreateEnum
CREATE TYPE "public"."WarehouseType" AS ENUM ('COMPANY', 'BRANCH', 'ROOM', 'BIN', 'WAREHOUSE');

-- CreateTable
CREATE TABLE "public"."AccessAuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorId" TEXT,
    "targetUserId" TEXT,
    "targetRoleId" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AccessRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."AccountType" NOT NULL,
    "subType" TEXT,
    "parentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rootType" "public"."AccountType",
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "freezeAccount" BOOLEAN NOT NULL DEFAULT false,
    "frozenTillDate" TIMESTAMP(3),
    "isDefaultCash" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultBank" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultReceivable" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPayable" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultTax" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultRoundOff" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultRetainedEarnings" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Activity" (
    "id" TEXT NOT NULL,
    "type" "public"."ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "public"."ActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "leadId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "organizationId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "hoursWorked" DOUBLE PRECISION,
    "status" "public"."AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "entityType" "public"."DocumentType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "statusBefore" TEXT,
    "statusAfter" TEXT,
    "message" TEXT,
    "diff" JSONB,
    "invoiceId" TEXT,
    "deliveryNoteId" TEXT,
    "creditNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankStatementLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,6),
    "matchedLedgerEntryId" TEXT,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Batch" (
    "id" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "expiryDate" TIMESTAMP(3),
    "manufacturingDate" TIMESTAMP(3),
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BlanketPurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "agreementNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlanketPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BlanketPurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "blanketPurchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "orderedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,6) NOT NULL,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,

    CONSTRAINT "BlanketPurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Budget" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "periodId" TEXT,
    "amount" DECIMAL(18,6) NOT NULL,
    "enforce" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuyingSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "defaultBuyingPriceListId" TEXT,
    "requirePurchaseOrderForInvoice" BOOLEAN NOT NULL DEFAULT false,
    "requirePurchaseReceiptForInvoice" BOOLEAN NOT NULL DEFAULT false,
    "defaultRfqTerms" TEXT,
    "overReceiptAllowancePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "overBillingAllowancePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "autoCreateMaterialRequest" BOOLEAN NOT NULL DEFAULT true,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "zip" TEXT,
    "taxId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "logo" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contact" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "company" TEXT,
    "position" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "leadId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "seriesId" TEXT,
    "customerId" TEXT NOT NULL,
    "originalInvoiceId" TEXT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" "public"."CreditNoteReason" NOT NULL DEFAULT 'OTHER',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditNoteItem" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "description" TEXT,
    "hsnCode" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditNoteTax" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "taxTemplateLineId" TEXT,
    "accountId" TEXT,
    "label" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxableAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rowOrder" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,

    CONSTRAINT "CreditNoteTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmAssignmentRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "source" "public"."LeadSource",
    "city" TEXT,
    "country" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "assignToId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmOrganization" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "zip" TEXT,
    "ownerId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CrmSavedView" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "columns" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "contactId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "zip" TEXT,
    "taxId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "creditLimit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryNote" (
    "id" TEXT NOT NULL,
    "deliveryNo" TEXT NOT NULL,
    "seriesId" TEXT,
    "customerId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "warehouseId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postingDate" TIMESTAMP(3),
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryNoteItem" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "deliveredQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "managerId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "url" TEXT NOT NULL,
    "size" INTEGER,
    "projectId" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Employee" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "positionId" TEXT,
    "managerId" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "terminatedDate" TIMESTAMP(3),
    "salary" DOUBLE PRECISION NOT NULL,
    "salaryType" "public"."SalaryType" NOT NULL DEFAULT 'MONTHLY',
    "bankAccount" TEXT,
    "bankName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "status" "public"."EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "branch" TEXT,
    "companyEmail" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "employmentType" TEXT,
    "gender" TEXT,
    "grade" TEXT,
    "maritalStatus" TEXT,
    "noticePeriodDays" INTEGER,
    "personalEmail" TEXT,
    "workLocation" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployeeCheckin" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "logType" "public"."CheckinType" NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "attendanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployeeLifecycleEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "public"."LifecycleEventType" NOT NULL,
    "status" "public"."LifecycleEventStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "previousDepartmentId" TEXT,
    "newDepartmentId" TEXT,
    "previousPositionId" TEXT,
    "newPositionId" TEXT,
    "previousSalary" DECIMAL(18,6),
    "newSalary" DECIMAL(18,6),
    "reason" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FiscalYear" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FixedAsset" (
    "id" TEXT NOT NULL,
    "assetNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accumulatedDepreciationAccountId" TEXT,
    "depreciationExpenseAccountId" TEXT,
    "purchaseInvoiceId" TEXT,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "salvageValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "public"."DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "status" "public"."FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GeneralLedgerEntry" (
    "id" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT,
    "voucherType" "public"."LedgerVoucherType" NOT NULL,
    "voucherId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentEntryId" TEXT,
    "creditNoteId" TEXT,
    "debit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "remarks" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fiscalYearId" TEXT,
    "periodId" TEXT,
    "partyType" "public"."PartyType",
    "partyId" TEXT,
    "costCenterId" TEXT,
    "voucherLineId" TEXT,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "debitBase" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "creditBase" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxType" TEXT,
    "reconciliationStatus" "public"."ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "bankStatementLineId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "companyId" TEXT,

    CONSTRAINT "GeneralLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Holiday" (
    "id" TEXT NOT NULL,
    "holidayListId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "isWeeklyOff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HolidayList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryValuationLayer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "sourceLedgerEntryId" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalQty" DECIMAL(18,6) NOT NULL,
    "remainingQty" DECIMAL(18,6) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "InventoryValuationLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ItemPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "unitId" TEXT,
    "customerId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "price" DECIMAL(18,6) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "status" "public"."EntryStatus" NOT NULL DEFAULT 'DRAFT',
    "totalDebit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "entryType" "public"."JournalEntryType" NOT NULL DEFAULT 'STANDARD',
    "fiscalYearId" TEXT,
    "periodId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalEntryTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "JournalEntryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalEntryTemplateLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "debitAccountId" TEXT,
    "creditAccountId" TEXT,
    "debit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "JournalEntryTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "debitAccountId" TEXT,
    "creditAccountId" TEXT,
    "debit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "costCenterId" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostAllocation" (
    "id" TEXT NOT NULL,
    "landedCostVoucherId" TEXT NOT NULL,
    "purchaseReceiptItemId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "LandedCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostCharge" (
    "id" TEXT NOT NULL,
    "landedCostVoucherId" TEXT NOT NULL,
    "type" "public"."LandedCostChargeType" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,6) NOT NULL,
    "accountId" TEXT,

    CONSTRAINT "LandedCostCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostVoucher" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "voucherNo" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "allocationBasis" "public"."LandedCostAllocationBasis" NOT NULL DEFAULT 'VALUE',
    "totalCharges" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandedCostVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Lead" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "source" "public"."LeadSource" NOT NULL DEFAULT 'OTHER',
    "status" "public"."LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "value" DOUBLE PRECISION,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lostReason" TEXT,
    "importBatchId" TEXT,
    "importRowNo" INTEGER,
    "lastContactedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "city" TEXT,
    "country" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeadImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "fileName" TEXT NOT NULL,
    "status" "public"."LeadImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeadImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "status" "public"."LeadImportRowStatus" NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "leadId" TEXT,
    "error" TEXT,
    "duplicateLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeaveAllocation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leavePeriodId" TEXT,
    "allocated" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeaveLedgerEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leaveRequestId" TEXT,
    "entryType" "public"."LeaveLedgerEntryType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaves" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeavePeriod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "LeavePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeavePolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeavePolicyAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leavePolicyId" TEXT NOT NULL,
    "leavePeriodId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeavePolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeavePolicyDetail" (
    "id" TEXT NOT NULL,
    "leavePolicyId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "annualAllocation" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "LeavePolicyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "public"."LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysAllowed" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "requestNo" TEXT NOT NULL,
    "type" "public"."MaterialRequestType" NOT NULL DEFAULT 'PURCHASE',
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "public"."MaterialRequestSource" NOT NULL DEFAULT 'MANUAL',
    "requiredBy" TIMESTAMP(3),
    "requestedById" TEXT,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialRequestItem" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "orderedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "requiredBy" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Milestone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "public"."MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NumberingSeries" (
    "id" TEXT NOT NULL,
    "documentType" "public"."DocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "prefix" TEXT,
    "current" INTEGER NOT NULL DEFAULT 0,
    "digits" INTEGER NOT NULL DEFAULT 5,
    "resetPeriod" "public"."NumberingResetPeriod" NOT NULL DEFAULT 'FISCAL_YEAR',
    "fiscalYearId" TEXT,
    "branch" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "NumberingSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stage" "public"."OpportunityStage" NOT NULL DEFAULT 'PROSPECTING',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedClose" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "customerId" TEXT,
    "lostReason" TEXT,
    "erpSyncStatus" "public"."CrmSyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
    "erpSyncError" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "quotationId" TEXT,
    "salesOrderId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OpportunityItem" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "productId" TEXT,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "type" "public"."PaymentType" NOT NULL,
    "customerId" TEXT,
    "invoiceId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,6) NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "companyId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentEntry" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "seriesId" TEXT,
    "status" "public"."PaymentEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "public"."PaymentType" NOT NULL,
    "customerId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "allocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" "public"."PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PaymentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentEntryAllocation" (
    "id" TEXT NOT NULL,
    "paymentEntryId" TEXT NOT NULL,
    "allocationType" "public"."PaymentAllocationType" NOT NULL DEFAULT 'INVOICE',
    "invoiceId" TEXT,
    "creditNoteId" TEXT,
    "allocatedAmount" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEntryAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentTerm" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percentage" DECIMAL(9,4) NOT NULL,
    "dueAfterDays" INTEGER NOT NULL DEFAULT 0,
    "milestone" TEXT,
    "rowOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentTermsTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTermsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payroll" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basicSalary" DOUBLE PRECISION NOT NULL,
    "allowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSalary" DOUBLE PRECISION NOT NULL,
    "status" "public"."PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "payDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayrollEntry" (
    "id" TEXT NOT NULL,
    "payrollNo" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."PayrollEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalDeduction" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayrollItem" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "type" "public"."PayrollItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Period" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PeriodClosingVoucher" (
    "id" TEXT NOT NULL,
    "closingNo" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "retainedEarningsAccountId" TEXT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PeriodClosingVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" "public"."PermissionAction" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Position" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "description" TEXT,
    "minSalary" DOUBLE PRECISION,
    "maxSalary" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "selling" BOOLEAN NOT NULL DEFAULT true,
    "buying" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceListId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "customerId" TEXT,
    "minQty" DECIMAL(18,6),
    "maxQty" DECIMAL(18,6),
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "marginPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PrintFormat" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" "public"."PrintFormatDocType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "template" JSONB NOT NULL,
    "letterhead" JSONB,
    "footer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "PrintFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "unitId" TEXT,
    "type" "public"."ProductType" NOT NULL DEFAULT 'PRODUCT',
    "costPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "minStockLevel" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "maxStockLevel" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "image" TEXT,
    "barcode" TEXT,
    "weight" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultTaxTemplateId" TEXT,
    "hsnCode" TEXT,
    "taxCode" TEXT,
    "valuationMethod" "public"."ValuationMethod" NOT NULL DEFAULT 'MOVING_AVERAGE',
    "maintainStock" BOOLEAN NOT NULL DEFAULT true,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "hasBatchNo" BOOLEAN NOT NULL DEFAULT false,
    "hasSerialNo" BOOLEAN NOT NULL DEFAULT false,
    "reorderLevel" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "brand" TEXT,
    "manufacturer" TEXT,
    "defaultWarehouseId" TEXT,
    "isVariant" BOOLEAN NOT NULL DEFAULT false,
    "variantOfId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductAttribute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductAttributeValue" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "productId" TEXT,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductUomConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromUnitId" TEXT NOT NULL,
    "toUnitId" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "ProductUomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DOUBLE PRECISION,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "companyId" TEXT,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "purchaseReceiptId" TEXT,
    "workflowStatus" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "shippingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseTotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,

    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "materialRequestId" TEXT,
    "rfqId" TEXT,
    "supplierQuotationId" TEXT,
    "blanketPurchaseOrderId" TEXT,
    "workflowStatus" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "shippingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseTotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "advancePaid" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "receivedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "billedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "paymentTermsTemplateId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "amendedFromId" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "supplierItemCode" TEXT,
    "supplierItemName" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "receiptNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "landedCostAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseReceiptItem" (
    "id" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "description" TEXT,
    "receivedQty" DECIMAL(18,6) NOT NULL,
    "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "landedCostShare" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "batchNo" TEXT,
    "serialNo" TEXT,
    "qualityStatus" "public"."QualityInspectionStatus",

    CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QualityInspection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "inspectionNo" TEXT NOT NULL,
    "purchaseReceiptId" TEXT,
    "productId" TEXT,
    "status" "public"."QualityInspectionStatus" NOT NULL DEFAULT 'PENDING',
    "inspectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "inspectedById" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Quotation" (
    "id" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "status" "public"."QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecurringJournalEntry" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "frequency" "public"."RecurrenceFrequency" NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "RecurringJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestForQuotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "rfqNo" TEXT NOT NULL,
    "materialRequestId" TEXT,
    "status" "public"."RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "terms" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestForQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestForQuotationItem" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "description" TEXT,
    "requiredBy" TIMESTAMP(3),

    CONSTRAINT "RequestForQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestForQuotationSupplier" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "email" TEXT,
    "status" "public"."RfqSupplierStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "RequestForQuotationSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "public"."AccessEffect" NOT NULL DEFAULT 'ALLOW',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalaryComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."SalaryComponentType" NOT NULL,
    "description" TEXT,
    "defaultAmount" DECIMAL(18,6),
    "formula" TEXT,
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalarySlip" (
    "id" TEXT NOT NULL,
    "slipNo" TEXT NOT NULL,
    "payrollEntryId" TEXT,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "public"."SalarySlipStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "grossPay" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalDeduction" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "paymentDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalarySlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalarySlipItem" (
    "id" TEXT NOT NULL,
    "salarySlipId" TEXT NOT NULL,
    "salaryComponentId" TEXT,
    "type" "public"."SalaryComponentType" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalarySlipItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalaryStructure" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalaryStructureAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "baseSalary" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryStructureAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalaryStructureComponent" (
    "id" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "salaryComponentId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "formula" TEXT,
    "idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalaryStructureComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amendedFromId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "grandTotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "paymentStatus" "public"."InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "roundingAdjustment" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "seriesId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryNoteId" TEXT,
    "createdById" TEXT,
    "assignedToId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyId" TEXT,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesInvoiceItem" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hsnCode" TEXT,
    "itemCode" TEXT NOT NULL DEFAULT '',
    "netAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,6) NOT NULL,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxCode" TEXT,
    "taxTemplateId" TEXT,
    "uomId" TEXT,

    CONSTRAINT "SalesInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesInvoiceItemTax" (
    "id" TEXT NOT NULL,
    "salesInvoiceItemId" TEXT NOT NULL,
    "taxTemplateLineId" TEXT,
    "label" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxableAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rowOrder" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,

    CONSTRAINT "SalesInvoiceItemTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesInvoiceTax" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "taxTemplateLineId" TEXT,
    "accountId" TEXT,
    "label" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "taxableAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rowOrder" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,

    CONSTRAINT "SalesInvoiceTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "status" "public"."SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerPoNo" TEXT,
    "sourceWarehouseId" TEXT,
    "deliveredPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "billedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "amountBilled" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "holdReason" TEXT,
    "companyId" TEXT,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL,
    "deliveredQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "sourceWarehouseId" TEXT,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SerialNumber" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "status" "public"."SerialNumberStatus" NOT NULL DEFAULT 'AVAILABLE',
    "batchId" TEXT,
    "purchaseRate" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "public"."ShiftAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShiftType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isNightShift" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "ShiftType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockEntry" (
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "purpose" "public"."StockEntryPurpose" NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "remarks" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockEntryItem" (
    "id" TEXT NOT NULL,
    "stockEntryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "serialNoId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEntryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voucherType" TEXT NOT NULL,
    "voucherId" TEXT,
    "voucherNo" TEXT NOT NULL,
    "actualQty" DECIMAL(18,6) NOT NULL,
    "qtyAfterTransaction" DECIMAL(18,6) NOT NULL,
    "incomingRate" DECIMAL(18,6),
    "outgoingRate" DECIMAL(18,6),
    "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "stockValueDifference" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "serialNoId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockLevel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "type" "public"."MovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockReservation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "reservedQty" DECIMAL(18,6) NOT NULL,
    "fulfilledQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "public"."StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionInvoiceRun" (
    "id" TEXT NOT NULL,
    "subscriptionTemplateId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "seriesId" TEXT,
    "frequency" "public"."RecurrenceFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "SubscriptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionTemplateItem" (
    "id" TEXT NOT NULL,
    "subscriptionTemplateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "description" TEXT,
    "hsnCode" TEXT,
    "uomId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxTemplateId" TEXT,

    CONSTRAINT "SubscriptionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Supplier" (
    "id" TEXT NOT NULL,
    "supplierNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "zip" TEXT,
    "taxId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "bankAccount" TEXT,
    "bankName" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierCommunicationLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "supplierId" TEXT,
    "rfqId" TEXT,
    "supplierQuotationId" TEXT,
    "channel" "public"."CommunicationChannel" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "direction" "public"."CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "SupplierCommunicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierItemCode" TEXT NOT NULL,
    "supplierItemName" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "minimumOrderQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "paymentNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "purchaseInvoiceId" TEXT,
    "status" "public"."PaymentEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "public"."SupplierPaymentType" NOT NULL DEFAULT 'INVOICE_PAYMENT',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,6) NOT NULL,
    "allocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "method" "public"."PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierQuotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "quotationNo" TEXT NOT NULL,
    "rfqId" TEXT,
    "supplierId" TEXT NOT NULL,
    "status" "public"."SupplierQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "shippingAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "deliveryScore" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "terms" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierQuotationItem" (
    "id" TEXT NOT NULL,
    "supplierQuotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierItemCode" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" TEXT,
    "stockUom" TEXT,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "rate" DECIMAL(18,6) NOT NULL,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "deliveryDate" TIMESTAMP(3),

    CONSTRAINT "SupplierQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaxTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "public"."TaxTemplateScope" NOT NULL DEFAULT 'BOTH',
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "TaxTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaxTemplateLine" (
    "id" TEXT NOT NULL,
    "taxTemplateId" TEXT NOT NULL,
    "accountId" TEXT,
    "label" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "chargeType" "public"."TaxChargeType" NOT NULL DEFAULT 'ON_NET_TOTAL',
    "rowOrder" INTEGER NOT NULL DEFAULT 0,
    "isRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatar" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserAccessRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "public"."AccessEffect" NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentId" TEXT,
    "companyId" TEXT,
    "type" "public"."WarehouseType" NOT NULL DEFAULT 'WAREHOUSE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessAuditLog_companyId_createdAt_idx" ON "public"."AccessAuditLog"("companyId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AccessAuditLog_targetRoleId_createdAt_idx" ON "public"."AccessAuditLog"("targetRoleId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AccessAuditLog_targetUserId_createdAt_idx" ON "public"."AccessAuditLog"("targetUserId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AccessRole_companyId_isActive_idx" ON "public"."AccessRole"("companyId" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_companyId_name_key" ON "public"."AccessRole"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_code_key" ON "public"."Account"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "public"."Account"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Activity_companyId_idx" ON "public"."Activity"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Activity_leadId_createdAt_idx" ON "public"."Activity"("leadId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Activity_opportunityId_createdAt_idx" ON "public"."Activity"("opportunityId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Activity_organizationId_createdAt_idx" ON "public"."Activity"("organizationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Activity_userId_status_dueDate_idx" ON "public"."Activity"("userId" ASC, "status" ASC, "dueDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "public"."Attendance"("employeeId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "public"."AuditLog"("companyId" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_creditNoteId_createdAt_idx" ON "public"."AuditLog"("creditNoteId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_deliveryNoteId_createdAt_idx" ON "public"."AuditLog"("deliveryNoteId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "public"."AuditLog"("entityType" ASC, "entityId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_invoiceId_createdAt_idx" ON "public"."AuditLog"("invoiceId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BankStatementLine_accountId_statementDate_idx" ON "public"."BankStatementLine"("accountId" ASC, "statementDate" ASC);

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_idx" ON "public"."BankStatementLine"("companyId" ASC);

-- CreateIndex
CREATE INDEX "BankStatementLine_isReconciled_idx" ON "public"."BankStatementLine"("isReconciled" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Batch_companyId_batchNo_key" ON "public"."Batch"("companyId" ASC, "batchNo" ASC);

-- CreateIndex
CREATE INDEX "Batch_companyId_idx" ON "public"."Batch"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Batch_expiryDate_idx" ON "public"."Batch"("expiryDate" ASC);

-- CreateIndex
CREATE INDEX "Batch_productId_warehouseId_idx" ON "public"."Batch"("productId" ASC, "warehouseId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BlanketPurchaseOrder_agreementNo_key" ON "public"."BlanketPurchaseOrder"("agreementNo" ASC);

-- CreateIndex
CREATE INDEX "Budget_companyId_idx" ON "public"."Budget"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Budget_fiscalYearId_accountId_costCenterId_idx" ON "public"."Budget"("fiscalYearId" ASC, "accountId" ASC, "costCenterId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BuyingSettings_companyId_key" ON "public"."BuyingSettings"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Category_companyId_code_key" ON "public"."Category"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "Category_companyId_idx" ON "public"."Category"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Comment_companyId_idx" ON "public"."Comment"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "public"."Contact"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "public"."Contact"("email" ASC);

-- CreateIndex
CREATE INDEX "Contact_leadId_idx" ON "public"."Contact"("leadId" ASC);

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "public"."Contact"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "public"."Contact"("phone" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_companyId_code_key" ON "public"."CostCenter"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "CostCenter_companyId_idx" ON "public"."CostCenter"("companyId" ASC);

-- CreateIndex
CREATE INDEX "CostCenter_parentId_idx" ON "public"."CostCenter"("parentId" ASC);

-- CreateIndex
CREATE INDEX "CreditNote_companyId_idx" ON "public"."CreditNote"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_key" ON "public"."CreditNote"("creditNoteNo" ASC);

-- CreateIndex
CREATE INDEX "CreditNote_customerId_status_idx" ON "public"."CreditNote"("customerId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "CreditNote_originalInvoiceId_idx" ON "public"."CreditNote"("originalInvoiceId" ASC);

-- CreateIndex
CREATE INDEX "CrmAssignmentRule_assignToId_idx" ON "public"."CrmAssignmentRule"("assignToId" ASC);

-- CreateIndex
CREATE INDEX "CrmAssignmentRule_companyId_isActive_priority_idx" ON "public"."CrmAssignmentRule"("companyId" ASC, "isActive" ASC, "priority" ASC);

-- CreateIndex
CREATE INDEX "CrmOrganization_companyId_name_idx" ON "public"."CrmOrganization"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "CrmOrganization_ownerId_idx" ON "public"."CrmOrganization"("ownerId" ASC);

-- CreateIndex
CREATE INDEX "CrmSavedView_companyId_entity_idx" ON "public"."CrmSavedView"("companyId" ASC, "entity" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSavedView_userId_entity_name_key" ON "public"."CrmSavedView"("userId" ASC, "entity" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "public"."Customer"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNo_key" ON "public"."Customer"("customerNo" ASC);

-- CreateIndex
CREATE INDEX "DeliveryNote_companyId_idx" ON "public"."DeliveryNote"("companyId" ASC);

-- CreateIndex
CREATE INDEX "DeliveryNote_customerId_status_idx" ON "public"."DeliveryNote"("customerId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_deliveryNo_key" ON "public"."DeliveryNote"("deliveryNo" ASC);

-- CreateIndex
CREATE INDEX "DeliveryNote_salesOrderId_idx" ON "public"."DeliveryNote"("salesOrderId" ASC);

-- CreateIndex
CREATE INDEX "DeliveryNote_warehouseId_idx" ON "public"."DeliveryNote"("warehouseId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "public"."Department"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "public"."Department"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Document_companyId_idx" ON "public"."Document"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeId_key" ON "public"."Employee"("employeeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "public"."Employee"("userId" ASC);

-- CreateIndex
CREATE INDEX "EmployeeCheckin_employeeId_time_idx" ON "public"."EmployeeCheckin"("employeeId" ASC, "time" ASC);

-- CreateIndex
CREATE INDEX "EmployeeLifecycleEvent_employeeId_type_status_idx" ON "public"."EmployeeLifecycleEvent"("employeeId" ASC, "type" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_idx" ON "public"."FiscalYear"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_companyId_assetNo_key" ON "public"."FixedAsset"("companyId" ASC, "assetNo" ASC);

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_idx" ON "public"."FixedAsset"("companyId" ASC);

-- CreateIndex
CREATE INDEX "FixedAsset_status_idx" ON "public"."FixedAsset"("status" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_accountId_postingDate_idx" ON "public"."GeneralLedgerEntry"("accountId" ASC, "postingDate" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_companyId_idx" ON "public"."GeneralLedgerEntry"("companyId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_costCenterId_idx" ON "public"."GeneralLedgerEntry"("costCenterId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_creditNoteId_idx" ON "public"."GeneralLedgerEntry"("creditNoteId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_fiscalYearId_periodId_idx" ON "public"."GeneralLedgerEntry"("fiscalYearId" ASC, "periodId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_invoiceId_idx" ON "public"."GeneralLedgerEntry"("invoiceId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_partyType_partyId_idx" ON "public"."GeneralLedgerEntry"("partyType" ASC, "partyId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_paymentEntryId_idx" ON "public"."GeneralLedgerEntry"("paymentEntryId" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_reconciliationStatus_idx" ON "public"."GeneralLedgerEntry"("reconciliationStatus" ASC);

-- CreateIndex
CREATE INDEX "GeneralLedgerEntry_voucherType_voucherId_idx" ON "public"."GeneralLedgerEntry"("voucherType" ASC, "voucherId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_holidayListId_date_key" ON "public"."Holiday"("holidayListId" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "HolidayList_name_year_key" ON "public"."HolidayList"("name" ASC, "year" ASC);

-- CreateIndex
CREATE INDEX "InventoryValuationLayer_companyId_idx" ON "public"."InventoryValuationLayer"("companyId" ASC);

-- CreateIndex
CREATE INDEX "InventoryValuationLayer_productId_warehouseId_isClosed_postingD" ON "public"."InventoryValuationLayer"("productId" ASC, "warehouseId" ASC, "isClosed" ASC, "postingDate" ASC);

-- CreateIndex
CREATE INDEX "ItemPrice_companyId_idx" ON "public"."ItemPrice"("companyId" ASC);

-- CreateIndex
CREATE INDEX "ItemPrice_productId_priceListId_customerId_idx" ON "public"."ItemPrice"("productId" ASC, "priceListId" ASC, "customerId" ASC);

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_idx" ON "public"."JournalEntry"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "public"."JournalEntry"("entryNumber" ASC);

-- CreateIndex
CREATE INDEX "JournalEntryTemplate_companyId_idx" ON "public"."JournalEntryTemplate"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LandedCostVoucher_voucherNo_key" ON "public"."LandedCostVoucher"("voucherNo" ASC);

-- CreateIndex
CREATE INDEX "Lead_assignedToId_status_idx" ON "public"."Lead"("assignedToId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Lead_city_country_idx" ON "public"."Lead"("city" ASC, "country" ASC);

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "public"."Lead"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "public"."Lead"("email" ASC);

-- CreateIndex
CREATE INDEX "Lead_importBatchId_idx" ON "public"."Lead"("importBatchId" ASC);

-- CreateIndex
CREATE INDEX "Lead_organizationId_idx" ON "public"."Lead"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "public"."Lead"("phone" ASC);

-- CreateIndex
CREATE INDEX "Lead_status_source_idx" ON "public"."Lead"("status" ASC, "source" ASC);

-- CreateIndex
CREATE INDEX "LeadImportBatch_companyId_createdAt_idx" ON "public"."LeadImportBatch"("companyId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "LeadImportBatch_importedById_createdAt_idx" ON "public"."LeadImportBatch"("importedById" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LeadImportRow_batchId_rowNo_key" ON "public"."LeadImportRow"("batchId" ASC, "rowNo" ASC);

-- CreateIndex
CREATE INDEX "LeadImportRow_batchId_status_idx" ON "public"."LeadImportRow"("batchId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAllocation_employeeId_leaveTypeId_fromDate_toDate_key" ON "public"."LeaveAllocation"("employeeId" ASC, "leaveTypeId" ASC, "fromDate" ASC, "toDate" ASC);

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_employeeId_leaveTypeId_transactionDate_idx" ON "public"."LeaveLedgerEntry"("employeeId" ASC, "leaveTypeId" ASC, "transactionDate" ASC);

-- CreateIndex
CREATE INDEX "LeavePeriod_companyId_idx" ON "public"."LeavePeriod"("companyId" ASC);

-- CreateIndex
CREATE INDEX "LeavePolicy_companyId_idx" ON "public"."LeavePolicy"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_companyId_name_key" ON "public"."LeavePolicy"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyAssignment_employeeId_leavePolicyId_leavePeriodI_key" ON "public"."LeavePolicyAssignment"("employeeId" ASC, "leavePolicyId" ASC, "leavePeriodId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyDetail_leavePolicyId_leaveTypeId_key" ON "public"."LeavePolicyDetail"("leavePolicyId" ASC, "leaveTypeId" ASC);

-- CreateIndex
CREATE INDEX "LeaveType_companyId_idx" ON "public"."LeaveType"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_requestNo_key" ON "public"."MaterialRequest"("requestNo" ASC);

-- CreateIndex
CREATE INDEX "Milestone_companyId_idx" ON "public"."Milestone"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "public"."Notification"("companyId" ASC);

-- CreateIndex
CREATE INDEX "NumberingSeries_companyId_idx" ON "public"."NumberingSeries"("companyId" ASC);

-- CreateIndex
CREATE INDEX "NumberingSeries_documentType_isDefault_isActive_idx" ON "public"."NumberingSeries"("documentType" ASC, "isDefault" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "NumberingSeries_documentType_name_fiscalYearId_branch_key" ON "public"."NumberingSeries"("documentType" ASC, "name" ASC, "fiscalYearId" ASC, "branch" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_companyId_idx" ON "public"."Opportunity"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_customerId_idx" ON "public"."Opportunity"("customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_leadId_key" ON "public"."Opportunity"("leadId" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_idx" ON "public"."Opportunity"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_quotationId_idx" ON "public"."Opportunity"("quotationId" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_salesOrderId_idx" ON "public"."Opportunity"("salesOrderId" ASC);

-- CreateIndex
CREATE INDEX "Opportunity_stage_expectedClose_idx" ON "public"."Opportunity"("stage" ASC, "expectedClose" ASC);

-- CreateIndex
CREATE INDEX "OpportunityItem_opportunityId_idx" ON "public"."OpportunityItem"("opportunityId" ASC);

-- CreateIndex
CREATE INDEX "OpportunityItem_productId_idx" ON "public"."OpportunityItem"("productId" ASC);

-- CreateIndex
CREATE INDEX "Payment_companyId_idx" ON "public"."Payment"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "public"."Payment"("paymentNo" ASC);

-- CreateIndex
CREATE INDEX "PaymentEntry_companyId_idx" ON "public"."PaymentEntry"("companyId" ASC);

-- CreateIndex
CREATE INDEX "PaymentEntry_customerId_status_idx" ON "public"."PaymentEntry"("customerId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "PaymentEntry_date_idx" ON "public"."PaymentEntry"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEntry_paymentNo_key" ON "public"."PaymentEntry"("paymentNo" ASC);

-- CreateIndex
CREATE INDEX "PaymentEntryAllocation_creditNoteId_idx" ON "public"."PaymentEntryAllocation"("creditNoteId" ASC);

-- CreateIndex
CREATE INDEX "PaymentEntryAllocation_invoiceId_idx" ON "public"."PaymentEntryAllocation"("invoiceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTermsTemplate_companyId_name_key" ON "public"."PaymentTermsTemplate"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_employeeId_month_year_key" ON "public"."Payroll"("employeeId" ASC, "month" ASC, "year" ASC);

-- CreateIndex
CREATE INDEX "PayrollEntry_companyId_idx" ON "public"."PayrollEntry"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_companyId_month_year_key" ON "public"."PayrollEntry"("companyId" ASC, "month" ASC, "year" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_companyId_payrollNo_key" ON "public"."PayrollEntry"("companyId" ASC, "payrollNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PeriodClosingVoucher_companyId_closingNo_key" ON "public"."PeriodClosingVoucher"("companyId" ASC, "closingNo" ASC);

-- CreateIndex
CREATE INDEX "PeriodClosingVoucher_companyId_idx" ON "public"."PeriodClosingVoucher"("companyId" ASC);

-- CreateIndex
CREATE INDEX "PeriodClosingVoucher_fiscalYearId_status_idx" ON "public"."PeriodClosingVoucher"("fiscalYearId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "public"."Permission"("key" ASC);

-- CreateIndex
CREATE INDEX "Permission_module_action_idx" ON "public"."Permission"("module" ASC, "action" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_resource_action_key" ON "public"."Permission"("module" ASC, "resource" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "Position_companyId_idx" ON "public"."Position"("companyId" ASC);

-- CreateIndex
CREATE INDEX "PriceList_companyId_idx" ON "public"."PriceList"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_companyId_name_key" ON "public"."PriceList"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "PricingRule_categoryId_idx" ON "public"."PricingRule"("categoryId" ASC);

-- CreateIndex
CREATE INDEX "PricingRule_companyId_idx" ON "public"."PricingRule"("companyId" ASC);

-- CreateIndex
CREATE INDEX "PricingRule_customerId_idx" ON "public"."PricingRule"("customerId" ASC);

-- CreateIndex
CREATE INDEX "PricingRule_isActive_priority_idx" ON "public"."PricingRule"("isActive" ASC, "priority" ASC);

-- CreateIndex
CREATE INDEX "PricingRule_productId_idx" ON "public"."PricingRule"("productId" ASC);

-- CreateIndex
CREATE INDEX "PrintFormat_companyId_idx" ON "public"."PrintFormat"("companyId" ASC);

-- CreateIndex
CREATE INDEX "PrintFormat_docType_isDefault_isActive_idx" ON "public"."PrintFormat"("docType" ASC, "isDefault" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PrintFormat_docType_name_key" ON "public"."PrintFormat"("docType" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "Product_companyId_idx" ON "public"."Product"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "public"."Product"("companyId" ASC, "sku" ASC);

-- CreateIndex
CREATE INDEX "Product_defaultWarehouseId_idx" ON "public"."Product"("defaultWarehouseId" ASC);

-- CreateIndex
CREATE INDEX "Product_variantOfId_idx" ON "public"."Product"("variantOfId" ASC);

-- CreateIndex
CREATE INDEX "ProductAttribute_companyId_idx" ON "public"."ProductAttribute"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttribute_companyId_name_key" ON "public"."ProductAttribute"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "ProductAttributeValue_attributeId_idx" ON "public"."ProductAttributeValue"("attributeId" ASC);

-- CreateIndex
CREATE INDEX "ProductAttributeValue_companyId_idx" ON "public"."ProductAttributeValue"("companyId" ASC);

-- CreateIndex
CREATE INDEX "ProductAttributeValue_productId_idx" ON "public"."ProductAttributeValue"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductUomConversion_companyId_idx" ON "public"."ProductUomConversion"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductUomConversion_productId_fromUnitId_toUnitId_key" ON "public"."ProductUomConversion"("productId" ASC, "fromUnitId" ASC, "toUnitId" ASC);

-- CreateIndex
CREATE INDEX "Project_companyId_idx" ON "public"."Project"("companyId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMember_companyId_idx" ON "public"."ProjectMember"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "public"."ProjectMember"("projectId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "PurchaseInvoice_companyId_idx" ON "public"."PurchaseInvoice"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_invoiceNo_key" ON "public"."PurchaseInvoice"("invoiceNo" ASC);

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_idx" ON "public"."PurchaseOrder"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "public"."PurchaseOrder"("orderNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_receiptNo_key" ON "public"."PurchaseReceipt"("receiptNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "QualityInspection_inspectionNo_key" ON "public"."QualityInspection"("inspectionNo" ASC);

-- CreateIndex
CREATE INDEX "Quotation_companyId_idx" ON "public"."Quotation"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNo_key" ON "public"."Quotation"("quotationNo" ASC);

-- CreateIndex
CREATE INDEX "RecurringJournalEntry_companyId_idx" ON "public"."RecurringJournalEntry"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RequestForQuotation_rfqNo_key" ON "public"."RequestForQuotation"("rfqNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RequestForQuotationSupplier_rfqId_supplierId_key" ON "public"."RequestForQuotationSupplier"("rfqId" ASC, "supplierId" ASC);

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_effect_idx" ON "public"."RolePermission"("permissionId" ASC, "effect" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "public"."RolePermission"("roleId" ASC, "permissionId" ASC);

-- CreateIndex
CREATE INDEX "SalaryComponent_companyId_idx" ON "public"."SalaryComponent"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryComponent_companyId_name_key" ON "public"."SalaryComponent"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalarySlip_employeeId_month_year_key" ON "public"."SalarySlip"("employeeId" ASC, "month" ASC, "year" ASC);

-- CreateIndex
CREATE INDEX "SalarySlip_payrollEntryId_idx" ON "public"."SalarySlip"("payrollEntryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalarySlip_slipNo_key" ON "public"."SalarySlip"("slipNo" ASC);

-- CreateIndex
CREATE INDEX "SalaryStructure_companyId_idx" ON "public"."SalaryStructure"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_companyId_name_key" ON "public"."SalaryStructure"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "SalaryStructureAssignment_employeeId_isActive_idx" ON "public"."SalaryStructureAssignment"("employeeId" ASC, "isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructureComponent_salaryStructureId_salaryComponentI_key" ON "public"."SalaryStructureComponent"("salaryStructureId" ASC, "salaryComponentId" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_assignedToId_idx" ON "public"."SalesInvoice"("assignedToId" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_companyId_idx" ON "public"."SalesInvoice"("companyId" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_createdById_idx" ON "public"."SalesInvoice"("createdById" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_customerId_status_paymentStatus_idx" ON "public"."SalesInvoice"("customerId" ASC, "status" ASC, "paymentStatus" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_deliveryNoteId_idx" ON "public"."SalesInvoice"("deliveryNoteId" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_dueDate_idx" ON "public"."SalesInvoice"("dueDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_invoiceNo_key" ON "public"."SalesInvoice"("invoiceNo" ASC);

-- CreateIndex
CREATE INDEX "SalesInvoice_salesOrderId_idx" ON "public"."SalesInvoice"("salesOrderId" ASC);

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_idx" ON "public"."SalesOrder"("companyId" ASC);

-- CreateIndex
CREATE INDEX "SalesOrder_customerPoNo_idx" ON "public"."SalesOrder"("customerPoNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNo_key" ON "public"."SalesOrder"("orderNo" ASC);

-- CreateIndex
CREATE INDEX "SalesOrder_sourceWarehouseId_idx" ON "public"."SalesOrder"("sourceWarehouseId" ASC);

-- CreateIndex
CREATE INDEX "SerialNumber_companyId_idx" ON "public"."SerialNumber"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_companyId_serialNo_key" ON "public"."SerialNumber"("companyId" ASC, "serialNo" ASC);

-- CreateIndex
CREATE INDEX "SerialNumber_productId_status_idx" ON "public"."SerialNumber"("productId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "SerialNumber_warehouseId_idx" ON "public"."SerialNumber"("warehouseId" ASC);

-- CreateIndex
CREATE INDEX "ShiftAssignment_employeeId_startDate_idx" ON "public"."ShiftAssignment"("employeeId" ASC, "startDate" ASC);

-- CreateIndex
CREATE INDEX "ShiftType_companyId_idx" ON "public"."ShiftType"("companyId" ASC);

-- CreateIndex
CREATE INDEX "StockEntry_companyId_idx" ON "public"."StockEntry"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StockEntry_entryNo_key" ON "public"."StockEntry"("entryNo" ASC);

-- CreateIndex
CREATE INDEX "StockEntry_postingDate_idx" ON "public"."StockEntry"("postingDate" ASC);

-- CreateIndex
CREATE INDEX "StockEntry_status_purpose_idx" ON "public"."StockEntry"("status" ASC, "purpose" ASC);

-- CreateIndex
CREATE INDEX "StockEntryItem_productId_idx" ON "public"."StockEntryItem"("productId" ASC);

-- CreateIndex
CREATE INDEX "StockEntryItem_stockEntryId_idx" ON "public"."StockEntryItem"("stockEntryId" ASC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_batchId_idx" ON "public"."StockLedgerEntry"("batchId" ASC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_companyId_idx" ON "public"."StockLedgerEntry"("companyId" ASC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_productId_warehouseId_postingDate_idx" ON "public"."StockLedgerEntry"("productId" ASC, "warehouseId" ASC, "postingDate" ASC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_serialNoId_idx" ON "public"."StockLedgerEntry"("serialNoId" ASC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_voucherType_voucherId_idx" ON "public"."StockLedgerEntry"("voucherType" ASC, "voucherId" ASC);

-- CreateIndex
CREATE INDEX "StockLevel_companyId_idx" ON "public"."StockLevel"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_productId_warehouseId_key" ON "public"."StockLevel"("productId" ASC, "warehouseId" ASC);

-- CreateIndex
CREATE INDEX "StockMovement_companyId_idx" ON "public"."StockMovement"("companyId" ASC);

-- CreateIndex
CREATE INDEX "StockReservation_companyId_idx" ON "public"."StockReservation"("companyId" ASC);

-- CreateIndex
CREATE INDEX "StockReservation_productId_warehouseId_status_idx" ON "public"."StockReservation"("productId" ASC, "warehouseId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "StockReservation_salesOrderId_idx" ON "public"."StockReservation"("salesOrderId" ASC);

-- CreateIndex
CREATE INDEX "StockReservation_salesOrderItemId_idx" ON "public"."StockReservation"("salesOrderItemId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoiceRun_subscriptionTemplateId_invoiceId_key" ON "public"."SubscriptionInvoiceRun"("subscriptionTemplateId" ASC, "invoiceId" ASC);

-- CreateIndex
CREATE INDEX "SubscriptionTemplate_companyId_idx" ON "public"."SubscriptionTemplate"("companyId" ASC);

-- CreateIndex
CREATE INDEX "SubscriptionTemplate_customerId_idx" ON "public"."SubscriptionTemplate"("customerId" ASC);

-- CreateIndex
CREATE INDEX "SubscriptionTemplate_isActive_nextRunDate_idx" ON "public"."SubscriptionTemplate"("isActive" ASC, "nextRunDate" ASC);

-- CreateIndex
CREATE INDEX "Supplier_companyId_idx" ON "public"."Supplier"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierNo_key" ON "public"."Supplier"("supplierNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItem_supplierId_productId_key" ON "public"."SupplierItem"("supplierId" ASC, "productId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNo_key" ON "public"."SupplierPayment"("paymentNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotation_quotationNo_key" ON "public"."SupplierQuotation"("quotationNo" ASC);

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "public"."Task"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TaxTemplate_companyId_code_key" ON "public"."TaxTemplate"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "TaxTemplate_companyId_idx" ON "public"."TaxTemplate"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Unit_companyId_idx" ON "public"."Unit"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_companyId_name_key" ON "public"."Unit"("companyId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "UserAccessRole_userId_idx" ON "public"."UserAccessRole"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccessRole_userId_roleId_key" ON "public"."UserAccessRole"("userId" ASC, "roleId" ASC);

-- CreateIndex
CREATE INDEX "UserPermissionOverride_companyId_userId_effect_idx" ON "public"."UserPermissionOverride"("companyId" ASC, "userId" ASC, "effect" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_permissionId_key" ON "public"."UserPermissionOverride"("userId" ASC, "permissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_companyId_code_key" ON "public"."Warehouse"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "Warehouse_companyId_idx" ON "public"."Warehouse"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Warehouse_parentId_idx" ON "public"."Warehouse"("parentId" ASC);

-- AddForeignKey
ALTER TABLE "public"."AccessAuditLog" ADD CONSTRAINT "AccessAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessAuditLog" ADD CONSTRAINT "AccessAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessRole" ADD CONSTRAINT "AccessRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "public"."Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "public"."CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "public"."DeliveryNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankStatementLine" ADD CONSTRAINT "BankStatementLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Batch" ADD CONSTRAINT "Batch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Batch" ADD CONSTRAINT "Batch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BlanketPurchaseOrderItem" ADD CONSTRAINT "BlanketPurchaseOrderItem_blanketPurchaseOrderId_fkey" FOREIGN KEY ("blanketPurchaseOrderId") REFERENCES "public"."BlanketPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Budget" ADD CONSTRAINT "Budget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Budget" ADD CONSTRAINT "Budget_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "public"."CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNote" ADD CONSTRAINT "CreditNote_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "public"."CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNoteTax" ADD CONSTRAINT "CreditNoteTax_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNoteTax" ADD CONSTRAINT "CreditNoteTax_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "public"."CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditNoteTax" ADD CONSTRAINT "CreditNoteTax_taxTemplateLineId_fkey" FOREIGN KEY ("taxTemplateLineId") REFERENCES "public"."TaxTemplateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_assignToId_fkey" FOREIGN KEY ("assignToId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmOrganization" ADD CONSTRAINT "CrmOrganization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmOrganization" ADD CONSTRAINT "CrmOrganization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmSavedView" ADD CONSTRAINT "CrmSavedView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CrmSavedView" ADD CONSTRAINT "CrmSavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryNote" ADD CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryNote" ADD CONSTRAINT "DeliveryNote_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryNote" ADD CONSTRAINT "DeliveryNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryNoteItem" ADD CONSTRAINT "DeliveryNoteItem_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "public"."DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryNoteItem" ADD CONSTRAINT "DeliveryNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "public"."Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeCheckin" ADD CONSTRAINT "EmployeeCheckin_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeLifecycleEvent" ADD CONSTRAINT "EmployeeLifecycleEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FixedAsset" ADD CONSTRAINT "FixedAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "public"."CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "public"."CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_paymentEntryId_fkey" FOREIGN KEY ("paymentEntryId") REFERENCES "public"."PaymentEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Holiday" ADD CONSTRAINT "Holiday_holidayListId_fkey" FOREIGN KEY ("holidayListId") REFERENCES "public"."HolidayList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryValuationLayer" ADD CONSTRAINT "InventoryValuationLayer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryValuationLayer" ADD CONSTRAINT "InventoryValuationLayer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ItemPrice" ADD CONSTRAINT "ItemPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "public"."PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ItemPrice" ADD CONSTRAINT "ItemPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalEntryTemplateLine" ADD CONSTRAINT "JournalEntryTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."JournalEntryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "public"."CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "public"."JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostAllocation" ADD CONSTRAINT "LandedCostAllocation_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "public"."LandedCostVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostCharge" ADD CONSTRAINT "LandedCostCharge_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "public"."LandedCostVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "public"."LeadImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeadImportBatch" ADD CONSTRAINT "LeadImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeadImportBatch" ADD CONSTRAINT "LeadImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeadImportRow" ADD CONSTRAINT "LeadImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."LeadImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leavePeriodId_fkey" FOREIGN KEY ("leavePeriodId") REFERENCES "public"."LeavePeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "public"."LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "public"."LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePeriod" ADD CONSTRAINT "LeavePeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicy" ADD CONSTRAINT "LeavePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicyAssignment" ADD CONSTRAINT "LeavePolicyAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicyAssignment" ADD CONSTRAINT "LeavePolicyAssignment_leavePeriodId_fkey" FOREIGN KEY ("leavePeriodId") REFERENCES "public"."LeavePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicyAssignment" ADD CONSTRAINT "LeavePolicyAssignment_leavePolicyId_fkey" FOREIGN KEY ("leavePolicyId") REFERENCES "public"."LeavePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicyDetail" ADD CONSTRAINT "LeavePolicyDetail_leavePolicyId_fkey" FOREIGN KEY ("leavePolicyId") REFERENCES "public"."LeavePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeavePolicyDetail" ADD CONSTRAINT "LeavePolicyDetail_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "public"."LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "public"."LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaveType" ADD CONSTRAINT "LeaveType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "public"."MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NumberingSeries" ADD CONSTRAINT "NumberingSeries_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."FiscalYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "public"."Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Opportunity" ADD CONSTRAINT "Opportunity_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpportunityItem" ADD CONSTRAINT "OpportunityItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "public"."Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpportunityItem" ADD CONSTRAINT "OpportunityItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentEntry" ADD CONSTRAINT "PaymentEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentEntryAllocation" ADD CONSTRAINT "PaymentEntryAllocation_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "public"."CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentEntryAllocation" ADD CONSTRAINT "PaymentEntryAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentEntryAllocation" ADD CONSTRAINT "PaymentEntryAllocation_paymentEntryId_fkey" FOREIGN KEY ("paymentEntryId") REFERENCES "public"."PaymentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentTerm" ADD CONSTRAINT "PaymentTerm_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."PaymentTermsTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payroll" ADD CONSTRAINT "Payroll_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayrollEntry" ADD CONSTRAINT "PayrollEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayrollItem" ADD CONSTRAINT "PayrollItem_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "public"."Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Period" ADD CONSTRAINT "Period_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PeriodClosingVoucher" ADD CONSTRAINT "PeriodClosingVoucher_retainedEarningsAccountId_fkey" FOREIGN KEY ("retainedEarningsAccountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PricingRule" ADD CONSTRAINT "PricingRule_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "public"."PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_defaultTaxTemplateId_fkey" FOREIGN KEY ("defaultTaxTemplateId") REFERENCES "public"."TaxTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_variantOfId_fkey" FOREIGN KEY ("variantOfId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "public"."ProductAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductUomConversion" ADD CONSTRAINT "ProductUomConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "public"."PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "public"."PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuotationItem" ADD CONSTRAINT "QuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "public"."Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringJournalEntry" ADD CONSTRAINT "RecurringJournalEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."JournalEntryTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestForQuotationItem" ADD CONSTRAINT "RequestForQuotationItem_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "public"."RequestForQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestForQuotationSupplier" ADD CONSTRAINT "RequestForQuotationSupplier_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "public"."RequestForQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryComponent" ADD CONSTRAINT "SalaryComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalarySlip" ADD CONSTRAINT "SalarySlip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalarySlip" ADD CONSTRAINT "SalarySlip_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "public"."PayrollEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalarySlipItem" ADD CONSTRAINT "SalarySlipItem_salaryComponentId_fkey" FOREIGN KEY ("salaryComponentId") REFERENCES "public"."SalaryComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalarySlipItem" ADD CONSTRAINT "SalarySlipItem_salarySlipId_fkey" FOREIGN KEY ("salarySlipId") REFERENCES "public"."SalarySlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryStructure" ADD CONSTRAINT "SalaryStructure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryStructureAssignment" ADD CONSTRAINT "SalaryStructureAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryStructureAssignment" ADD CONSTRAINT "SalaryStructureAssignment_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "public"."SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryStructureComponent" ADD CONSTRAINT "SalaryStructureComponent_salaryComponentId_fkey" FOREIGN KEY ("salaryComponentId") REFERENCES "public"."SalaryComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalaryStructureComponent" ADD CONSTRAINT "SalaryStructureComponent_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "public"."SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_amendedFromId_fkey" FOREIGN KEY ("amendedFromId") REFERENCES "public"."SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "public"."DeliveryNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoice" ADD CONSTRAINT "SalesInvoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "public"."TaxTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "public"."Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItemTax" ADD CONSTRAINT "SalesInvoiceItemTax_salesInvoiceItemId_fkey" FOREIGN KEY ("salesInvoiceItemId") REFERENCES "public"."SalesInvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceItemTax" ADD CONSTRAINT "SalesInvoiceItemTax_taxTemplateLineId_fkey" FOREIGN KEY ("taxTemplateLineId") REFERENCES "public"."TaxTemplateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceTax" ADD CONSTRAINT "SalesInvoiceTax_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceTax" ADD CONSTRAINT "SalesInvoiceTax_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesInvoiceTax" ADD CONSTRAINT "SalesInvoiceTax_taxTemplateLineId_fkey" FOREIGN KEY ("taxTemplateLineId") REFERENCES "public"."TaxTemplateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrder" ADD CONSTRAINT "SalesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "public"."Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialNumber" ADD CONSTRAINT "SerialNumber_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialNumber" ADD CONSTRAINT "SerialNumber_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "public"."ShiftType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShiftType" ADD CONSTRAINT "ShiftType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockEntry" ADD CONSTRAINT "StockEntry_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockEntry" ADD CONSTRAINT "StockEntry_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockEntryItem" ADD CONSTRAINT "StockEntryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockEntryItem" ADD CONSTRAINT "StockEntryItem_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "public"."StockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockEntryItem" ADD CONSTRAINT "StockEntryItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_serialNoId_fkey" FOREIGN KEY ("serialNoId") REFERENCES "public"."SerialNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "public"."SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockReservation" ADD CONSTRAINT "StockReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionInvoiceRun" ADD CONSTRAINT "SubscriptionInvoiceRun_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionInvoiceRun" ADD CONSTRAINT "SubscriptionInvoiceRun_subscriptionTemplateId_fkey" FOREIGN KEY ("subscriptionTemplateId") REFERENCES "public"."SubscriptionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionTemplate" ADD CONSTRAINT "SubscriptionTemplate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionTemplateItem" ADD CONSTRAINT "SubscriptionTemplateItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionTemplateItem" ADD CONSTRAINT "SubscriptionTemplateItem_subscriptionTemplateId_fkey" FOREIGN KEY ("subscriptionTemplateId") REFERENCES "public"."SubscriptionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionTemplateItem" ADD CONSTRAINT "SubscriptionTemplateItem_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "public"."TaxTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionTemplateItem" ADD CONSTRAINT "SubscriptionTemplateItem_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "public"."Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierItem" ADD CONSTRAINT "SupplierItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierQuotationItem" ADD CONSTRAINT "SupplierQuotationItem_supplierQuotationId_fkey" FOREIGN KEY ("supplierQuotationId") REFERENCES "public"."SupplierQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaxTemplateLine" ADD CONSTRAINT "TaxTemplateLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaxTemplateLine" ADD CONSTRAINT "TaxTemplateLine_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "public"."TaxTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Warehouse" ADD CONSTRAINT "Warehouse_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
