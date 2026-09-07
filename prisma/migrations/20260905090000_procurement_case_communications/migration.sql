ALTER TABLE "SupplierCommunicationLog"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "recipient" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'LOGGED',
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT;

CREATE INDEX "SupplierCommunicationLog_rfqId_sentAt_idx" ON "SupplierCommunicationLog"("rfqId", "sentAt");
CREATE INDEX "SupplierCommunicationLog_status_queuedAt_idx" ON "SupplierCommunicationLog"("status", "queuedAt");
