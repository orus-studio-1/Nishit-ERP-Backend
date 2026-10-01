-- Copy existing rows from AuditLog, ProcurementAuditEvent and AccessAuditLog into
-- PlatformAuditLog, the table that becomes the single uniform audit log (per the
-- schema in 20260930000000_platform_audit_log_unify_columns).
--
-- Data-only migration: no source table is dropped here, no source row is deleted.
-- actorEmail/actorRole (AuditLog) are intentionally not copied -- they're resolved
-- by joining userId -> User at read time, same as PlatformAuditLog already does.
-- invoiceId/deliveryNoteId/creditNoteId (AuditLog) are intentionally not copied --
-- entityId already holds the same id in every existing row, so no lookup is lost.
-- rfqId (ProcurementAuditEvent) is intentionally not copied -- it was a secondary
-- grouping reference; entityId/entityType already identify the audited record.

-- From AuditLog
INSERT INTO "PlatformAuditLog"
  (id, "companyId", "userId", "entityType", "entityId", action, "statusBefore", "statusAfter", message, diff, "createdAt")
SELECT
  uuidv7(), "companyId", "actorId", "entityType"::text, "entityId", action, "statusBefore", "statusAfter", message, diff, "createdAt"
FROM "AuditLog";

-- From ProcurementAuditEvent
INSERT INTO "PlatformAuditLog"
  (id, "companyId", "userId", "entityType", "entityId", action, message, before, after, "createdAt")
SELECT
  uuidv7(), "companyId", "actorId", "entityType", "entityId", action, message, before, after, "createdAt"
FROM "ProcurementAuditEvent";

-- From AccessAuditLog
INSERT INTO "PlatformAuditLog"
  (id, "companyId", "userId", "entityType", "entityId", action, "targetUserId", "targetRoleId", message, before, after, "createdAt")
SELECT
  uuidv7(), "companyId", "actorId", 'ACCESS', COALESCE("targetUserId", "targetRoleId"), action, "targetUserId", "targetRoleId", message, before, after, "createdAt"
FROM "AccessAuditLog";
