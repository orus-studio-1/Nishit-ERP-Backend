# Orus ERP engineering specification gap audit

Audit date: 2026-08-19  
Specification audited: version 1.0, all 2,580 lines, sections 0–24  
Code audited: `ERP-Backend` authored source/schema/migrations and `ERP-Frontend` authored source  

## Executive verdict

The current product is a substantial pre-spec ERP prototype, not an implementation of the new specification. It has working foundations for company-scoped RBAC, CRM, sales, invoicing, inventory, procurement, accounting, HR, projects, and notifications. It does **not** yet have the required tenant/company/plant architecture, hardened authentication, universal document infrastructure, or the greenfield manufacturing/quality/GST/mobile layers.

Repository inventory:

| Measure | Present |
|---|---:|
| Prisma models | 136 |
| Backend route declarations | 256 |
| Authored backend service files | 6 |
| Frontend pages | 95 |
| Authored automated tests | **0** |
| Backend TypeScript build | Pass |
| Frontend production build | Pass (89 generated routes) |

Overall specification status:

| Classification | Meaning |
|---|---|
| Existing | A useful implementation exists, although it is not automatically spec-complete |
| Partial | Similar entities/APIs exist, but important required behavior or exact API is absent |
| Missing | No meaningful authored implementation was found |

The largest release blocker is the platform foundation. Building manufacturing on the current `companyId == tenant` assumption would create expensive rework.

## P0 release blockers

1. **Tenancy model is wrong for the specification.** There is no `Tenant` or `Branch/Plant` model. `Company` is the isolation boundary and `companyId` is nullable on many records. The spec requires `tenantId NOT NULL` on every business table, multiple companies per tenant, multiple plants per company, tenant-leading indexes, and GSTIN at company/state level.
2. **Isolation can be bypassed.** The Prisma proxy adds `companyId`, but create operations preserve a caller-supplied `companyId` (`args.data.companyId || context`). It skips enforcement when no async context exists, does not cover raw SQL, nested relation writes, or non-listed models, and uses `findUnique` with extra filters. There are no leakage tests.
3. **Authentication fails the target design.** Access JWT defaults to one hour and is stored in browser `localStorage`; password hashing is bcrypt. No opaque rotating refresh cookie, token family/reuse detection, session list/revoke, forgot/reset password, TOTP/recovery codes, company switch, or account/IP exponential lockout exists.
4. **Global API contract differs.** Routes use `/api`, not `/api/v1`. List responses and query support are inconsistent. There is no universal `page/limit/sort/q/status/from/to/include/fields` implementation and errors do not consistently carry machine-readable `code` and field `errors`.
5. **Universal document lifecycle is absent.** Individual controllers implement their own statuses. There is no shared document base/service guaranteeing DRAFT → SUBMITTED → CANCELLED → amended draft, immutable submitted documents, atomic ledger effects, provenance, cancellation reason, and suffix numbering.
6. **Idempotency and optimistic concurrency are absent.** No `Idempotency-Key` store/replay behavior, row `version`, `If-Match`, `STALE_VERSION`, or systematic row locking of item/warehouse bins exists.
7. **Numbering is not compliant.** A `NumberingSeries` model and increment helpers exist, but IDs use CUID rather than UUIDv7; several documents receive numbers before submit; no GSTIN scope, proper plant scope, amendment suffix, guaranteed gap-free submit allocation, or explicit `SELECT ... FOR UPDATE` implementation exists.
8. **Audit trail is only a feature-specific table.** `AuditLog` and `AccessAuditLog` exist, but there is no universal ORM interceptor, immutable DB privilege design, monthly partitioning, seven-year policy, full document provenance, or complete mutation coverage.
9. **No attachment subsystem.** No object storage, presigned upload/download, checksum, scan worker, availability state, or document versioning endpoints exist. The generic `Document` model stores a URL and is not the specified attachment implementation.
10. **No approval engine.** A few statuses and HR approval endpoints exist, but no approval rules/instances/steps, amount thresholds, sequential/parallel flow, delegation, escalation, pending inbox, TOTP requirement, or reusable service exists.
11. **No job infrastructure.** There is only an in-process interval for recurring invoices. No durable queue, retry/dead-letter behavior, worker observability, or required scheduled jobs exist.
12. **No tests.** The spec explicitly makes two-tenant tests and definitions of done mandatory. There are no backend or frontend test files or test scripts.

## Module-by-module audit

| Spec section | Status | What exists now | Missing or materially incomplete |
|---|---|---|---|
| 1 Global conventions | Partial | JSON responses, Prisma decimals in important ledger services, enum strings, some transactions | `/api/v1`, standard list contract, UUIDv7, consistent money/base fields, DATE vs TIMESTAMPTZ discipline, soft-delete policy, universal lifecycle, idempotency, concurrency/versioning |
| 2.1 Multi-tenancy | Partial/unsafe | AsyncLocalStorage and Prisma company filter; tenant-related migrations | Actual Tenant hierarchy, company/plant/GSTIN model, non-null `tenantId`, tenant-leading indexes, safe forced writes, raw/nested enforcement, dedicated-DB resolver, leakage CI |
| 2.2 Identity | Partial | Register/login/logout/me/profile/change-password, JWT verification, tokenVersion revocation, rate limiter | Exact target endpoints and refresh/session/2FA/reset/switch-company flows; 15-min access TTL; secure cookie; Argon2id; reuse detection; lockout |
| 2.3 RBAC | Partial | Permission catalogue, roles, assignments, allow/deny, access UI and APIs | Tenant/company/branch scoped UserRole semantics, `ScopeRule` and OWN/TEAM/BRANCH filtering, all prescribed system roles, exact effective-permissions endpoint behavior, mandatory 2FA for approvers |
| 2.4 Numbering | Partial | Model plus atomic DB increment helpers | Submit-only allocation everywhere, GSTIN/FY scope and formatting, locks/gap-free guarantee, UUIDv7, amendments |
| 2.5 Audit | Partial | AuditLog, AccessAuditLog, audit-log UI/API | Universal automatic capture, append-only DB guarantees, partitions/retention, request/IP/user-agent/diff completeness, provenance on all documents |
| 2.6 Attachments | Missing | Generic project `Document` URL record only | Entire specified service and five APIs, S3, presigning, AV scan, versions |
| 2.7 Notifications | Partial | In-app Notification model; list/read/read-all endpoints | Email and push delivery, preferences/templates, event catalogue, retries, deep links, P1 SMS/WhatsApp |
| 2.8 Approvals | Missing | Isolated HR leave and status actions | Reusable approval entities, service, queue/rules APIs, thresholds, delegation/escalation, audit and notification integration |
| 2.9 Background jobs | Missing | One optional `setInterval` recurring-invoice scheduler | Queue/workers, retry/dead-letter/monitoring and all scheduled operational jobs |
| 2.10 Subscription/billing | Partial | Recurring invoice `SubscriptionTemplate` feature | Tenant plan/entitlement enforcement, limits, trial/billing lifecycle, middleware and billing administration |
| 2.11 Public API/webhooks | Missing | No general public API/webhook platform | API keys/scopes, rate limits, webhook subscriptions/signatures/retries/delivery logs |
| 2.12 Import/export | Partial | CRM lead import preview/batches; a few report downloads implied | Shared mapping/validation/error-file/asynchronous framework across masters and transactions |
| 2.13 Print/templates | Partial | Invoice PDF, print formats, several invoice reports | General document template engine, versioning, preview, company/branch defaults and every specified printable document |
| 2.14 Settings | Partial | Company and several module settings fields/pages | Typed hierarchical tenant/company/branch/user settings service, validation, audit and effective-value API |
| 3 Shared masters | Partial | Product, Category, Unit, Warehouse, Customer, Supplier, PriceList, UOM conversions, batches/serials; screens | Spec's expanded Item/ItemGroup/UOM, party/group/address/contact, territory, tax/category, currency/exchange, plant/warehouse/bin, cost center/project masters and exact item APIs/fields/rules |
| 4 CRM | Partial (strongest match) | Leads, contacts, organizations, opportunities/items, activities, assignment rules, saved views, import, pipeline/dashboard, detail/list screens | Exact dedupe API/rules, merge, manual/bulk assign, lose route contract, full timeline, export, public capture, IndiaMART/Facebook, opportunity stage/win/lose/quotation endpoints, forecast/my-day/calendar, email sync/tracking, WhatsApp, all five dashboards, formal ScopeRule enforcement |
| 5 Sales | Partial | Quotations and sales orders CRUD/status; conversion; stock reservation service; invoices and delivery notes; screens | Enquiries, exact submit/cancel/revise/send/accept/hold/close/fulfilment APIs, approval/credit flow, numbering on submit, production plan linkage, contract pricing hierarchy, statutory place-of-supply logic, order-book/conversion/delivery/variance reports |
| 6 Stock ledger engine | Partial (useful core) | StockLedgerEntry, StockLevel, FIFO layers, moving average/standard valuation, reservations, batch/serial checks, GL posting/reversal helpers | Row locks/concurrency, immutable append-only guarantees, backdated repost algorithm, negative-stock controls at full scope, complete serial/batch traceability, reconciliation tests, exact valuation invariants |
| 7 Inventory | Partial | Products/categories/warehouses, stock movements/entries, stock reports, pricing, UOM, batch/serial; UI | Material request under `/inventory`, exact submit/cancel/issue/PO actions, reconciliation/count workflow, in-transit transfer orders, reorder/batch-expiry/ageing/traceability/barcode endpoints, QC integration and specified rules |
| 8 Procurement | Partial (broad prototype) | Settings, terms, supplier items, material requests, RFQ, supplier quotations, blanket PO, PO, receipt, basic inspection, landed cost, purchase invoice/payment, communication; UI; service-layer stock/GL posting | Exact send/comparison/select/acknowledge/amend/close/GRN/match/report APIs, true 3-way-match enforcement/tolerances, QC hold/rejected warehouse, computed vendor rating, TDS/RCM/ITC/MSME rules, overdue jobs and immutable lifecycle |
| 9 Manufacturing | **Missing** | Product enum has `MANUFACTURE`; no manufacturing domain | All BOM/routing/work center/machine/work order/job card/time log/downtime/WIP/scrap models, services, APIs, shop-floor UI, reports and rules |
| 10 PPC/MRP | **Missing** | MaterialRequest type can say manufacture | Production plans, exact MRP algorithm, runs/suggestions/pegging, capacity/calendar/ATP, machine-load UI/APIs, forecast imports |
| 11 Quality management | **Missing** (procurement inspection is not this module) | One shallow `QualityInspection` tied to purchase receipts | Quality plans/templates/characteristics/readings, incoming/in-process/final gates, instruments/calibration, NCR/CAPA/deviation, SPC/capability/Western Electric, certificates, reports, immutable correction flow |
| 12 Gate/security | **Missing** | None | Gate entry/pass/visitor/weighbridge entities, flows, offline tablet behavior, APIs, alerts and reports |
| 13 Subcontracting/job work | **Missing** | None | Orders/challans/receipts/vendor stock/ITC-04/yield reporting and 180-day controls |
| 14 Accounting/finance | Partial (useful core) | Accounts/tree, FY/periods, journal entries/lines, GL, cost centers, budgets, bank lines, fixed assets, templates/recurrence/closing models, core balanced posting/reversal, core reports/screens | Exact append-only DB enforcement, party/control and required-cost-center validation, soft/hard close semantics, year-end close, multi-currency revaluation, payment allocation API parity, depreciation/disposal behavior, cash flow and full drill-down/report suite |
| 15 GST/tax/invoicing | Partial invoice foundation; **GST platform missing** | Sales invoice/items/tax records, tax templates, credit notes, payment entries, PDFs/revenue/outstanding/ageing, HSN field | Tax-rule engine and server recomputation to spec, GSTIN model/validation/place of supply, CGST/SGST/IGST/RCM/ITC rules, IRN/e-invoice, e-way bill, GSTR-1/3B/2B reconciliation, HSN/ITC/RCM reports, statutory cancellation windows, Indian amount-in-words and explicit round-off posting |
| 16 HR/payroll | Partial (broad HR prototype) | Employees, departments, positions, attendance/checkins, shifts, leave policy/allocation/ledger, salary components/structures, payroll entries/slips, lifecycle, ESS-style pages/APIs | Device sync/geofence/selfie processing/regularization/muster/late/overtime; contractor model; async approved payroll runs; GL posting/bank file/PDF/bulk email; PF/ESI/PT/TDS/24Q/Form16; declarations; statutory formulas and tests |
| 17 Vendor portal/ECN/PPAP | **Missing** | Supplier master/communications only | Portal identity/access, RFQ/PO collaboration, ASN, invoice view, ECN, drawing revisions, PPAP/APQP workflows |
| 18 Reporting/analytics | Partial | Module-specific reports and chart pages | Shared report metadata/query/export/scheduling/drill-down framework, row security, audit, BI layer and complete prescribed report catalogue |
| 19 Mobile applications | **Missing** | Web app only | All persona apps, offline encrypted queue/sync/conflict strategy, barcode/camera/push, secure token storage and mobile tests |
| 20 Non-functional | Mostly missing/unproven | Helmet, CORS, auth limiter, graceful shutdown, successful builds | Performance/load budgets, scale tests, HA/backup/RPO/RTO, OWASP controls, encryption/key management, observability/traces/metrics/alerts, SAST/dependency/penetration regime, unit/integration/e2e/contract/leakage tests |
| 21 Packaging | Missing | Navigation permission gating | Product bundles, entitlements, plan enforcement and commercial packaging |
| 22 Build sequence | Not followed | Several later modules exist | Required foundation phase is incomplete; manufacturing/quality/PPC remain absent |
| 23 Risk register | Risks active | Some use of Prisma Decimal and transactions helps | Tenancy, GST, payroll, stock concurrency, manufacturing domain expertise, offline mobile and integrations remain unresolved |
| 24 Open decisions | Open | Node/TypeScript/Postgres/Prisma are evident | Founder decisions on stack confirmation, WhatsApp, GSP, on-premise, design-partner terms and statutory review are not represented in code and remain decisions |

## Existing authored backend services

Only six files are organized as services:

| Service | Real capability | Important limitations |
|---|---|---|
| `accounting/ledger.service.ts` | Balanced debit/credit validation, account validation, fiscal-period lookup, base-currency lines, reversal, balance recomputation | No DB append-only enforcement, party/control/cost-center completeness, soft-close privilege logic, row locking or test proof |
| `inventory/stockLedger.service.ts` | Stock snapshots, moving average/FIFO/standard rates, FIFO layers, negative-stock checks, batch/serial requirements, stock/GL writes, transfers | Uses derived balance overwrite without explicit row locks; no backdated reposting, in-transit flow or comprehensive traceability |
| `inventory/pricing.service.ts` | Current pricing support | Does not implement the full spec resolution hierarchy/contract behavior |
| `inventory/reservation.service.ts` | Sales stock reservation support | No universal concurrency/idempotency and incomplete fulfilment workflow |
| `sales/salesOrder.service.ts` | Sales order transactional support | Not the complete prescribed lifecycle/credit/approval/fulfilment engine |
| `procurement/procurement.service.ts` | Totals, conversions, receipt stock posting, invoice GL posting, supplier payment, cancellation | Missing true three-way matching, statutory rules, approvals/QC gates and exact spec workflows |

Most business logic remains in controllers. This conflicts with the specification's explicit requirement that business rules live in service-layer code.

## Existing API/module surface (grouped)

All current routes are mounted under `/api`, not `/api/v1`.

| Current prefix | Existing surface |
|---|---|
| `/api/auth` | register, login, logout, me, profile, change-password, users |
| `/api/access` | summary/bootstrap, permission catalogue, role CRUD/permissions, users/roles/overrides and audit-related administration |
| `/api/accounting` | account/fiscal-year/period/journal/cost-center/budget/bank/fixed-asset/template/recurrence/closing CRUD and multiple ledger/financial reports |
| `/api/inventory` | product/category/warehouse/stock movement/stock entry/pricing/UOM/batch/serial APIs plus stock, projected, reservation, valuation, sales, gross-profit and slow-moving reports |
| `/api/hr` | dashboard/employee/org, attendance/check-in, shifts, leave, salary structures, payroll entries/slips, lifecycle and self profile |
| `/api/crm` | lead/import/activity/assignment-rule/contact/organization/opportunity/saved-view APIs and pipeline/dashboard |
| `/api/sales` | quotations and orders, including conversion-oriented routes |
| `/api/invoicing`, `/api/invoices`, `/api/payments` | sales invoices/lifecycle/PDF, delivery conversion, payments/allocations, credit notes, tax/print/subscription, ledger/audit and invoice reports |
| `/api/procurement` | settings, payment terms, supplier items, material requests, RFQs, quotations, blanket POs, POs, receipts, inspections, landed cost, invoices, supplier payments, communications/dashboard |
| `/api/projects` | projects, tasks, milestones, comments and members (existing product feature, not a major new-spec module) |
| `/api/customers`, `/api/suppliers`, `/api/products` | legacy/general master CRUD and lookup |
| `/api/notifications` | list, mark one read, mark all read |
| `/api/dashboard` | aggregate dashboard statistics |

## Entirely absent specified API families

No authored route family was found for:

- `/attachments/*`
- `/approvals/*`
- public API keys or general `/webhooks/*`
- `/manufacturing/*`
- `/planning/*`
- `/quality/*` (the procurement inspection CRUD is not the required QMS)
- `/gate/*`
- `/subcontracting/*`
- `/gst/*`
- vendor portal/ECN/PPAP
- mobile sync APIs

The exact auth endpoints `/refresh`, `/logout-all`, `/forgot-password`, `/reset-password`, `/2fa/enroll`, `/2fa/verify`, `/switch-company`, `/sessions`, and `/sessions/:id` are also absent.

## Frontend audit

Existing UI areas are login/register, dashboard, RBAC settings, CRM, customer/supplier masters, sales quotations/orders, inventory and reports, procurement, invoicing and reports, accounting, HR/payroll, and projects. These are genuine authored pages and the production build succeeds.

There are no screens for tenant/company/plant administration, secure sessions/2FA, attachments, approvals inbox/rules, universal imports/exports/templates/settings, manufacturing shop floor, BOM/routing/work orders, MRP/capacity, full QMS/SPC/CAPA, gate/security, subcontracting, GST/e-invoice/e-way bill/returns, vendor portal, or mobile applications.

Security-critical frontend mismatch: `AuthContext` and the Axios interceptor persist/read the access token and user from `localStorage`; there is no refresh-cookie flow.

## Data and correctness hazards found

- Primary keys are predominantly `cuid()`, not UUIDv7.
- `Company` lacks required legal entity fields/relations (`tenantId`, legal name, PAN, CIN, fiscal year start, addresses, plants and state-specific GST registrations).
- `User.email` is globally unique, which may or may not fit the future tenant identity model and needs an explicit decision.
- Tenant context is actually `companyId`; naming it tenancy hides the hierarchy mismatch.
- Tenant middleware accepts a supplied company ID on create instead of overwriting it with the trusted context.
- Tenantless calls silently run unscoped, which is particularly dangerous for jobs and scripts.
- Models not included in the hand-maintained tenant set can escape filtering; the model list is a maintenance hazard.
- Financial and stock code frequently converts Decimal results to JavaScript `Number` before persistence or response. This violates the no-JS-number arithmetic rule and can lose precision.
- Several transactional controllers expose delete/status mutations independently instead of the universal lifecycle.
- Some documents allocate numbers during create/draft operations, which can burn statutory numbers.
- Controllers contain substantial business logic, contrary to the required service boundary.
- In-process scheduling is lost on restart and duplicates across horizontally scaled instances unless carefully locked per job.
- No OpenAPI/contract definition was found, making exact API compatibility hard to enforce.

## Recommended implementation order

1. Freeze new domain work and implement the platform contract: `/api/v1`, envelopes/errors/query parser, UUIDv7, Decimal rules, DATE conventions.
2. Migrate `Company-as-tenant` to `Tenant → Company → Plant/Branch → GST registration`; make tenant keys non-null and add safe data-layer enforcement plus exhaustive two-tenant tests.
3. Replace authentication with short access JWT + rotating opaque refresh sessions, Argon2id, reset/2FA/lockout/session APIs, and remove browser token persistence.
4. Build reusable document lifecycle, provenance, idempotency, optimistic concurrency, transactional numbering, audit, attachment, approval, job and settings services.
5. Stabilize shared masters and retrofit existing CRM/sales/inventory/procurement/accounting/invoicing/HR modules to those services; add unit, integration, reversal, concurrency and cross-tenant tests.
6. Build the greenfield P0 domains in dependency order: manufacturing → QMS gates/instruments → GST/statutory invoicing; then P1 PPC/MRP, gate and subcontracting.
7. Add shared reporting/export, notifications, mobile/offline and portal capabilities after the underlying transactional contracts are stable.

## Release conclusion

**Do not label any module specification-complete yet.** CRM, inventory ledger, procurement, accounting, invoicing and HR contain valuable working foundations, but every module fails at least one mandatory global requirement and none has definition-of-done test evidence. Manufacturing, PPC/MRP, full QMS, gate/security, subcontracting, GST compliance, attachments, approval workflows, mobile and vendor portal are missing rather than merely unfinished.
