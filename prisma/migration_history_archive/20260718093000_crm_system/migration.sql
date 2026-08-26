-- CRM production workflow extensions
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'CSV_IMPORT';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'STATUS_CHANGE';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'IMPORT';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CONVERSION';

CREATE TYPE "LeadImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "LeadImportRowStatus" AS ENUM ('CREATED', 'SKIPPED', 'FAILED', 'DUPLICATE');
CREATE TYPE "CrmSyncStatus" AS ENUM ('NOT_SYNCED', 'QUEUED', 'SYNCED', 'FAILED');

CREATE TABLE "CrmOrganization" (
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

CREATE TABLE "LeadImportBatch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "fileName" TEXT NOT NULL,
  "status" "LeadImportStatus" NOT NULL DEFAULT 'PENDING',
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

CREATE TABLE "LeadImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNo" INTEGER NOT NULL,
  "status" "LeadImportRowStatus" NOT NULL,
  "rawData" JSONB NOT NULL,
  "normalizedData" JSONB,
  "leadId" TEXT,
  "error" TEXT,
  "duplicateLeadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityItem" (
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

CREATE TABLE "CrmSavedView" (
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

ALTER TABLE "Lead" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Lead" ADD COLUMN "lostReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "importRowNo" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "qualifiedAt" TIMESTAMP(3);

ALTER TABLE "Contact" ADD COLUMN "organizationId" TEXT;

ALTER TABLE "Opportunity" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "lostReason" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "erpSyncStatus" "CrmSyncStatus" NOT NULL DEFAULT 'NOT_SYNCED';
ALTER TABLE "Opportunity" ADD COLUMN "erpSyncError" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "wonAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN "lostAt" TIMESTAMP(3);

ALTER TABLE "Activity" ADD COLUMN "metadata" JSONB;

CREATE UNIQUE INDEX "LeadImportRow_batchId_rowNo_key" ON "LeadImportRow"("batchId", "rowNo");
CREATE UNIQUE INDEX "CrmSavedView_userId_entity_name_key" ON "CrmSavedView"("userId", "entity", "name");

CREATE INDEX "CrmOrganization_companyId_name_idx" ON "CrmOrganization"("companyId", "name");
CREATE INDEX "CrmOrganization_ownerId_idx" ON "CrmOrganization"("ownerId");
CREATE INDEX "Lead_status_source_idx" ON "Lead"("status", "source");
CREATE INDEX "Lead_assignedToId_status_idx" ON "Lead"("assignedToId", "status");
CREATE INDEX "Lead_email_idx" ON "Lead"("email");
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");
CREATE INDEX "Lead_organizationId_idx" ON "Lead"("organizationId");
CREATE INDEX "Lead_importBatchId_idx" ON "Lead"("importBatchId");
CREATE INDEX "LeadImportBatch_companyId_createdAt_idx" ON "LeadImportBatch"("companyId", "createdAt");
CREATE INDEX "LeadImportBatch_importedById_createdAt_idx" ON "LeadImportBatch"("importedById", "createdAt");
CREATE INDEX "LeadImportRow_batchId_status_idx" ON "LeadImportRow"("batchId", "status");
CREATE INDEX "Contact_email_idx" ON "Contact"("email");
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");
CREATE INDEX "Opportunity_stage_expectedClose_idx" ON "Opportunity"("stage", "expectedClose");
CREATE INDEX "Opportunity_organizationId_idx" ON "Opportunity"("organizationId");
CREATE INDEX "Opportunity_customerId_idx" ON "Opportunity"("customerId");
CREATE INDEX "OpportunityItem_opportunityId_idx" ON "OpportunityItem"("opportunityId");
CREATE INDEX "OpportunityItem_productId_idx" ON "OpportunityItem"("productId");
CREATE INDEX "Activity_leadId_createdAt_idx" ON "Activity"("leadId", "createdAt");
CREATE INDEX "Activity_opportunityId_createdAt_idx" ON "Activity"("opportunityId", "createdAt");
CREATE INDEX "Activity_userId_status_dueDate_idx" ON "Activity"("userId", "status", "dueDate");
CREATE INDEX "CrmSavedView_companyId_entity_idx" ON "CrmSavedView"("companyId", "entity");

ALTER TABLE "CrmOrganization" ADD CONSTRAINT "CrmOrganization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOrganization" ADD CONSTRAINT "CrmOrganization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "LeadImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadImportBatch" ADD CONSTRAINT "LeadImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadImportBatch" ADD CONSTRAINT "LeadImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadImportRow" ADD CONSTRAINT "LeadImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LeadImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CrmOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSavedView" ADD CONSTRAINT "CrmSavedView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSavedView" ADD CONSTRAINT "CrmSavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
