CREATE TYPE "CrmScopeLevel" AS ENUM ('OWN', 'TEAM', 'BRANCH', 'ALL');
CREATE TYPE "CrmCommunicationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'SYSTEM');
CREATE TYPE "CrmCommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CrmDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

ALTER TABLE "Lead"
  ADD COLUMN "normalizedEmail" TEXT,
  ADD COLUMN "normalizedPhone" TEXT,
  ADD COLUMN "lostReasonId" TEXT,
  ADD COLUMN "branchId" UUID,
  ADD COLUMN "territory" TEXT,
  ADD COLUMN "productInterest" TEXT,
  ADD COLUMN "campaign" TEXT,
  ADD COLUMN "mergedIntoId" TEXT;

UPDATE "Lead" SET
  "normalizedEmail" = NULLIF(lower(trim("email")), ''),
  "normalizedPhone" = NULLIF(regexp_replace("phone", '[^0-9]', '', 'g'), '');

ALTER TABLE "CrmAssignmentRule"
  ADD COLUMN "territory" TEXT,
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "branchId" UUID;

ALTER TABLE "Opportunity"
  ADD COLUMN "forecastCategory" TEXT NOT NULL DEFAULT 'PIPELINE',
  ADD COLUMN "competitor" TEXT,
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "lostReasonId" TEXT;

ALTER TABLE "Activity"
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "reminderAt" TIMESTAMP(3),
  ADD COLUMN "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceRule" TEXT,
  ADD COLUMN "recurrenceEnd" TIMESTAMP(3),
  ADD COLUMN "parentActivityId" TEXT;

CREATE TABLE "CrmScopeRule" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "entity" TEXT NOT NULL DEFAULT 'LEAD', "scope" "CrmScopeLevel" NOT NULL DEFAULT 'OWN',
  "branchId" UUID, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmScopeRule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmLostReason" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT,
  "appliesTo" TEXT NOT NULL DEFAULT 'BOTH', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CrmLostReason_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmLeadEvent" (
  "id" TEXT NOT NULL, "companyId" TEXT, "leadId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "actorId" TEXT, "subject" TEXT NOT NULL, "data" JSONB, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmLeadEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OpportunityStageHistory" (
  "id" TEXT NOT NULL, "companyId" TEXT, "opportunityId" TEXT NOT NULL,
  "fromStage" "OpportunityStage", "toStage" "OpportunityStage" NOT NULL,
  "probability" INTEGER NOT NULL, "changedById" TEXT NOT NULL, "reason" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ActivityAttendee" (
  "id" TEXT NOT NULL, "activityId" TEXT NOT NULL, "userId" TEXT, "name" TEXT, "email" TEXT,
  "response" TEXT NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityAttendee_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmEmailTemplate" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL, "bodyText" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CrmEmailTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmCommunication" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "leadId" TEXT, "contactId" TEXT,
  "opportunityId" TEXT, "channel" "CrmCommunicationChannel" NOT NULL,
  "direction" "CrmCommunicationDirection" NOT NULL, "provider" TEXT, "externalId" TEXT,
  "threadId" TEXT, "fromAddress" TEXT, "toAddress" TEXT NOT NULL, "subject" TEXT, "body" TEXT,
  "status" "CrmDeliveryStatus" NOT NULL DEFAULT 'QUEUED', "error" TEXT, "metadata" JSONB,
  "sentById" TEXT, "sentAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3), "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmCommunication_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmCaptureToken" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "source" "LeadSource" NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3), "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmCaptureToken_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmExportJob" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "requestedById" TEXT NOT NULL, "entity" TEXT NOT NULL,
  "filters" JSONB, "status" TEXT NOT NULL DEFAULT 'PENDING', "storageKey" TEXT, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "CrmExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_companyId_normalizedEmail_idx" ON "Lead"("companyId", "normalizedEmail");
CREATE INDEX "Lead_companyId_normalizedPhone_idx" ON "Lead"("companyId", "normalizedPhone");
CREATE INDEX "Lead_branchId_assignedToId_idx" ON "Lead"("branchId", "assignedToId");
CREATE INDEX "Activity_reminderAt_reminderSentAt_idx" ON "Activity"("reminderAt", "reminderSentAt");
CREATE UNIQUE INDEX "CrmScopeRule_companyId_userId_entity_key" ON "CrmScopeRule"("companyId", "userId", "entity");
CREATE INDEX "CrmScopeRule_companyId_entity_isActive_idx" ON "CrmScopeRule"("companyId", "entity", "isActive");
CREATE UNIQUE INDEX "CrmLostReason_companyId_name_appliesTo_key" ON "CrmLostReason"("companyId", "name", "appliesTo");
CREATE INDEX "CrmLostReason_companyId_isActive_sortOrder_idx" ON "CrmLostReason"("companyId", "isActive", "sortOrder");
CREATE INDEX "CrmLeadEvent_leadId_occurredAt_idx" ON "CrmLeadEvent"("leadId", "occurredAt");
CREATE INDEX "CrmLeadEvent_companyId_type_occurredAt_idx" ON "CrmLeadEvent"("companyId", "type", "occurredAt");
CREATE INDEX "OpportunityStageHistory_opportunityId_changedAt_idx" ON "OpportunityStageHistory"("opportunityId", "changedAt");
CREATE INDEX "OpportunityStageHistory_companyId_toStage_changedAt_idx" ON "OpportunityStageHistory"("companyId", "toStage", "changedAt");
CREATE UNIQUE INDEX "ActivityAttendee_activityId_email_key" ON "ActivityAttendee"("activityId", "email");
CREATE INDEX "ActivityAttendee_activityId_idx" ON "ActivityAttendee"("activityId");
CREATE UNIQUE INDEX "CrmEmailTemplate_companyId_name_key" ON "CrmEmailTemplate"("companyId", "name");
CREATE UNIQUE INDEX "CrmCommunication_provider_externalId_key" ON "CrmCommunication"("provider", "externalId");
CREATE INDEX "CrmCommunication_leadId_createdAt_idx" ON "CrmCommunication"("leadId", "createdAt");
CREATE INDEX "CrmCommunication_companyId_channel_status_idx" ON "CrmCommunication"("companyId", "channel", "status");
CREATE INDEX "CrmCommunication_threadId_createdAt_idx" ON "CrmCommunication"("threadId", "createdAt");
CREATE UNIQUE INDEX "CrmCaptureToken_tokenHash_key" ON "CrmCaptureToken"("tokenHash");
CREATE INDEX "CrmCaptureToken_companyId_source_isActive_idx" ON "CrmCaptureToken"("companyId", "source", "isActive");
CREATE INDEX "CrmExportJob_companyId_status_createdAt_idx" ON "CrmExportJob"("companyId", "status", "createdAt");
