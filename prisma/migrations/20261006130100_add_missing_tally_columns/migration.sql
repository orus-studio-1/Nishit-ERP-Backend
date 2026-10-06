-- schema.prisma declares tallyGuid / tallyRawData on these models, but no earlier migration creates
-- them. Prisma selects every scalar column, so on a database built with `prisma migrate deploy`
-- (a fresh Neon/Railway database) any query on SalesInvoice, Supplier, Customer, Account or
-- PurchaseInvoice fails with P2022 "column does not exist", even though the Tally feature itself is
-- not in use.
--
-- The columns are nullable and stay empty until Tally sync runs, so adding them changes nothing for
-- existing data or behaviour. Additive only and idempotent: safe to run on a database that already
-- has them (for example one built with `prisma db push`).
ALTER TABLE "Account"         ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT, ADD COLUMN IF NOT EXISTS "tallyRawData" JSONB;
ALTER TABLE "Customer"        ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT, ADD COLUMN IF NOT EXISTS "tallyRawData" JSONB;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT, ADD COLUMN IF NOT EXISTS "tallyRawData" JSONB;
ALTER TABLE "SalesInvoice"    ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT, ADD COLUMN IF NOT EXISTS "tallyRawData" JSONB;
ALTER TABLE "Supplier"        ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT, ADD COLUMN IF NOT EXISTS "tallyRawData" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Account_tallyGuid_key"                   ON "Account"("tallyGuid");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_companyId_tallyGuid_key"         ON "Account"("companyId", "tallyGuid");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_companyId_tallyGuid_key"        ON "Customer"("companyId", "tallyGuid");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseInvoice_companyId_tallyGuid_key" ON "PurchaseInvoice"("companyId", "tallyGuid");
CREATE UNIQUE INDEX IF NOT EXISTS "SalesInvoice_companyId_tallyGuid_key"    ON "SalesInvoice"("companyId", "tallyGuid");
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_companyId_tallyGuid_key"        ON "Supplier"("companyId", "tallyGuid");
