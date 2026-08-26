ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "quotationId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "Activity_organizationId_createdAt_idx" ON "Activity"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Opportunity_quotationId_idx" ON "Opportunity"("quotationId");
CREATE INDEX IF NOT EXISTS "Opportunity_salesOrderId_idx" ON "Opportunity"("salesOrderId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Activity_organizationId_fkey') THEN
    ALTER TABLE "Activity" ADD CONSTRAINT "Activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Opportunity_quotationId_fkey') THEN
    ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Opportunity_salesOrderId_fkey') THEN
    ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
