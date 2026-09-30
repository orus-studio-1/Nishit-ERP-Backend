-- The 20260930010000 backfill copied rows from AuditLog and ProcurementAuditEvent, neither
-- of which had a tenantId column, so those migrated rows landed with tenantId = NULL.
-- The app's tenant-scoping Prisma proxy auto-injects a tenantId filter on every query, so
-- those rows were silently invisible through the API even though they existed in the table.
-- Backfill tenantId from each row's Company.
UPDATE "PlatformAuditLog" p
SET "tenantId" = c."tenantId"
FROM "Company" c
WHERE p."companyId" = c.id AND p."tenantId" IS NULL;
