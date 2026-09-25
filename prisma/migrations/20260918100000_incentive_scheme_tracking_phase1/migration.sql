-- Phase 1: Incentive / Scheme Tracking foundation models + PurchaseInvoice.tradeType
-- NOTE: This migration was hand-authored (not `prisma migrate dev`) because the
-- project's prisma.config.ts has no shadowDatabaseUrl configured, which Prisma 7
-- requires for `migrate diff --from-migrations`. The SQL below was written to
-- match this repo's existing migration conventions (quoted identifiers, Prisma's
-- default constraint/index naming) and was validated against `prisma db pull`
-- + `prisma validate` after application (see Phase 1 report).
--
-- IMPORTANT: this migration also adds a PostgreSQL PARTIAL unique index
-- (see bottom) that Prisma's schema.prisma DSL cannot express. If this
-- migration is ever regenerated via `prisma migrate diff`/`db push`, the
-- partial index below must be re-added by hand — it will NOT be inferred
-- from schema.prisma.

-- 1. New enums

CREATE TYPE "PurchaseInvoiceTradeType" AS ENUM ('DISTRIBUTOR_SALE', 'SUPER_TRADE', 'SPECIAL_TRADE', 'PROJECT_NON_SPA', 'PROJECT_SPA');

CREATE TYPE "IncentiveMeasurementType" AS ENUM ('VALUE', 'QUANTITY');

CREATE TYPE "IncentiveRewardType" AS ENUM ('PERCENTAGE', 'FIXED_PER_UNIT');

CREATE TYPE "IncentiveSchemeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

CREATE TYPE "IncentiveContributionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVERSED');

CREATE TYPE "IncentiveRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "IncentiveRunReason" AS ENUM ('INITIAL', 'INVOICE_SUBMITTED', 'INVOICE_CANCELLED', 'MANUAL_RECALC');

-- 2. PurchaseInvoice.tradeType (nullable, no backfill needed)

ALTER TABLE "PurchaseInvoice" ADD COLUMN "tradeType" "PurchaseInvoiceTradeType";

CREATE INDEX "PurchaseInvoice_companyId_tradeType_idx" ON "PurchaseInvoice"("companyId", "tradeType");

-- 3. IncentiveScheme

CREATE TABLE "IncentiveScheme" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "manufacturerKey" TEXT NOT NULL,
    "manufacturerLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "measurementType" "IncentiveMeasurementType" NOT NULL,
    "eligibleTradeTypes" "PurchaseInvoiceTradeType"[],
    "bookingChannel" TEXT,
    "status" "IncentiveSchemeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncentiveScheme_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncentiveScheme_companyId_status_idx" ON "IncentiveScheme"("companyId", "status");

CREATE INDEX "IncentiveScheme_companyId_manufacturerKey_idx" ON "IncentiveScheme"("companyId", "manufacturerKey");

-- 4. IncentiveSlab

CREATE TABLE "IncentiveSlab" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "thresholdValue" DECIMAL(18,6) NOT NULL,
    "rewardType" "IncentiveRewardType" NOT NULL,
    "rewardValue" DECIMAL(18,6) NOT NULL,
    "altRewardType" "IncentiveRewardType",
    "altRewardValue" DECIMAL(18,6),
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentiveSlab_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncentiveSlab_schemeId_thresholdValue_key" ON "IncentiveSlab"("schemeId", "thresholdValue");

CREATE UNIQUE INDEX "IncentiveSlab_schemeId_sortOrder_key" ON "IncentiveSlab"("schemeId", "sortOrder");

CREATE INDEX "IncentiveSlab_schemeId_idx" ON "IncentiveSlab"("schemeId");

-- 5. IncentiveCalculationRun

CREATE TABLE "IncentiveCalculationRun" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "status" "IncentiveRunStatus" NOT NULL DEFAULT 'RUNNING',
    "reason" "IncentiveRunReason" NOT NULL,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "IncentiveCalculationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncentiveCalculationRun_schemeId_status_idx" ON "IncentiveCalculationRun"("schemeId", "status");

-- 6. IncentiveContribution

CREATE TABLE "IncentiveContribution" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "slabId" TEXT,
    "eligibleValue" DECIMAL(18,6) NOT NULL,
    "eligibleQuantity" DECIMAL(18,6) NOT NULL,
    "incentiveAmount" DECIMAL(18,6) NOT NULL,
    "altIncentiveAmount" DECIMAL(18,6),
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycleStatus" "IncentiveContributionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersedesId" TEXT,

    CONSTRAINT "IncentiveContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncentiveContribution_schemeId_purchaseInvoiceId_lifecycl_idx" ON "IncentiveContribution"("schemeId", "purchaseInvoiceId", "lifecycleStatus");

CREATE INDEX "IncentiveContribution_purchaseInvoiceId_idx" ON "IncentiveContribution"("purchaseInvoiceId");

CREATE INDEX "IncentiveContribution_runId_idx" ON "IncentiveContribution"("runId");

CREATE INDEX "IncentiveContribution_slabId_idx" ON "IncentiveContribution"("slabId");

-- 7. IncentiveContributionItem

CREATE TABLE "IncentiveContributionItem" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "purchaseInvoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "eligibleValue" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentiveContributionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncentiveContributionItem_contributionId_purchaseInvoiceI_key" ON "IncentiveContributionItem"("contributionId", "purchaseInvoiceItemId");

CREATE INDEX "IncentiveContributionItem_purchaseInvoiceItemId_idx" ON "IncentiveContributionItem"("purchaseInvoiceItemId");

-- 8. Foreign keys

ALTER TABLE "IncentiveSlab" ADD CONSTRAINT "IncentiveSlab_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "IncentiveScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncentiveCalculationRun" ADD CONSTRAINT "IncentiveCalculationRun_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "IncentiveScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncentiveContribution" ADD CONSTRAINT "IncentiveContribution_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "IncentiveScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncentiveContribution" ADD CONSTRAINT "IncentiveContribution_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncentiveContribution" ADD CONSTRAINT "IncentiveContribution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IncentiveCalculationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncentiveContribution" ADD CONSTRAINT "IncentiveContribution_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "IncentiveSlab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncentiveContribution" ADD CONSTRAINT "IncentiveContribution_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "IncentiveContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IncentiveContributionItem" ADD CONSTRAINT "IncentiveContributionItem_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "IncentiveContribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncentiveContributionItem" ADD CONSTRAINT "IncentiveContributionItem_purchaseInvoiceItemId_fkey" FOREIGN KEY ("purchaseInvoiceItemId") REFERENCES "PurchaseInvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. Hand-authored PostgreSQL partial unique index.
-- This is NOT expressible in schema.prisma's DSL (Prisma has no partial-index
-- syntax as of Prisma 7). It enforces at most one ACTIVE contribution per
-- (schemeId, purchaseInvoiceId) pair, which is the actual duplicate-counting
-- guard for the incentive calculation engine (see V1 Technical Design
-- Approval — Final, section "Indexes and uniqueness"). Superseded/Reversed
-- rows are explicitly allowed to coexist for the same pair; only ACTIVE rows
-- are constrained.
-- MAINTENANCE WARNING: if this migration is ever regenerated by tooling
-- (`prisma migrate diff`, `db push`, or a squash), this index will be
-- silently dropped because Prisma cannot see it in schema.prisma. It must be
-- manually re-added to any replacement migration.

CREATE UNIQUE INDEX "IncentiveContribution_active_scheme_invoice_unique"
  ON "IncentiveContribution" ("schemeId", "purchaseInvoiceId")
  WHERE "lifecycleStatus" = 'ACTIVE';
