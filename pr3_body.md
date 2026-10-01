**Summary**
Final step of the audit-unification series. Builds on PR 2 (which added `PlatformAuditLog` as the single table and migrated all writes onto it, without touching the old tables yet).

- Fixes the central `/audit-trail` page's Module filter so it also matches "rich" business-event rows that use a bare `entityType` (e.g. `PURCHASE_ORDER`, `SALES_INVOICE`, `ACCESS`) instead of the automatic `MODULE:RESOURCE` format — necessary so no data becomes invisible once the per-module endpoints below are removed.
- Drops `AuditLog`, `ProcurementAuditEvent`, `AccessAuditLog`.
- Deletes `getProcurementAuditTrail`, `getAuditLogs` (invoicing), `getAccessAuditLogs` and their routes — nothing in the frontend calls them anymore (their pages were removed in a separate frontend PR).

**Test plan**
- [x] `npx tsc --noEmit` clean
- [x] Verified live: old endpoints return 404, central `/platform/audit?module=procurement|invoicing|access` still returns the full data including business events
- [x] Verified no remaining references to the 3 dropped tables anywhere in `src/` (grep)
