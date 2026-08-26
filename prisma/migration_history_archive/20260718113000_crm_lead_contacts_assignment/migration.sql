ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "country" TEXT;

ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE TABLE IF NOT EXISTS "CrmAssignmentRule" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "source" "LeadSource",
  "city" TEXT,
  "country" TEXT,
  "minValue" DOUBLE PRECISION,
  "maxValue" DOUBLE PRECISION,
  "assignToId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmAssignmentRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Lead_city_country_idx" ON "Lead"("city", "country");
CREATE INDEX IF NOT EXISTS "Contact_leadId_idx" ON "Contact"("leadId");
CREATE INDEX IF NOT EXISTS "CrmAssignmentRule_companyId_isActive_priority_idx" ON "CrmAssignmentRule"("companyId", "isActive", "priority");
CREATE INDEX IF NOT EXISTS "CrmAssignmentRule_assignToId_idx" ON "CrmAssignmentRule"("assignToId");

DO $$ BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_assignToId_fkey" FOREIGN KEY ("assignToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
