-- Add optional columns to PlatformAuditLog so it can become the single, uniform
-- audit table (superset of AuditLog, ProcurementAuditEvent, AccessAuditLog).
-- All new columns are nullable -- purely additive, no existing data touched,
-- no other table changed yet.
ALTER TABLE "PlatformAuditLog"
  ADD COLUMN "statusBefore" TEXT,
  ADD COLUMN "statusAfter" TEXT,
  ADD COLUMN "targetUserId" TEXT,
  ADD COLUMN "targetRoleId" TEXT,
  ADD COLUMN "message" TEXT;

CREATE INDEX "PlatformAuditLog_targetUserId_createdAt_idx" ON "PlatformAuditLog"("targetUserId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetRoleId_createdAt_idx" ON "PlatformAuditLog"("targetRoleId", "createdAt");
