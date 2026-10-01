-- Drop the three legacy audit tables now that PlatformAuditLog is the single, uniform
-- audit log: their data was copied over in 20260930010000/20260930020000, and every
-- write/read path (utils/erp.ts, controllers/access.controller.ts,
-- controllers/procurement/shared.ts and audit.controller.ts, invoicingExtras/reports.controller.ts)
-- has been switched over to PlatformAuditLog. Nothing in the codebase references these
-- tables anymore.
DROP TABLE "AccessAuditLog";
DROP TABLE "AuditLog";
DROP TABLE "ProcurementAuditEvent";
