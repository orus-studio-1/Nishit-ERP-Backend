ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'VIEWED';
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'UNDER_NEGOTIATION';
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_STOCK';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_READY';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'READY_TO_DISPATCH';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DISPATCHED';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'FULLY_DISPATCHED';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DELIVERED';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplyPolicy" TEXT NOT NULL DEFAULT 'STOCK';
ALTER TABLE "SalesEnquiry" ADD COLUMN IF NOT EXISTS "originalMessage" TEXT;
ALTER TABLE "SalesEnquiry" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "SalesEnquiry" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
ALTER TABLE "SalesEnquiry" ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "revisionReason" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "negotiationNote" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "customerNotes" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "sentPdfUrl" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "customerPoNo" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "acceptanceAttachmentUrl" TEXT;

ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "requestedDeliveryDate" TIMESTAMP(3);
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "committedDeliveryDate" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "completionDate" TIMESTAMP(3);

ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "readyQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "pickedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "dispatchedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "returnedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "shortClosedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "incomingQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "requestedDeliveryDate" TIMESTAMP(3);
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "committedDeliveryDate" TIMESTAMP(3);
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "supplyStatus" TEXT NOT NULL DEFAULT 'PENDING_CHECK';
ALTER TABLE "DeliveryNoteItem" ADD COLUMN IF NOT EXISTS "returnedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SalesCommitmentAlert" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "salesOrderId" TEXT NOT NULL,
  "salesOrderItemId" TEXT,
  "alertKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "action" TEXT,
  "actionHref" TEXT,
  "dueAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesCommitmentAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesCommitmentAlert_alertKey_key" ON "SalesCommitmentAlert"("alertKey");
CREATE INDEX IF NOT EXISTS "SalesCommitmentAlert_companyId_status_severity_idx" ON "SalesCommitmentAlert"("companyId", "status", "severity");
CREATE INDEX IF NOT EXISTS "SalesCommitmentAlert_salesOrderId_status_idx" ON "SalesCommitmentAlert"("salesOrderId", "status");

CREATE TABLE IF NOT EXISTS "SalesAlertPolicy" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "warningDays" JSONB NOT NULL DEFAULT '[7,3,1,0]'::jsonb,
  "notifyAssignedSalesperson" BOOLEAN NOT NULL DEFAULT true,
  "notifyManagers" BOOLEAN NOT NULL DEFAULT true,
  "notifyProcurement" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesAlertPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesAlertPolicy_companyId_key" ON "SalesAlertPolicy"("companyId");

CREATE TABLE IF NOT EXISTS "QuotationArtifact" (
  "id" TEXT NOT NULL,
  "quotationId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "content" BYTEA NOT NULL,
  "checksum" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuotationArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuotationArtifact_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "QuotationArtifact_quotationId_key" ON "QuotationArtifact"("quotationId");
