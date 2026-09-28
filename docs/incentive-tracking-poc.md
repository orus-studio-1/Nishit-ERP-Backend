# Incentive Tracking POC — Verification Package

> **Update (after this document was written):** the engine gained two per-scheme options
> (`slabMode`: highest-slab-wins or progressive; `allowAnyTradeType`) and an API with permissions for
> managing schemes and running calculations. Statements below that say no routes exist, or that
> progressive calculation is not implemented, describe the earlier state. See
> `incentive-tracking-api.md` for the current behaviour. Automatic calculation, settlement, returns and
> trade-type assignment are still not built.

This document describes the **actual implemented behavior** of the incentive tracking POC,
verified directly against the code in this repository as of Phase 2 approval. Nothing below
is aspirational — where a capability does not exist in code, it is explicitly marked
**"Not implemented in the current POC."**

Files this document describes:
- [`src/services/incentives/incentiveCalculation.ts`](../src/services/incentives/incentiveCalculation.ts) — pure eligibility/aggregation/slab/reward logic (no DB).
- [`src/services/incentives/incentiveCalculation.service.ts`](../src/services/incentives/incentiveCalculation.service.ts) — transaction orchestration, advisory lock, run lifecycle.
- [`src/services/incentives/incentiveScheme.service.ts`](../src/services/incentives/incentiveScheme.service.ts) — minimal scheme/slab creation helpers.
- [`src/scripts/poc/incentiveTrackingPoc.ts`](../src/scripts/poc/incentiveTrackingPoc.ts) — the repeatable POC runner (existing, not duplicated).
- [`src/services/incentives/incentiveCalculation.test.ts`](../src/services/incentives/incentiveCalculation.test.ts) — 22 pure-logic unit tests.

---

## 1. POC Purpose

Prove, against the real Phase 1 schema and a real PostgreSQL database, that the Phase 2
calculation service correctly: matches manufacturer purchase-invoice lines, aggregates
eligible achievement, selects a reward slab, computes primary and alternate incentive
amounts, and maintains a traceable, non-destructive contribution lifecycle across
recalculation and cancellation — including under concurrency and mid-calculation failure.

It does **not** prove any business rule is client-approved, and it is **not** a
production-ready feature (no routes, controllers, UI, or automatic invoice-lifecycle hooks
exist).

## 2. Current Architecture and Files Involved

```text
src/scripts/poc/incentiveTrackingPoc.ts     (runner — creates data, calls the service, asserts results)
        ↓ calls
src/services/incentives/incentiveScheme.service.ts     (createIncentiveScheme, createIncentiveSlab)
src/services/incentives/incentiveCalculation.service.ts (runIncentiveCalculation, reverseContributionForInvoice)
        ↓ calls (pure, no DB)
src/services/incentives/incentiveCalculation.ts        (evaluateInvoiceEligibility, aggregateAchievement, selectSlab, computeReward)
        ↓ (service layer talks to)
Prisma / PostgreSQL — IncentiveScheme, IncentiveSlab, IncentiveCalculationRun,
                       IncentiveContribution, IncentiveContributionItem, PurchaseInvoice.tradeType
```

No route or controller exists anywhere in this chain. The only way to invoke this code today
is by calling the service functions directly (as the POC runner does) or from a future
controller not yet written.

## 3. Database Models and Relationships (verified against `prisma/schema.prisma`)

- **`IncentiveScheme`** *(1)* → has many **`IncentiveSlab`** *(1)*, **`IncentiveCalculationRun`** *(1)*, **`IncentiveContribution`** *(1)*.
- **`IncentiveSlab`** belongs to one `IncentiveScheme`; optionally referenced by many `IncentiveContribution` rows (`slabId`).
- **`IncentiveCalculationRun`** belongs to one `IncentiveScheme`; has many `IncentiveContribution` rows (`runId`).
- **`IncentiveContribution`** belongs to one `IncentiveScheme`, one `PurchaseInvoice`, one `IncentiveCalculationRun`, optionally one `IncentiveSlab`; self-references via `supersedesId`/`supersededBy`; has many **`IncentiveContributionItem`** (`lines`).
- **`IncentiveContributionItem`** belongs to one `IncentiveContribution` and references one `PurchaseInvoiceItem`.
- **`PurchaseInvoice.tradeType`** — nullable `PurchaseInvoiceTradeType` enum field, added directly onto the existing `PurchaseInvoice` model (no new table).

## 4. Exact Calculation Flow (from `incentiveCalculation.service.ts`)

1. `prisma.incentiveScheme.findUnique(...)` with slabs included. Throws if not found.
2. Validates `scheme.status === 'ACTIVE'` and `scheme.startDate <= scheme.endDate`; throws otherwise (no run row created for these two guard failures).
3. `prisma.incentiveCalculationRun.create({status: 'RUNNING', ...})` — **committed immediately, outside any later transaction.**
4. Opens `prisma.$transaction(async (tx) => {...})`:
   a. `tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'incentive-scheme:<id>')`.
   b. `tx.purchaseInvoice.findMany({include: {items: {include: {product: true}}}})` — fetches **every** invoice visible in the current tenant scope, with no `workflowStatus`/date/tradeType filter at the query level (see §9 for why).
   c. Maps each invoice through `evaluateInvoiceEligibility()`.
   d. `aggregateAchievement()` sums eligible value/quantity across all evaluated invoices.
   e. `selectSlab()` picks the highest-threshold slab ≤ achievement.
   f. `computeReward()` computes the scheme-wide primary/alt reward (for the summary) — and is called again per-invoice for each contribution's own amount.
   g. Finds all currently-`ACTIVE` contributions for the scheme and flips each to `SUPERSEDED`.
   h. For each invoice with ≥1 eligible line, creates one new `ACTIVE` `IncentiveContribution` (with `supersedesId` set if one existed) plus one `IncentiveContributionItem` per eligible line.
   i. Updates the run to `COMPLETED` with `completedAt` — **inside this same transaction.**
5. On success, returns a `CalculationSummary` object.
6. On any thrown error inside the transaction, the whole transaction rolls back, and a **separate** `prisma.incentiveCalculationRun.update({status: 'FAILED', errorMessage: ...})` call runs against the run row committed in step 3.

## 5. Exact Eligibility Rules (from `evaluateInvoiceEligibility` in `incentiveCalculation.ts`)

Checked in this order, first match wins:
1. `workflowStatus !== 'SUBMITTED'` → `NOT_SUBMITTED`.
2. `date < scheme.startDate || date > scheme.endDate` → `OUTSIDE_SCHEME_PERIOD`.
3. `tradeType === null` → `TRADE_TYPE_NULL`.
4. `!scheme.eligibleTradeTypes.includes(tradeType)` → `TRADE_TYPE_NOT_ELIGIBLE`.

If all four pass, each line is checked independently:
5. `normalizeManufacturer(product.manufacturer) !== scheme.manufacturerKey` → `MANUFACTURER_MISMATCH`.
6. `total.isNegative()` → `NEGATIVE_LINE_EXCLUDED`.

## 6. Manufacturer Normalization Behavior

```ts
export function normalizeManufacturer(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
```
`"Panasonic"`, `" panasonic "`, `"PANASONIC"` all normalize to `"panasonic"` and match.
`"Panasonic India"` normalizes to `"panasonic india"` and does **not** match `"panasonic"` —
there is no substring/fuzzy matching anywhere in this function or its caller.

## 7. Trade-Type Filtering

`PurchaseInvoice.tradeType` (nullable `PurchaseInvoiceTradeType` enum: `DISTRIBUTOR_SALE`,
`SUPER_TRADE`, `SPECIAL_TRADE`, `PROJECT_NON_SPA`, `PROJECT_SPA`) must be a non-null value
present in `IncentiveScheme.eligibleTradeTypes` (a Prisma array field on the scheme). This is
checked at the whole-invoice level — a single invoice cannot have some lines pass trade-type
filtering and others fail it; the entire invoice is in or out based on this one field.

## 8. Scheme-Date Filtering

`invoice.date` is compared against `scheme.startDate`/`scheme.endDate` using inclusive
`<`/`>` comparisons (i.e. the boundary dates themselves are eligible) — implemented as plain
JavaScript `Date` comparisons, not a database-level date range query (see §4 for why the
query itself isn't pre-filtered).

## 9. Submitted-Invoice Filtering

Implemented as a pure-function check (`workflowStatus !== 'SUBMITTED'`), **not** a
database-query filter. The service's Prisma query in step 4b (§4) deliberately fetches every
invoice regardless of status, so that the calculation summary can report an exact exclusion
reason (`NOT_SUBMITTED`, etc.) for every invoice considered, including ones that would
otherwise never appear anywhere. This is documented directly in the service file's code
comments as a POC-scale tradeoff — a production version handling large invoice volumes would
likely push `workflowStatus`/date filtering into the query itself once the per-invoice
exclusion-reason reporting requirement is relaxed or moved elsewhere.

## 10. Treatment of Negative Line Totals

A line whose calculated eligible amount is negative is **excluded entirely** from eligible
value/quantity — it is never netted against positive lines on the same invoice. This is
implemented, tested (see the unit test "negative line handling" in
`incentiveCalculation.test.ts`), and explicitly documented in code as a conservative default.

## 11. Eligible Value and Quantity Sources

- **Eligible value** = `PurchaseInvoiceItem.quantity × PurchaseInvoiceItem.unitPrice` when `amountBasis = PRE_TAX_BEFORE_DISCOUNT`
  (the default), or `quantity × unitPrice × (1 − discount/100)` when `amountBasis = PRE_TAX_AFTER_DISCOUNT`.
  `PurchaseInvoiceItem.total` is never used — it includes GST, so it is not the correct pre-tax value.
- **Eligible quantity** = `PurchaseInvoiceItem.quantity` directly.
- Both are read as `Prisma.Decimal` throughout — no plain JavaScript number arithmetic is
  used at any point in the calculation.

## 12. Slab-Selection Logic

```ts
// Highest slab whose thresholdValue <= basis wins; its reward applies to the ENTIRE achievement.
```
Implemented in `selectSlab()`: sorts slabs ascending by `thresholdValue`, walks them in order,
and keeps the last one whose threshold is `<=` the achievement basis (value or quantity, per
`measurementType`). Returns `null` if achievement is below every configured threshold (or no
slabs exist at all) — there is no "default zero-reward slab" fallback.

This highest-slab-wins behavior is explicitly confirmed for Panasonic. The alternative
(progressive/tiered — different rates applying to different achievement bands) is also
implemented and can be selected per-scheme via `slabMode = PROGRESSIVE`.

## 13. Percentage Reward Formula

```ts
if (rewardType === 'PERCENTAGE') return eligibleValue.times(rewardValue).dividedBy(100);
```
`incentiveAmount = eligibleValue × rewardValue / 100`, using `Prisma.Decimal` arithmetic
throughout (no floating-point risk).

## 14. Fixed-Per-Unit Reward Formula

```ts
// else: return eligibleQuantity.times(rewardValue);
```
`incentiveAmount = eligibleQuantity × rewardValue`.

## 15. Alternate Reward Calculation

If a slab has `altRewardType`/`altRewardValue` set, `computeReward()` applies the exact same
formula (percentage or fixed-per-unit) a second time using those values, and returns both
`primaryIncentiveAmount` and `altIncentiveAmount` together. **Neither is ever automatically
selected** — both are persisted on the `IncentiveContribution` row (`incentiveAmount` and
`altIncentiveAmount` columns). No workflow exists to record which one a human ultimately
chose — **Not implemented in the current POC.**

## 16. Contribution Lifecycle

`IncentiveContribution.lifecycleStatus` is one of `ACTIVE` / `SUPERSEDED` / `REVERSED`.
Calculation fields (`eligibleValue`, `eligibleQuantity`, `incentiveAmount`,
`altIncentiveAmount`, `calculatedAt`) are set once at creation and never updated afterward;
`lifecycleStatus` (plus `reversedAt`/`supersededAt`) is the only field ever mutated after
insert. `supersedesId` links a contribution to the one it replaced, forming a traceable chain.

## 17. Recalculation Behavior

Every call to `runIncentiveCalculation()` re-evaluates the **entire scheme period from
scratch** — there is no incremental/partial-period recalculation. Every currently-`ACTIVE`
contribution for the scheme is flipped to `SUPERSEDED` (never deleted), and a fresh `ACTIVE`
contribution is inserted for every invoice that still has ≥1 eligible line, linked via
`supersedesId` to the row it replaced. Invoices that no longer qualify simply get no new
contribution row (their prior one stays `SUPERSEDED`, not re-flagged any further).

## 18. Cancellation/Reversal Behavior

`reverseContributionForInvoice(schemeId, purchaseInvoiceId)` finds the current `ACTIVE`
contribution for that pair and sets it to `REVERSED` with `reversedAt`. **This function is
not called automatically by any invoice-cancellation code path** — `cancelVoucher()`/
`submitPurchaseInvoice()` elsewhere in this codebase have no knowledge of this module. In the
POC runner, cancellation is simulated by manually setting `workflowStatus`/`status` to
`CANCELLED` on the invoice and then explicitly calling this function. **Automatic wiring is
not implemented in the current POC.**

## 19. Calculation-Run Lifecycle

`IncentiveCalculationRun.status`: `RUNNING` → `COMPLETED` (success, set inside the main
transaction) or `RUNNING` → `FAILED` (via a separate transaction after the main one rolled
back, with `completedAt` and a redacted `errorMessage`). There is **no code that detects or
cleans up a run stuck at `RUNNING`** (e.g. from a crashed process) — **not implemented.**

## 20. Transaction and Advisory-Lock Behavior

- The `RUNNING` run row (step 3, §4) is created and committed **before** the main
  calculation transaction opens — confirmed by reading the code: it is a plain `await
  prisma.incentiveCalculationRun.create(...)` call, not inside the later `$transaction(...)`.
- The main transaction acquires `pg_advisory_xact_lock(hashtext('incentive-scheme:<id>'))` as
  its first statement — this is a session-scoped (actually transaction-scoped, per
  `pg_advisory_xact_lock`) lock automatically released when the transaction ends, keyed
  per-scheme so different schemes never block each other.
- On error, the catch block runs a second, independent `prisma.incentiveCalculationRun.update(...)`
  call (not wrapped in the failed transaction) to persist `FAILED`.

## 21. Partial Unique-Index Behavior

```sql
CREATE UNIQUE INDEX "IncentiveContribution_active_scheme_invoice_unique"
  ON "IncentiveContribution" ("schemeId", "purchaseInvoiceId")
  WHERE "lifecycleStatus" = 'ACTIVE';
```
Confirmed present in the live database via direct `pg_indexes` query (see Phase 1 report).
This index is **not** expressible in `schema.prisma` (Prisma has no partial-index syntax) and
was hand-written into the migration SQL file with an explicit maintenance warning that future
tool-generated migrations could silently drop it. It is the database-level backstop
independent of whether the service's own supersede-then-insert application logic behaves
correctly.

## 22. Current Business Assumptions (not client-confirmed)

- Highest-slab-wins, not progressive/tiered (§12).
- Negative lines excluded, not netted (§10).
- `tradeType = NULL` excluded by default, not assumed eligible.
- `IncentiveScheme.bookingChannel` is informational text only — no automated eMitra check
  exists because no booking-channel data source exists anywhere in this ERP.
- Alternate reward is never auto-selected; a human must decide later (§15).

## 23. Deferred Functionality — **Not implemented in the current POC**

- API routes, controllers, or any UI.
- Automatic hook from real invoice submission/cancellation into this module.
- Settlement or credit-note reconciliation of any kind.
- Purchase-returns handling (`PurchaseReturn` links to `PurchaseReceipt`, not
  `PurchaseInvoice` — no code path connects a return to a contribution reversal).
- A dedicated `Manufacturer` master table (matching is a normalized string comparison against
  the existing free-text `Product.manufacturer` field only).
- Stale-`RUNNING`-run detection/cleanup.
- Notifications of any kind.
- Cash/gold (or any alternate-reward) selection workflow.

## 24. Known Production Risks

- **Full-table invoice scan.** The calculation query fetches every invoice with no
  status/date pre-filter (§9) — fine at POC data volumes, a real performance concern at
  production scale.
- **Silent zero-match on manufacturer typos.** A misspelled or differently-worded
  `Product.manufacturer` string produces zero matches with no warning or validation.
- **Partial unique index invisible to Prisma tooling** (§21) — a future migration
  regeneration could drop it without anyone noticing until a duplicate-counting bug appears.
- **No stale-run detection** (§19) — a crashed process leaves a permanently `RUNNING` row with
  no alert.
- **No automatic reversal on real cancellation** (§18) — until wired in, cancelling an invoice
  through the normal ERP flow does not update any incentive contribution, silently leaving
  stale `ACTIVE` numbers unless someone remembers to recalculate.

---

## Repeatable Execution Process

### Required environment variables
`DATABASE_URL` (and `DATABASE_URL_UNPOOLED`, used for direct verification queries) — already
present in this project's `.env`, pointing at the configured Neon PostgreSQL database. No
additional POC-specific environment variables are required.

### Required database state
The Phase 1 migration (`20260918100000_incentive_scheme_tracking_phase1`) must be applied.
Verify with:
```bash
npx prisma migrate status
```
Expected output: `Database schema is up to date!`

### Exact commands
```bash
npm run incentive:poc                     # full run: seed, calculate, recalc, cancel, verify
npm run incentive:poc -- --cleanup-only   # remove only this POC's own data, no recreate
npm test                                  # pure calculation-logic unit tests (no DB needed)
npx vitest run src/services/incentives    # just the incentive test files
```

### How test data is created
The runner (`incentiveTrackingPoc.ts`) creates: one supplier, four products (two Panasonic,
one Samsung, one with a null manufacturer), one `IncentiveScheme` with three slabs, and eight
`PurchaseInvoice` records (Cases A–H) covering every eligibility branch.

### How test data is isolated
The runner creates (or reuses) its own dedicated `Tenant` (slug `poc-incentive-tenant`) and
`Company` (slug `poc-incentive-company`), and wraps all work in `runWithTenant({tenantId,
companyId}, ...)`. Every record it creates is additionally tagged with the marker
`POC-INCENTIVE-2026` in a code/SKU/invoice-number field.

### How the POC avoids touching real production data
It never queries or writes to any tenant/company other than its own dedicated sandbox — there
is no code path in the runner that omits a `companyId`/tenant scope, and Prisma's tenant proxy
(`src/utils/tenant.ts`) enforces this automatically for every model carrying a `companyId`
field.

### How existing POC data is detected or cleaned
Step 0 of every run (`cleanupPocData()`) looks up any `IncentiveScheme` under the POC company
whose `code` starts with the marker, and any `PurchaseInvoice` whose `invoiceNo` starts with
the marker, and deletes them (and their dependent contributions/items/runs/slabs/invoice
items) before recreating fresh data. Products and the supplier are deleted the same way, by
SKU/supplierNo prefix.

### How to execute the calculation
`npm run incentive:poc` calls `runIncentiveCalculation()` directly four times in sequence:
initial run, a no-op recalculation, a post-cancellation recalculation, and two concurrent
recalculations — plus one standalone failure-handling demonstration.

### How to verify the output
The runner prints full per-invoice/per-line eligibility detail, the calculation summary, and
runs 31 in-script assertions (`assertEqual`/`assertTrue`) comparing actual results to the
manually pre-calculated expected numbers below. It ends with a single `POC RESULT` line
stating pass/fail, and exits non-zero if any assertion failed.

### How to clean up afterward
`npm run incentive:poc -- --cleanup-only` — leaves only the (empty, harmless, reused) POC
tenant/company shell behind.

---

## Sample Business Scenario

- **Scheme name / code**: "Panasonic FY2026 Trade Incentive (POC)" / `POC-INCENTIVE-2026-PANASONIC-FY26`
- **Manufacturer**: `manufacturerLabel = "Panasonic"`, `manufacturerKey = "panasonic"`
- **Scheme period**: 2026-04-01T00:00:00.000Z to 2027-03-31T23:59:59.999Z
- **Eligible trade types**: `DISTRIBUTOR_SALE`, `SUPER_TRADE`, `SPECIAL_TRADE`
- **Slabs** (all `PERCENTAGE`): ₹0 → 0.10%, ₹500,000 → 0.15%, ₹1,000,000 → 0.25%
- **Products**: Panasonic AC (₹30,000/unit), Panasonic TV (₹40,000/unit), Samsung TV
  (₹25,000/unit), Unbranded Cable (null manufacturer)

| Invoice | Date | Status | Trade type | Items | Expected result | Reason |
|---|---|---|---|---|---|---|
| A | 2026-06-01 | SUBMITTED | DISTRIBUTOR_SALE | AC×10 (₹300,000) + TV×5 (₹200,000) | Eligible, ₹500,000 | — |
| B | 2026-06-01 | SUBMITTED | DISTRIBUTOR_SALE | Samsung TV×10 (₹250,000) | Excluded, ₹0 | MANUFACTURER_MISMATCH |
| C | 2026-06-01 | SUBMITTED | DISTRIBUTOR_SALE | AC×10 (₹300,000) + Samsung TV×10 (₹250,000) | Partially eligible, ₹300,000 only | Samsung line MANUFACTURER_MISMATCH |
| D | 2026-06-01 | SUBMITTED | PROJECT_NON_SPA | AC×10 (₹300,000) | Excluded, ₹0 | TRADE_TYPE_NOT_ELIGIBLE |
| E | 2025-01-01 | SUBMITTED | DISTRIBUTOR_SALE | AC×10 (₹300,000) | Excluded, ₹0 | OUTSIDE_SCHEME_PERIOD |
| F | 2026-06-01 | DRAFT | DISTRIBUTOR_SALE | AC×10 (₹300,000) | Excluded, ₹0 | NOT_SUBMITTED |
| G | 2026-06-01 | SUBMITTED | null | AC×10 (₹300,000) | Excluded, ₹0 | TRADE_TYPE_NULL |
| H | 2026-07-01 | SUBMITTED | DISTRIBUTOR_SALE | AC×2 (₹60,000) | Eligible, ₹60,000 | — (later cancelled in the runner) |

**Expected cumulative eligible value** (initial run): 500,000 + 300,000 + 60,000 = **₹860,000**
**Expected cumulative eligible quantity**: 15 + 10 + 2 = **27 units**

**Expected selected slab**: ₹500,000 threshold (860,000 has crossed it but not reached ₹1,000,000)

**Manual calculation — primary incentive**:
```
860,000 × 0.15 / 100 = ₹1,290.00
```

**Alternate incentive**: none configured on this slab — `altIncentiveAmount` is `null` in this
scenario. (Alternate-reward math is separately covered by a dedicated unit test using an
RCCB-style slab — see `incentiveCalculation.test.ts`, "computes both primary and alternate
rewards.")

**After cancelling invoice H** and recalculating: eligible value drops to 500,000 + 300,000 =
**₹800,000**, still the ₹500,000 slab (0.15%): `800,000 × 0.15 / 100 = ₹1,200.00`.

---

## Verification Checklist

- [x] Scheme is created correctly — verified: `manufacturerKey="panasonic"`, 3 slabs attached.
- [x] Slabs are created correctly — ₹0/0.10%, ₹500,000/0.15%, ₹1,000,000/0.25%, confirmed selectable.
- [x] Eligible submitted invoice is included — Case A: eligibleValue=500000.
- [x] Wrong manufacturer is excluded — Case B: eligibleValue=0, reason=MANUFACTURER_MISMATCH.
- [x] Mixed invoice counts only eligible lines — Case C: eligibleValue=300000, not 550000.
- [x] Wrong trade type is excluded — Case D: reason=TRADE_TYPE_NOT_ELIGIBLE.
- [x] Out-of-period invoice is excluded — Case E: reason=OUTSIDE_SCHEME_PERIOD.
- [x] Non-submitted invoice is excluded — Case F: reason=NOT_SUBMITTED.
- [x] Null trade type is excluded — Case G: reason=TRADE_TYPE_NULL.
- [x] Manufacturer normalization works — verified by unit test (not exercised at runtime by the runner's own data, which uses exact-case "Panasonic"/"Samsung" strings only).
- [x] Negative-line behavior matches documentation — verified by unit test only; the runner's sample invoices contain no negative lines.
- [x] Correct cumulative achievement is calculated — 500000+300000+60000=860000.00, matched exactly.
- [x] Correct slab is selected — ₹500,000/0.15% slab, matched exactly.
- [x] Incentive amount matches manual calculation — 1290.00, matched exactly.
- [x] Contribution items are traceable — confirmed via `lines` count per contribution (2, 1, 1) in final-state printout.
- [x] Recalculation supersedes old contributions — 3 superseded, 3 new ACTIVE, 6 rows total, none deleted.
- [x] Only ACTIVE contributions are included in active totals — verified via explicit `lifecycleStatus: 'ACTIVE'` filtering in every summary/assertion.
- [x] Cancellation reverses the contribution — invoice H contribution flipped to REVERSED with reversedAt set.
- [x] Failed runs are persisted as FAILED — demo run persisted with redacted errorMessage.
- [x] Concurrent calculations do not create duplicate ACTIVE contributions — 2 concurrent recalcs left exactly 2 ACTIVE, no duplicate pairs.
- [x] POC cleanup does not affect unrelated data — cleanup removed exactly 1 scheme + 8 invoices (this run's own data), by marker+company scope.

All 21 items verified against the actual run captured for this task (see the implementation
report) — none of these checkmarks are assumed.
