ALTER TYPE "LeadSource" ADD VALUE 'INDIA_MART';
ALTER TYPE "LeadSource" ADD VALUE 'FACEBOOK_LEAD_ADS';
ALTER TYPE "LeadSource" ADD VALUE 'WHATSAPP';

CREATE TABLE "CrmIntegrationAccount" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "account" TEXT NOT NULL, "credentialsEncrypted" TEXT NOT NULL,
  "syncCursor" TEXT, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "lastSyncedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CrmIntegrationAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmIntegrationAccount_companyId_provider_account_key" ON "CrmIntegrationAccount"("companyId", "provider", "account");
CREATE INDEX "CrmIntegrationAccount_companyId_provider_status_idx" ON "CrmIntegrationAccount"("companyId", "provider", "status");
