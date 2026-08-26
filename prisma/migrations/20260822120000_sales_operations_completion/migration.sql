ALTER TABLE "SalesEnquiry"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "followUpAt" TIMESTAMP(3),
  ADD COLUMN "followUpStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "lossReason" TEXT,
  ADD COLUMN "lostAt" TIMESTAMP(3);

CREATE TABLE "SalesCommunication" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
  "kind" TEXT NOT NULL,
  "recipient" TEXT,
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LOGGED',
  "sentAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesCommunication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesCommunication_companyId_entityType_entityId_createdAt_idx"
  ON "SalesCommunication"("companyId", "entityType", "entityId", "createdAt");
CREATE INDEX "SalesCommunication_status_createdAt_idx"
  ON "SalesCommunication"("status", "createdAt");
