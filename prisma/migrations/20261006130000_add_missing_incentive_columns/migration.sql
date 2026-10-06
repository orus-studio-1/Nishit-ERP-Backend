-- schema.prisma already declares these IncentiveScheme columns, but no earlier migration creates them.
-- Databases built with `prisma db push` have them; databases built with `prisma migrate deploy`
-- (a fresh Neon/Railway database, CI) do not, so any query on IncentiveScheme fails with P2022
-- "column does not exist".
--
-- Additive only and idempotent: nothing is dropped or rewritten, and it is safe to run on a
-- database that already has the columns.
ALTER TABLE "IncentiveScheme"
  ADD COLUMN IF NOT EXISTS "allowAnyBranch"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "autoCalculate"         TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "baselineVolume"        DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "eligibilityDateBasis"  TEXT NOT NULL DEFAULT 'INVOICE_DATE',
  ADD COLUMN IF NOT EXISTS "eligibleBranchIds"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "includedCategoryIds"   TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "includedProductIds"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "maximumIncentiveCap"   DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "minInvoiceValue"       DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "paymentConditionDays"  INTEGER,
  ADD COLUMN IF NOT EXISTS "returnHandling"        TEXT NOT NULL DEFAULT 'IGNORE_RETURNS';

-- schema.prisma declares this default; the migrations never set it.
ALTER TABLE "SalesEnquiry" ALTER COLUMN "status" SET DEFAULT 'NEW';
