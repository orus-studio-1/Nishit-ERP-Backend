ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_companyId_idx" ON "Lead"("companyId");
CREATE INDEX IF NOT EXISTS "Contact_companyId_idx" ON "Contact"("companyId");
CREATE INDEX IF NOT EXISTS "Opportunity_companyId_idx" ON "Opportunity"("companyId");
CREATE INDEX IF NOT EXISTS "Activity_companyId_idx" ON "Activity"("companyId");
