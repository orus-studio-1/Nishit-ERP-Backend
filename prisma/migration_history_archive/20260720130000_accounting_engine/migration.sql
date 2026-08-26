DO $$ BEGIN CREATE TYPE "JournalEntryType" AS ENUM ('STANDARD', 'OPENING', 'CLOSING', 'RECURRING', 'EXCHANGE_REVALUATION', 'DEPRECIATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ReconciliationStatus" AS ENUM ('UNRECONCILED', 'RECONCILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "EntryStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'JOURNAL_ENTRY';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'PURCHASE_INVOICE';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'STOCK_ENTRY';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'PERIOD_CLOSING';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'EXCHANGE_REVALUATION';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'ASSET_DEPRECIATION';

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "rootType" "AccountType";
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "freezeAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "frozenTillDate" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultCash" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultBank" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultReceivable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultPayable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultTax" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultRoundOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isDefaultRetainedEarnings" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Account" SET "rootType" = "type" WHERE "rootType" IS NULL;

ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "referenceType" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "entryType" "JournalEntryType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "fiscalYearId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "periodId" TEXT;

ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;

ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "fiscalYearId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "periodId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "partyType" "PartyType";
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "partyId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "voucherLineId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "debitBase" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "creditBase" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "taxType" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED';
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "bankStatementLineId" TEXT;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "isCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GeneralLedgerEntry" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
UPDATE "GeneralLedgerEntry" SET "debitBase" = "debit" WHERE "debitBase" = 0 AND "debit" <> 0;
UPDATE "GeneralLedgerEntry" SET "creditBase" = "credit" WHERE "creditBase" = 0 AND "credit" <> 0;
UPDATE "GeneralLedgerEntry" SET "partyType" = 'CUSTOMER', "partyId" = "customerId" WHERE "customerId" IS NOT NULL AND "partyId" IS NULL;

CREATE TABLE IF NOT EXISTS "CostCenter" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "isGroup" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Budget" (
  "id" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "costCenterId" TEXT,
  "periodId" TEXT,
  "amount" DECIMAL(18,6) NOT NULL,
  "enforce" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BankStatementLine" (
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
  CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PeriodClosingVoucher" (
  "id" TEXT NOT NULL,
  "closingNo" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL,
  "retainedEarningsAccountId" TEXT NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "remarks" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PeriodClosingVoucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FixedAsset" (
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
  "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
  "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntryTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntryTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntryTemplateLine" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "debitAccountId" TEXT,
  "creditAccountId" TEXT,
  "debit" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "credit" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "description" TEXT,
  CONSTRAINT "JournalEntryTemplateLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecurringJournalEntry" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "frequency" "RecurrenceFrequency" NOT NULL,
  "nextRunDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringJournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CostCenter_code_key" ON "CostCenter"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "PeriodClosingVoucher_closingNo_key" ON "PeriodClosingVoucher"("closingNo");
CREATE UNIQUE INDEX IF NOT EXISTS "FixedAsset_assetNo_key" ON "FixedAsset"("assetNo");
CREATE INDEX IF NOT EXISTS "CostCenter_parentId_idx" ON "CostCenter"("parentId");
CREATE INDEX IF NOT EXISTS "Budget_fiscalYearId_accountId_costCenterId_idx" ON "Budget"("fiscalYearId", "accountId", "costCenterId");
CREATE INDEX IF NOT EXISTS "BankStatementLine_accountId_statementDate_idx" ON "BankStatementLine"("accountId", "statementDate");
CREATE INDEX IF NOT EXISTS "BankStatementLine_isReconciled_idx" ON "BankStatementLine"("isReconciled");
CREATE INDEX IF NOT EXISTS "PeriodClosingVoucher_fiscalYearId_status_idx" ON "PeriodClosingVoucher"("fiscalYearId", "status");
CREATE INDEX IF NOT EXISTS "FixedAsset_status_idx" ON "FixedAsset"("status");
CREATE INDEX IF NOT EXISTS "GeneralLedgerEntry_partyType_partyId_idx" ON "GeneralLedgerEntry"("partyType", "partyId");
CREATE INDEX IF NOT EXISTS "GeneralLedgerEntry_costCenterId_idx" ON "GeneralLedgerEntry"("costCenterId");
CREATE INDEX IF NOT EXISTS "GeneralLedgerEntry_fiscalYearId_periodId_idx" ON "GeneralLedgerEntry"("fiscalYearId", "periodId");
CREATE INDEX IF NOT EXISTS "GeneralLedgerEntry_reconciliationStatus_idx" ON "GeneralLedgerEntry"("reconciliationStatus");

DO $$ BEGIN ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "GeneralLedgerEntry" ADD CONSTRAINT "GeneralLedgerEntry_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Budget" ADD CONSTRAINT "Budget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Budget" ADD CONSTRAINT "Budget_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PeriodClosingVoucher" ADD CONSTRAINT "PeriodClosingVoucher_retainedEarningsAccountId_fkey" FOREIGN KEY ("retainedEarningsAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "JournalEntryTemplateLine" ADD CONSTRAINT "JournalEntryTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "JournalEntryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecurringJournalEntry" ADD CONSTRAINT "RecurringJournalEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "JournalEntryTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
