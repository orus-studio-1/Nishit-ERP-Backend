# Incentive Tracking Module — Full Context & Explanation

> **Update (after this document was written):** the engine gained several per-scheme options
> (`slabMode`: highest-slab-wins or progressive; `allowAnyTradeType`; `eligibleSupplierIds`/`allowAnySupplier`;
> `rewardExcludedProductIds`; `amountBasis`; per-line `tradeType` on invoice items) and an API with permissions for
> managing schemes and running calculations. Statements below that say no routes exist, or that
> progressive calculation is not implemented, describe the earlier state. See
> `incentive-tracking-api.md` for the current behaviour. The eligible amount per line is
> `quantity × unitPrice` (not `PurchaseInvoiceItem.total`, which includes GST). Highest-slab-wins
> is confirmed for Panasonic. Automatic calculation, settlement, returns and
> trade-type assignment are still not built.

This document explains, in plain language backed by exact code references, what has
actually been built so far (Phase 1: database design, Phase 2: calculation service),
what remains provisional, and what is deferred. Nothing described as "implemented" here
is speculative — every claim is backed by a real file/model/function in this repository.
Where something is a design decision awaiting business confirmation, it is explicitly
marked as such.

---

## 1. The Business Problem

### What is an incentive scheme?

A manufacturer (e.g. Panasonic) wants its distributors to buy more of its products.
Instead of just cutting prices, it runs a rebate program: *"buy this much of our stuff in
this period, and we'll pay you back a percentage (or a fixed amount) of it afterward."*
That rebate program is the **incentive scheme**.

### Why manufacturers issue these circulars

The circulars we were given (Panasonic/Anchor Switchgear, Wiring Devices, RCCB, Isolator
schemes) are exactly this: a printed announcement saying "buy ₹X worth of category Y between
these two dates, and you get Z% back," usually with several tiers ("slabs") — buy more, get a
better rate.

### Why "just store a percentage" isn't enough

A single percentage field can't answer any of the questions the business actually needs
answered:

- *Which of our purchases even count?* (Only Panasonic products. Only certain billing
  types. Only within the scheme dates. Only invoices that were actually finalized, not
  drafts.)
- *How much have we bought so far?* (This has to be summed from real invoice data, not
  guessed.)
- *Which reward tier have we reached?* (₹4 lakh gets one rate, ₹7 lakh gets a better rate.)
- *How much money does that translate to?*
- *Six months from now, if someone asks "why did we get ₹1,290 for this scheme," can we
  show exactly which invoices and which product lines produced that number?*

That last question — **auditability** — is why this needed a proper database design, not
a spreadsheet field.

### The core concepts, and what's implemented vs deferred

| Concept | What it means | Implemented now? |
|---|---|---|
| **Scheme** | The rebate program itself (manufacturer, dates, rules) | **Yes** — `IncentiveScheme` |
| **Slab** | A reward tier ("buy this much, get this rate") | **Yes** — `IncentiveSlab` |
| **Target** | A specific numeric goal to hit (the client's original example: "sell 5,000 items") | **Not a separate model.** In this implementation, a slab's `thresholdValue` *is* the target for that tier — there's no separate "Target" entity, because every real scheme document we were given is slab-based, not single-target-based. |
| **Eligibility** | The rules deciding which invoices/lines count at all | **Yes** — pure logic in `incentiveCalculation.ts` |
| **Achievement** | The running total of eligible value/quantity | **Yes** — computed fresh on every calculation run |
| **Contribution** | The record of exactly how much one invoice added to the scheme's total | **Yes** — `IncentiveContribution` + `IncentiveContributionItem` |
| **Calculation run** | The audit record of "when did we calculate this, and did it succeed" | **Yes** — `IncentiveCalculationRun` |
| **Settlement** | Actually receiving the money/credit note from the manufacturer and reconciling it | **No — not implemented, not modeled, not started.** |

---

## 2. Client Documents and Business Context

The client provided several real Panasonic/Anchor circulars (Switchgear Quarterly Scheme,
Isolator Monthly Scheme, RCCB Special Offer, Wiring Devices H1 TOD, All-In-One Modular
Scheme, eMitra incentive announcement) plus a handwritten note classifying Panasonic
purchases as:

```
Panasonic Purchases
├── Trade
│   ├── Distributor Sale
│   ├── Super Trade
│   └── Special Trade
└── Project
    ├── Non-SPA
    └── SPA Sale
```

### Requirement-by-requirement status

| Requirement | Implemented in current work? | Explanation |
|---|---|---|
| Scheme configuration | **Yes** | `IncentiveScheme` + `IncentiveSlab` models exist and are populated via `createIncentiveScheme`/`createIncentiveSlab` helper functions. No admin UI to create one yet — only via code/script. |
| Manufacturer filtering | **Yes** | Exact, normalized string match against `Product.manufacturer`. No dedicated `Manufacturer` master table exists (deliberately deferred — see §13). |
| Trade-type filtering | **Yes** | `PurchaseInvoice.tradeType` (5-value enum matching the handwritten classification) gates eligibility at invoice-header level. |
| Slab calculation | **Yes, configurable** | "Highest slab reached wins" (Panasonic default) and "Progressive/tiered" are both implemented and selectable per scheme. |
| eMitra validation | **No** | `IncentiveScheme.bookingChannel` is a free-text field for human reference only. There is no field anywhere in the ERP recording which channel a purchase invoice was booked through, so no automated check is possible today. |
| Settlement | **No** | Nothing connects a calculated incentive to an actual incoming credit note or payment from Panasonic. |
| Returns | **No** | The ERP's `PurchaseReturn` model links to `PurchaseReceipt`, not `PurchaseInvoice` — there is no code path connecting a return to reversing an incentive contribution. |
| Notifications | **No** | Not started. |

---

## 3. Existing ERP Architecture (verified from the repository)

- **Backend**: Express 5 + TypeScript, no separate frontend in this repository.
- **Database**: PostgreSQL (hosted on Neon), accessed via **Prisma 7** (`@prisma/adapter-pg`).
- **Multi-tenancy**: every tenant-scoped table has a `companyId` column. Scoping is enforced
  *automatically* — a Prisma Client Proxy (`src/lib/prisma.ts` + `src/utils/tenant.ts`)
  injects `companyId` into every query based on the logged-in user's company, tracked via
  Node's `AsyncLocalStorage` for the duration of a request. This means the incentive models,
  simply by having a `companyId` field (where applicable), are automatically tenant-isolated
  without any extra code in the incentive service itself.
- **Service/controller/route structure**: `routes/*.ts` → `controllers/<domain>/*.ts` →
  `services/<domain>/*.ts` → Prisma directly (no repository layer).
- **Auth**: JWT-based, with a permission system (`Permission`/`AccessRole`/`RolePermission`)
  checked via `requireModuleAccess`/`requirePermission` middleware.
- **Transactions**: `prisma.$transaction(async (tx) => {...})`, with `pg_advisory_xact_lock`
  used elsewhere in the codebase (invoice numbering, ledger posting, stock updates) for
  serializing concurrent writes — the incentive service follows this exact same pattern.
- **Testing**: Vitest. Existing tests mock Prisma entirely (no real database in CI). This
  module's pure logic tests follow that convention; its lifecycle/transaction behavior is
  instead verified against the real (dev) database via a POC script, because mocking a real
  Postgres transaction and advisory lock would not actually prove anything about them.

### Where the incentive module fits today

```text
(nothing yet — no route, no controller)
     ↓
Incentive Calculation Service   <-- src/services/incentives/incentiveCalculation.service.ts
     ↓
Prisma / PostgreSQL
     ↓
IncentiveScheme, IncentiveSlab, IncentiveCalculationRun,
IncentiveContribution, IncentiveContributionItem
```

**Important**: there is no API route, no controller, and no UI. The work so far is
**database schema + a callable service function**, invoked directly (by a script, or in
principle by future code) — not something a user can trigger by clicking a button anywhere
yet. This is exactly the boundary Phase 2 was scoped to stop at.

---

## 4. Phase 1 — Database Design (verified against `prisma/schema.prisma`)

### `IncentiveScheme`

```prisma
model IncentiveScheme {
  id                       String                     @id @default(cuid())
  companyId                String?
  manufacturerKey          String
  manufacturerLabel        String
  name                     String
  code                     String?
  description              String?
  startDate                DateTime
  endDate                  DateTime
  measurementType          IncentiveMeasurementType
  eligibleTradeTypes       PurchaseInvoiceTradeType[]
  allowAnyTradeType        Boolean                    @default(false)
  slabMode                 IncentiveSlabMode          @default(HIGHEST_SLAB_WINS)
  amountBasis              IncentiveAmountBasis       @default(PRE_TAX_BEFORE_DISCOUNT)
  eligibleSupplierIds      String[]                   @default([])
  allowAnySupplier         Boolean                    @default(false)
  rewardExcludedProductIds String[]                   @default([])
  bookingChannel           String?
  status                   IncentiveSchemeStatus      @default(DRAFT)
  ...
  @@index([companyId, status])
  @@index([companyId, manufacturerKey])
}
```

- **`manufacturerLabel` vs `manufacturerKey`**: the label is the *display* string, exactly as
  written on the circular ("Panasonic"). The key is a *normalized* version (trimmed,
  lowercased, whitespace-collapsed — "panasonic") computed once when the scheme is created.
  Every eligibility check compares normalized-to-normalized, never the display string, so
  "Panasonic", " panasonic ", "PANASONIC" all match, but "Panasonic India" never does.
- **`name`/`code`**: human-readable identifiers; `code` is used by the seed to safely tag and
  clean up its own test data.
- **`startDate`/`endDate`**: the scheme's validity window — invoices outside this range never
  count, no matter what else matches.
- **`measurementType`**: `VALUE` or `QUANTITY` — decides whether slab thresholds and rewards
  are based on purchase value (₹) or unit count.
- **`eligibleTradeTypes`**: an array of the trade-type enum — an invoice must have one of
  these values to be considered at all (unless `allowAnyTradeType` is true).
- **`eligibleSupplierIds`**: list of `Supplier.id` values. Only invoices from one of these
  suppliers count. Empty + `allowAnySupplier = false` causes calculation to reject the scheme.
- **`allowAnySupplier`**: when true, any supplier qualifies and `eligibleSupplierIds` is ignored.
- **`rewardExcludedProductIds`**: products whose lines count toward the slab but earn no reward.
  Only meaningful on `HIGHEST_SLAB_WINS` schemes.
- **`amountBasis`**: which dollar amount the engine reads from each line.
  `PRE_TAX_BEFORE_DISCOUNT` = `quantity × unitPrice` (default, confirmed for Panasonic).
  `PRE_TAX_AFTER_DISCOUNT` = `quantity × unitPrice × (1 − discount/100)`.
- **`bookingChannel`**: free text, informational only (see §2 — no automated validation).
- **`status`**: `DRAFT`/`ACTIVE`/`CLOSED`/`CANCELLED` — only `ACTIVE` schemes can be
  calculated; this is enforced in code, not just documented.
- **Indexes**: `(companyId, status)` for "give me all active schemes for this company"
  dashboard-style queries; `(companyId, manufacturerKey)` for "find schemes for this
  manufacturer" lookups.

### `IncentiveSlab`

```prisma
model IncentiveSlab {
  id             String               @id @default(cuid())
  schemeId       String
  thresholdValue Decimal              @db.Decimal(18, 6)
  rewardType     IncentiveRewardType
  rewardValue    Decimal              @db.Decimal(18, 6)
  altRewardType  IncentiveRewardType?
  altRewardValue Decimal?             @db.Decimal(18, 6)
  sortOrder      Int
  @@unique([schemeId, thresholdValue])
  @@unique([schemeId, sortOrder])
}
```

- **`thresholdValue`**: the cumulative achievement level this tier kicks in at (e.g.
  ₹500,000).
- **`rewardType`/`rewardValue`**: `PERCENTAGE` (e.g. 0.15%) or `FIXED_PER_UNIT` (e.g. ₹14 per
  piece).
- **`altRewardType`/`altRewardValue`**: an optional second reward option for schemes like the
  RCCB one, which offers "₹55 per piece *or* 5 grams of gold" — both get computed, neither
  is auto-picked.
- **Why unique on `(schemeId, thresholdValue)`**: two slabs in the same scheme can't claim
  the same threshold — that would be an ambiguous configuration (which one applies at exactly
  that value?).
- **Why unique on `(schemeId, sortOrder)`**: prevents two slabs from being assigned the same
  display/evaluation order, which would make "the next slab up" undefined.

### `IncentiveCalculationRun`

```prisma
model IncentiveCalculationRun {
  id           String             @id @default(cuid())
  schemeId     String
  status       IncentiveRunStatus @default(RUNNING)
  reason       IncentiveRunReason
  triggeredBy  String?
  startedAt    DateTime           @default(now())
  completedAt  DateTime?
  errorMessage String?
}
```

- **Why it exists**: every time the system calculates a scheme's achievement, this row
  records *that it happened*, *why* (`INITIAL`/`INVOICE_SUBMITTED`/`INVOICE_CANCELLED`/
  `MANUAL_RECALC`), *whether it succeeded*, and *what went wrong if it didn't*. Without this,
  there would be no way to answer "did the incentive calculation actually run last night, and
  did it work?"
- **States**: `RUNNING` (in progress or, if stuck, crashed mid-way), `COMPLETED` (succeeded),
  `FAILED` (an error occurred, with `errorMessage` recorded).
- **Auditability/debugging value**: if a client asks "why does the incentive total look
  wrong," you can look at the run history and see exactly when it was last recalculated,
  whether that run succeeded, and (via `IncentiveContribution.runId`) which contributions came
  from which run.

### `IncentiveContribution`

```prisma
model IncentiveContribution {
  id                 String   @id @default(cuid())
  schemeId           String
  purchaseInvoiceId  String
  runId              String
  slabId             String?
  eligibleValue      Decimal  @db.Decimal(18, 6)
  eligibleQuantity   Decimal  @db.Decimal(18, 6)
  incentiveAmount    Decimal  @db.Decimal(18, 6)
  altIncentiveAmount Decimal? @db.Decimal(18, 6)
  calculatedAt       DateTime @default(now())
  lifecycleStatus    IncentiveContributionStatus @default(ACTIVE)
  reversedAt         DateTime?
  supersededAt       DateTime?
  supersedesId       String?
}
```

- **What it represents**: "this specific purchase invoice added this much to this specific
  scheme's total, and here's the incentive amount that portion is worth."
- **Why linked to a purchase invoice**: because eligibility, and therefore achievement, is
  fundamentally about *purchases* (per the client's own documents — these are rebates on what
  Eastern Traders buys from Panasonic, not what it sells onward).
- **`eligibleValue`/`eligibleQuantity`**: the portion of that invoice that actually counted
  (only the eligible lines — see §7), not the whole invoice.
- **`slabId`**: which slab tier was in effect *at the time of this calculation* — kept even
  after the slab's own rate might later change, so history stays accurate.
- **`incentiveAmount`/`altIncentiveAmount`**: both computed, neither auto-selected.
- **`lifecycleStatus`**: `ACTIVE` (currently counts), `SUPERSEDED` (replaced by a newer
  calculation), `REVERSED` (the invoice was cancelled, so this no longer counts) — see §10.
- **`supersedesId`**: points at the contribution this one replaced, forming a traceable chain
  of "how did this number change over time."

### `IncentiveContributionItem`

```prisma
model IncentiveContributionItem {
  id                    String  @id @default(cuid())
  contributionId        String
  purchaseInvoiceItemId String
  productId             String
  quantity              Decimal @db.Decimal(18, 6)
  eligibleValue         Decimal @db.Decimal(18, 6)
  countForReward        Boolean @default(true)
  @@unique([contributionId, purchaseInvoiceItemId])
}
```

- **Why invoice-level alone is insufficient**: an invoice can contain *both* Panasonic and
  Samsung products. If the contribution only recorded "this invoice contributed ₹300,000,"
  nobody could later verify *which lines* made up that ₹300,000, or catch a bug where the
  whole invoice's value got counted instead of just the Panasonic portion.
- **What it stores**: a direct pointer to the exact `PurchaseInvoiceItem` row, plus a
  *snapshot* of the quantity and value (`quantity × unitPrice`, per the scheme's `amountBasis`)
  that were counted at calculation time.
- **`countForReward`**: false for lines whose product is in the scheme's
  `rewardExcludedProductIds` — the line counted for the slab but not the payout.
- **Why a snapshot, not a live reference**: if the invoice item is later edited, this
  historical record of "what we counted, and when" must not silently change — that would
  break auditability.
- **Practical value**: a client (or auditor) can ask "show me every product line that
  contributed to this ₹1,290 incentive" and get an exact list of invoice line items, not a
  guess.

### `PurchaseInvoice.tradeType`

```prisma
tradeType PurchaseInvoiceTradeType?
```

- **Why added**: the handwritten classification document (Trade → Distributor Sale/Super
  Trade/Special Trade; Project → Non-SPA/SPA Sale) is a real business concept the circulars
  reference ("Trade purchases only... Special Trade billing will not be considered"), and
  **nothing in the existing ERP represented it before this work** — confirmed by grepping the
  entire codebase and schema.
- **How it affects eligibility**: an invoice's `tradeType` must be one of the scheme's
  `eligibleTradeTypes`, checked *before* any line-level manufacturer matching happens.
- **Why nullable**: every invoice created before this feature existed has no value here, and
  there is currently no operational workflow telling accounts staff *when* to set which
  value — making it required would have broken existing data and existing invoice creation.
- **What happens when NULL**: the invoice is **excluded** from every scheme, by design — see
  §7. It is treated as "we don't know," not "assume it's fine."

### Incentive-related enums, in plain English

| Enum | Values | Meaning |
|---|---|---|
| `IncentiveMeasurementType` | `VALUE`, `QUANTITY` | Is this scheme's achievement measured in rupees or in units? |
| `IncentiveRewardType` | `PERCENTAGE`, `FIXED_PER_UNIT` | Is the reward a % of value, or a flat amount per unit? |
| `IncentiveSchemeStatus` | `DRAFT`, `ACTIVE`, `CLOSED`, `CANCELLED` | Lifecycle of the scheme configuration itself — only `ACTIVE` schemes calculate. |
| `IncentiveContributionStatus` | `ACTIVE`, `SUPERSEDED`, `REVERSED` | Lifecycle of one contribution record — see §10. |
| `IncentiveRunStatus` | `RUNNING`, `COMPLETED`, `FAILED` | Lifecycle of one calculation attempt. |
| `IncentiveRunReason` | `INITIAL`, `INVOICE_SUBMITTED`, `INVOICE_CANCELLED`, `MANUAL_RECALC` | Why a calculation happened — audit context. |
| `PurchaseInvoiceTradeType` | `DISTRIBUTOR_SALE`, `SUPER_TRADE`, `SPECIAL_TRADE`, `PROJECT_NON_SPA`, `PROJECT_SPA` | The handwritten business classification, now a real field. |

---

## 5. Database Constraints and Indexes — Why the Partial Unique Index Matters

### The problem it solves

We need to guarantee: **at most one `ACTIVE` contribution can exist for a given
(scheme, invoice) pair, at any moment** — otherwise the system could double-count the same
invoice's contribution toward the same scheme.

### Why a *normal* unique constraint would be wrong

If we simply wrote `@@unique([schemeId, purchaseInvoiceId])` on the whole table, the very
first recalculation would fail — because recalculating deliberately creates a **second** row
for the same (scheme, invoice) pair (the new `ACTIVE` one), while the old row is kept as
`SUPERSEDED` history, not deleted. A plain unique constraint can't tell the difference between
"two active rows for the same pair" (a real bug) and "one active + one superseded row for the
same pair" (completely normal, expected history).

### Why history must be kept

If old `SUPERSEDED`/`REVERSED` rows were deleted, nobody could later answer "what did we
think the incentive was *before* this recalculation, and why did it change?" That
traceability is the entire point of this design.

### The actual solution: a partial index

```sql
CREATE UNIQUE INDEX "IncentiveContribution_active_scheme_invoice_unique"
  ON public."IncentiveContribution" ("schemeId", "purchaseInvoiceId")
  WHERE "lifecycleStatus" = 'ACTIVE';
```

This tells PostgreSQL: "enforce uniqueness on `(schemeId, purchaseInvoiceId)`, but **only
among rows where `lifecycleStatus = 'ACTIVE'`**." Rows with any other status are invisible to
this constraint, so as many `SUPERSEDED`/`REVERSED` rows as needed can coexist for the same
pair — but the moment a second `ACTIVE` row for the same pair is attempted, the database
itself rejects the insert.

### Practical duplicate example

Suppose invoice A already has one `ACTIVE` contribution for the scheme. If a bug (or a race
condition between two simultaneous recalculations) tried to insert a *second* `ACTIVE`
contribution for that same invoice+scheme without first flipping the old one to `SUPERSEDED`,
the database would throw a constraint-violation error on the insert — the transaction fails,
rolls back, and (per Phase 2's design) the calculation run is marked `FAILED` with the error
recorded. The bug gets caught immediately, loudly, instead of silently producing a wrong,
double-counted total.

### Why it's not in `schema.prisma`

Prisma's schema language (as of the version used here, Prisma 7) has no syntax for a
*conditional* ("partial") unique index — its `@@unique`/`@@index` directives always produce
whole-table constraints. This particular index had to be hand-written directly into the
migration SQL file, bypassing Prisma's schema-to-SQL generation for just this one statement.

### The migration-maintenance risk this creates

Because Prisma doesn't know this index exists (it's invisible to `schema.prisma`), any future
tool-driven migration regeneration (`prisma migrate diff`, `db push`, or a migration "squash")
could silently drop it without any warning, since Prisma would see no reason to keep an index
it never generated. This is documented directly inside the migration file itself as a
maintenance warning, but it remains a real, standing risk that whoever touches migrations
next needs to know about.

---

## 6. Phase 2 — Calculation Service, Step by Step

Two files split the responsibility:
- **`src/services/incentives/incentiveCalculation.ts`** — pure math/rules, no database calls.
- **`src/services/incentives/incentiveCalculation.service.ts`** — the actual database
  orchestration (transactions, locking, run lifecycle), calling into the pure file.

| Step | What happens | Why | Responsible code | Reads | Writes | What could go wrong |
|---|---|---|---|---|---|---|
| 1. Load scheme | Fetch `IncentiveScheme` + its slabs | Need the rules before doing anything | `runIncentiveCalculation()` | `IncentiveScheme`, `IncentiveSlab` | — | Scheme ID doesn't exist → throws immediately, no run row created |
| 2. Validate scheme | Check `status === 'ACTIVE'` and `startDate ≤ endDate` | Refuse to calculate against a draft/closed/misconfigured scheme | same function | — | — | Throws before any run row exists — a bad scheme never even gets a FAILED run logged, by design (it's a caller error, not a calculation failure) |
| 3. Create RUNNING run | Insert `IncentiveCalculationRun{status: RUNNING}` | Start the audit trail | same function | — | `IncentiveCalculationRun` | — |
| 4. Commit before calculating | This insert happens **outside** the big transaction, on its own | So the run row survives even if the calculation itself fails | same function (separate `await prisma.incentiveCalculationRun.create(...)` call, not inside `$transaction`) | — | — | — |
| 5. Acquire advisory lock | `SELECT pg_advisory_xact_lock(hashtext('incentive-scheme:<id>'))` | Stop two simultaneous recalculations of the *same* scheme from interleaving | inside the `$transaction` callback | — | — | If the lock can't be acquired instantly, the second caller simply waits (not fails) until the first transaction ends |
| 6. Load invoices | Fetch every `PurchaseInvoice` (with items + product) for the tenant | Need the raw data to evaluate | same transaction | `PurchaseInvoice`, `PurchaseInvoiceItem`, `Product` | — | At real-world scale this fetches *all* invoices, not just candidates — acceptable for the current data volume, flagged in code comments as something to revisit |
| 7. Invoice-level eligibility | Check `workflowStatus`, date range, `tradeType` | These are whole-invoice facts per the circulars' own wording ("Billing Type Considered") | `evaluateInvoiceEligibility()` in the pure file | — | — | A wrongly-tagged `tradeType` silently excludes/includes an invoice — no validation catches a data-entry mistake |
| 8. Line-level manufacturer match | Normalize `Product.manufacturer`, compare to `scheme.manufacturerKey` | Manufacturer eligibility is a per-product fact, not per-invoice | same function | — | — | A typo'd manufacturer string on a product (e.g. "Panasonics") silently produces zero matches, no error |
| 9. Exclude negative/invalid lines | A line with negative `total` is excluded, not netted | Conservative default — a negative line isn't a documented "return" concept anywhere in this schema | same function | — | — | This is a default assumption — see §7 |
| 10. Aggregate | Sum eligible value/quantity across every eligible line of every eligible invoice | This is "how much have we achieved, cumulatively, this scheme period" | `aggregateAchievement()` | — | — | — |
| 11. Select slab | Evaluates the slab mode (`HIGHEST_SLAB_WINS` or `PROGRESSIVE`) | Both modes are fully implemented and selectable per scheme | `selectSlab()` | — | — | — |
| 12. Primary reward | `eligibleValue × rate / 100` or `eligibleQuantity × rate` | The actual formula from the circulars | `computeReward()` | — | — | — |
| 13. Alternate reward | Same formula, using the slab's alt reward config, if any | RCCB-style "cash or gold" schemes | same function | — | — | Never auto-picked between the two |
| 14. Supersede old contributions | Every current `ACTIVE` row for this scheme flips to `SUPERSEDED` | Preserve history instead of overwriting | inside the transaction | `IncentiveContribution` | `IncentiveContribution.lifecycleStatus` | — |
| 15. Create new contributions | One new `ACTIVE` row per invoice that has ≥1 eligible line | Fresh, current numbers | inside the transaction | — | `IncentiveContribution` | — |
| 16. Create contribution items | One row per eligible line, snapshotting quantity/value | Line-level traceability (§4) | inside the transaction | — | `IncentiveContributionItem` | — |
| 17. Mark COMPLETED | Flip the run row to `COMPLETED` with `completedAt` | Close out the audit trail — **inside the same transaction** as steps 14-16, so it's atomic with them | inside the transaction | — | `IncentiveCalculationRun` | — |
| 18. Handle failure | If *any* step inside the transaction throws, the whole transaction rolls back (nothing from 14-17 is kept); then a **separate** `prisma.incentiveCalculationRun.update()` call marks the already-committed run row `FAILED`, with a redacted error message | The run row from step 3 survived the rollback because it was committed separately — this is the whole reason step 4 exists | `catch` block in `runIncentiveCalculation()` | — | `IncentiveCalculationRun.status/errorMessage` | If the FAILED-marking update itself somehow fails, the run is left stuck at `RUNNING` forever — a known, undetected gap (see §11) |

---

## 7. Eligibility Logic, With Examples

Every rule below is real code in `incentiveCalculation.ts`, checked in this exact order:

1. `workflowStatus === 'SUBMITTED'` — else excluded, reason `NOT_SUBMITTED`.
2. `date` between `scheme.startDate` and `scheme.endDate` inclusive — else `OUTSIDE_SCHEME_PERIOD`.
3. Supplier in `scheme.eligibleSupplierIds` (or `scheme.allowAnySupplier`) — else `SUPPLIER_NOT_ELIGIBLE`.
4. `tradeType !== null` — else `TRADE_TYPE_NULL` (skipped when `scheme.allowAnyTradeType`).
5. `tradeType` is in `scheme.eligibleTradeTypes` — else `TRADE_TYPE_NOT_ELIGIBLE` (skipped when `scheme.allowAnyTradeType`).

Only if all five pass does the code look at individual lines:

6. Normalized manufacturer match — else `MANUFACTURER_MISMATCH`.
7. Per-line `tradeType` check (if the line carries its own `tradeType`, the same rules as 4–5 apply to it).
8. Line eligible amount ≥ 0 — else `NEGATIVE_LINE_EXCLUDED`.

The line's eligible amount is `quantity × unitPrice` when `amountBasis = PRE_TAX_BEFORE_DISCOUNT`
(the default), or `quantity × unitPrice × (1 − discount/100)` when
`amountBasis = PRE_TAX_AFTER_DISCOUNT`. `PurchaseInvoiceItem.total` is never used — it includes
GST and the discount, so it is not the pre-tax-before-discount value.

### Normalization examples (from the actual test suite)

```text
"Panasonic"       → "panasonic"
" PANASONIC "     → "panasonic"
"Pana  sonic"     → "pana sonic"   (internal whitespace collapsed, but still distinct from "panasonic")
```

These deliberately do **not** match `"panasonic"`:

```text
"Panasonic India"
"Panasonic Consumer"
```

There is no fuzzy or partial matching anywhere — this was a deliberate choice, because
fuzzy-matching manufacturer names risks silently pulling in a different, unrelated product
line's purchases into the wrong scheme.

### The mixed-invoice example (verified with real numbers)

```text
Invoice total: ₹550,000
  Panasonic AC line: ₹300,000  → eligible
  Samsung line:      ₹250,000  → excluded (MANUFACTURER_MISMATCH)

Counted toward the scheme: ₹300,000, NOT ₹550,000.
```

This was verified against a real database in the POC run: an invoice containing both
Panasonic and Samsung lines produced an eligible value of exactly ₹300,000 — the Panasonic
line only — never the full ₹550,000 invoice total. This is the single most important
correctness property of this design, and it's the reason the calculation happens line-by-line
rather than reading `PurchaseInvoice.subtotal` directly.

---

## 8. Calculation Formulas

### Percentage reward

```text
Incentive = Eligible Value × Reward Percentage / 100
```
Example: ₹1,000,000 eligible × 0.10% = ₹1,000.

### Fixed-per-unit reward

```text
Incentive = Eligible Quantity × Reward Per Unit
```
Example: 500 units × ₹20 = ₹10,000.

### Why Decimal-safe arithmetic matters

JavaScript's native numbers can produce results like `0.1 + 0.2 = 0.30000000000000004` due to
binary floating-point representation — completely unacceptable for money, where being off by
even a fraction of a paisa across thousands of transactions is a real financial error, and
would be indefensible if a client ever asked "why doesn't this number add up exactly?" This
codebase already uses Prisma's `Decimal` type for money throughout (confirmed elsewhere in
the ERP, e.g. the accounting ledger service), and the incentive calculation follows the exact
same convention — every value/quantity/reward figure is a `Prisma.Decimal`, never a plain
JavaScript number, until the very last step.

### Why intermediate rounding is avoided, and where rounding happens

Every intermediate sum (aggregating across invoices, applying a rate) is kept at full Decimal
precision. Rounding to 2 decimal places (using half-up rounding) only happens once, at the
very end, when producing a number meant for display or storage as a final amount — never in
the middle of a calculation. Rounding early and re-using the rounded number in a later step is
a classic source of "the total doesn't match the sum of the parts" bugs; this design avoids
that entirely.

### Alternate rewards

Both the primary and (if configured) alternate reward amounts are always computed and stored
side by side. The system never picks one — that decision (e.g. "does the distributor want
cash or gold this quarter") is explicitly left to a human, because nothing in the source
documents specifies who decides, or when.

---

## 9. Slab Selection

### The confirmed rule for Panasonic (HIGHEST_SLAB_WINS)

> Select the single highest slab whose threshold is ≤ the cumulative eligible achievement,
> then apply *that slab's* reward rate to the reward-eligible amount.

The slab is chosen on the **slab amount** (all eligible lines, including reward-excluded
products). The reward rate is then applied to the **reward amount** (only non-excluded lines).
When no products are excluded these two amounts are equal.

### Worked example (no reward exclusions)

| Threshold | Reward |
|---|---:|
| ₹0 | 0.10% |
| ₹500,000 | 0.15% |
| ₹1,000,000 | 0.25% |

If eligible achievement is ₹750,000:
- **Selected slab**: ₹500,000 tier (it's the highest threshold that's still ≤ 750,000 —
  ₹1,000,000 hasn't been reached yet).
- **Reward**: 0.15%.
- **Incentive**: 750,000 × 0.15 / 100 = **₹1,125**, on the *entire* ₹750,000 — not split
  between the ₹500,000 at 0.15% and the remaining ₹250,000 at some other rate.

### The alternative interpretation (NOT implemented)

A **progressive/tiered** calculation would instead apply each rate only to its own bracket —
e.g. the first ₹500,000 at 0.10%, the next portion (₹500,000 to ₹750,000) at 0.15% — the way
income tax brackets typically work. That is a completely different, and equally plausible,
reading of "buy this much, get this rate" circulars.

### Why this matters

**This is a business decision, not a coding detail.** Both interpretations are defensible
readings of the same circular language, and they produce materially different incentive
amounts. The engine supports both modes (`HIGHEST_SLAB_WINS` and `PROGRESSIVE`) and
allows the user to configure it per scheme. `HIGHEST_SLAB_WINS` is the confirmed mode
for all current Panasonic circulars.

---

## 10. Recalculation and Contribution Lifecycle

```text
ACTIVE  →  SUPERSEDED   (a later recalculation replaced this number)
ACTIVE  →  REVERSED     (the underlying invoice was cancelled)
```

### Initial calculation

For each invoice with at least one eligible line, one `IncentiveContribution{status: ACTIVE}`
row is created, plus one `IncentiveContributionItem` row per eligible line. Invoices with zero
eligible lines get no contribution row at all.

### Recalculation — before and after, concretely

**Before** (after the first calculation, invoices A and C eligible):
```
Contribution #1: invoice=A, status=ACTIVE, incentiveAmount=750
Contribution #2: invoice=C, status=ACTIVE, incentiveAmount=450
```

**After** recalculating with no data changes:
```
Contribution #1: invoice=A, status=SUPERSEDED, incentiveAmount=750   (kept, untouched values)
Contribution #2: invoice=C, status=SUPERSEDED, incentiveAmount=450   (kept, untouched values)
Contribution #3: invoice=A, status=ACTIVE,     incentiveAmount=750,  supersedes=#1
Contribution #4: invoice=C, status=ACTIVE,     incentiveAmount=450,  supersedes=#2
```
Nothing was deleted. `#1`/`#2` remain as permanent history; `#3`/`#4` are the current truth.
Any report or dashboard must filter to `lifecycleStatus = 'ACTIVE'` to get "current" numbers —
querying the whole table would double-count history.

### Cancellation

When a `PurchaseInvoice` is cancelled, calling `reverseContributionForInvoice(schemeId,
invoiceId)` finds that invoice's current `ACTIVE` contribution and flips it to `REVERSED`
(with `reversedAt` set) — again, never deleted. A later recalculation correctly leaves
`REVERSED` rows alone (it only supersedes rows that are still `ACTIVE`).

**Important limitation, stated plainly**: this reversal is **not automatically wired** into
the ERP's actual invoice-cancellation code (`cancelVoucher`/`submitPurchaseInvoice`). Today,
it is only reachable by calling `reverseContributionForInvoice()` directly — from a script, or
(in a future phase) from a real cancellation hook once that integration is built. Cancelling
an invoice through the normal ERP flow today does **not** currently touch any incentive
contribution.

---

## 11. Transactions, Advisory Locks, and Failure Handling

### Why the RUNNING run is committed separately

If the run row were created *inside* the same transaction as the calculation itself, a failed
calculation would roll back the run row too — leaving no record that anything was even
attempted. By committing `RUNNING` first, on its own, the audit trail survives no matter what
happens next.

### Why supersession + insertion + COMPLETED happen atomically

All of steps 14–17 (§6) happen inside one transaction so that either *all* of them succeed
together, or *none* of them do. There is no possible intermediate state where old
contributions are superseded but new ones weren't created, or where new contributions exist
but the run still shows `RUNNING`.

### Why a separate transaction is needed to mark FAILED

Because the calculation transaction rolled back entirely on error, the run row inside that
transaction never got its `FAILED` update — it's as if that part of the code never ran. A
brand-new, separate transaction is required afterward, using the run row that *did* survive
(from the very first, independently-committed insert).

### What a PostgreSQL advisory lock is, and why it's scoped to a scheme

An advisory lock is a lock the application asks Postgres to hold, tied to an arbitrary key —
not tied to any specific table row. Here, the key is derived from the scheme's ID
(`incentive-scheme:<schemeId>`), so calculating scheme X never blocks calculating scheme Y.

**If two calculations for the *same* scheme run at the same time**: the second one simply
waits until the first one's transaction finishes (commits or rolls back), then proceeds
against the now-current data. Neither can see or interleave with the other's half-written
state. This was verified for real, by firing two concurrent `runIncentiveCalculation()` calls
against the same scheme in the POC and confirming exactly one consistent, non-duplicated set
of `ACTIVE` contributions resulted.

### Why the lock is not a replacement for the partial unique index

The advisory lock only prevents problems *if the application code that acquires it behaves
correctly*. It's a cooperative mechanism — if some other, buggy piece of code somehow wrote to
this table without going through the locked code path, the lock wouldn't stop it. The partial
unique index (§5) is the actual database-enforced guarantee, independent of application
correctness — it's the backstop that catches a mistake even if the lock discipline is somehow
bypassed or has a bug.

### Failure scenarios — what's actually implemented vs. a known gap

| Scenario | What actually happens |
|---|---|
| Calculation fails halfway through | Full rollback of contributions/items/COMPLETED flip; run marked `FAILED` in a separate transaction with a redacted error message. **Verified for real** in the POC. |
| Two recalculations start together (same scheme) | Serialized by the advisory lock; both complete successfully, no duplicates. **Verified for real.** |
| Duplicate ACTIVE contribution attempted | Rejected by the partial unique index; the transaction fails, is caught, and the run is marked `FAILED`. |
| A previous run remains stuck at RUNNING (e.g. process crashed) | **Not detected or cleaned up.** New calculations proceed regardless — there is no check for "is another run still RUNNING." This is a known, explicitly documented gap, not something silently ignored. |
| A retry occurs after a failure | Simply calling `runIncentiveCalculation()` again — it creates a fresh run row and recalculates from scratch (full scheme period, every time — see Phase 2 scope decision). No special "retry" logic exists or is needed, because every run is a full recalculation anyway. |

---

## 12. What the Test Coverage Actually Proves

### Unit tests (124 tests, across incentiveCalculation.test.ts and related files)

These test the **pure logic only** — no database involved. They prove things like: given
these exact inputs, `evaluateInvoiceEligibility()` returns exactly this exclusion reason;
given this achievement, `selectSlab()` picks exactly this slab; given this slab, `computeReward()`
returns exactly this number; given reward-excluded products, only the non-excluded amount is
rewarded. These are deterministic, fast, and run every time via `npm test`.

### The POC runner (real-database integration evidence, 31 runtime assertions)

Because this repository's existing test convention mocks Prisma entirely (no real
transactions, no real advisory locks are ever exercised in the existing test suite), a
separate script (`src/scripts/poc/incentiveTrackingPoc.ts`) was built to run the *actual*
service against a real (isolated, sandboxed) database — creating real invoices, running real
transactions, firing real concurrent calls, and checking real resulting rows. This is the only
way to genuinely verify the transaction/locking/constraint behavior described in §11 — mocking
those would prove nothing about whether they actually work.

### What "124/124", "89/89" and "31/31" actually prove — and what they don't

- **124/124 (unit + repository regression tests)** proves: the pure calculation math is correct
  for every scenario tested, including supplier eligibility, reward-excluded products, amount
  basis, and per-line billing type — and nothing in this new module broke any pre-existing
  test in the repository.
- **89/89 (API check)** proves: the full HTTP stack works end-to-end — permission checks,
  validation, both slab modes, eligible suppliers, reward exclusions, amount basis, billing
  type per line, pagination, summary, company isolation.
- **31/31 (POC runtime assertions)** proves: against a real database, with real transactions
  and real concurrency, the implemented behavior matches the documented design — eligibility
  filtering, line-level calculation, slab selection, recalculation, cancellation/reversal,
  duplicate prevention, and failure handling all behaved exactly as specified, for the specific
  scenarios exercised.

**What this does NOT prove:**
- It does **not** prove the *business rules themselves* (highest-slab-wins, negative-line
  exclusion, null-tradeType exclusion) are the *correct* rules — only that the code correctly
  implements the rule as currently specified.
- It does **not** mean the feature is **production-ready** — there are no routes, no UI, no
  automatic invoice-lifecycle hooks, no settlement tracking, and several explicitly
  unconfirmed business decisions (§9, §13).
- It does **not** test every possible real-world data shape (e.g. extremely large invoice
  volumes, malformed legacy data, concurrent cancellations during a recalculation) — it tests
  the specific scenarios described in the POC script.

---

## 13. Implemented vs. Deferred — Full Table

| Feature | Current status | Explanation |
|---|---|---|
| Scheme model | **Implemented** | `IncentiveScheme` + creation helper and API exist and work. |
| Slab model | **Implemented** | `IncentiveSlab`, including alternate rewards. |
| Manufacturer filtering | **Implemented** | Normalized exact-string match; no fuzzy matching, no master table. |
| Trade-type filtering | **Implemented** | `PurchaseInvoice.tradeType` and per-line `PurchaseInvoiceItem.tradeType` gate eligibility; NULL excluded by default. |
| Supplier filtering | **Implemented** | `eligibleSupplierIds` / `allowAnySupplier` per scheme. |
| Reward-excluded products | **Implemented** | `rewardExcludedProductIds`; lines count toward slab but not reward. HIGHEST_SLAB_WINS only. |
| Amount basis | **Implemented** | `amountBasis` per scheme; default is `PRE_TAX_BEFORE_DISCOUNT` (`quantity × unitPrice`). |
| Contribution tracking | **Implemented** | Full lifecycle (`ACTIVE`/`SUPERSEDED`/`REVERSED`) with line-level traceability. |
| Recalculation | **Implemented** | Full-scheme-period recalculation, verified against a real database. |
| Reversal function | **Implemented, but not wired in** | `reverseContributionForInvoice()` exists and works; nothing calls it automatically on real invoice cancellation. |
| API routes | **Implemented** | Full CRUD for schemes, slabs, calculations, contributions, runs — see `incentive-tracking-api.md`. |
| Frontend dashboard | **Deferred** | Not started in the backend repository; frontend project is separate. |
| eMitra automatic validation | **Deferred** | `bookingChannel` is informational text only; no data source to validate against exists. |
| Settlement | **Deferred** | No model, no logic, no connection to actual manufacturer credit notes/payments. |
| Credit-note processing | **Deferred** | Not modeled; the ERP's existing `CreditNote` model is for outgoing customer credit notes, not incoming manufacturer rebates — using it would require separate investigation, not attempted here. |
| Purchase returns | **Deferred** | `PurchaseReturn` links to `PurchaseReceipt`, not `PurchaseInvoice` — no path exists to connect a return to a contribution reversal. |
| Notifications | **Deferred** | Not started. |
| Manufacturer master (dedicated table) | **Deferred** | Matching uses the existing free-text `Product.manufacturer` string; a real `Manufacturer` model was deliberately not introduced (no clear benefit yet, real migration cost if introduced later). |
| Cash/gold selection workflow | **Deferred** | Both amounts are computed and stored; no workflow exists for a human to record which one was actually chosen/paid. |
| Final slab-rule confirmation | **Confirmed** | Highest-slab-wins is the confirmed Panasonic rule. PROGRESSIVE available for other schemes. |

---

## 14. How to Present This to Your Employer

### 30-second version

"We've built the database design and the core calculation engine for tracking manufacturer
incentive schemes — things like Panasonic's rebate programs. It correctly figures out which
purchases qualify, sums up the achievement, applies the right reward tier, and keeps a full
audit trail of every calculation. It's tested against a real database. What's left is wiring
it into the actual application — routes, a UI, and getting a couple of business rules
confirmed by the client before we treat any number it produces as final."

### 2-minute version

"The client gets these manufacturer incentive circulars — buy this much, get this percentage
back, with different tiers based on how much you buy. We needed the ERP to actually track
that instead of doing it by hand. Phase 1 was the database design: we modeled the scheme
itself, the reward tiers, and — critically — a record of exactly which invoice lines
contributed to each calculation, so we can always explain where a number came from later.
Phase 2 built the actual calculation logic: it goes through purchase invoices, figures out
which ones and which product lines actually qualify — for example, if an invoice has both
Panasonic and Samsung products, only the Panasonic portion counts — sums that up, picks the
right reward tier, and calculates the incentive. We tested this against a real database,
including things like recalculating after new invoices come in, reversing a contribution when
an invoice gets cancelled, and making sure two calculations running at the same time can't
corrupt the numbers. Everything passed. What's not done yet: there's no screen for anyone to
actually use this — no routes, no UI — and a couple of the business rules, especially how
the reward tiers apply, still need the client to confirm which interpretation they actually
mean."

### 5-minute technical version

"We modeled five tables: the scheme itself, its reward slabs, a log of every calculation
attempt, the actual contribution records, and a line-item breakdown of each contribution. The
key design decision was making contributions immutable and versioned — when you recalculate,
we never overwrite or delete the old numbers, we mark them 'superseded' and insert new ones
linked back to what they replaced. Same idea for cancellations — we mark a contribution
'reversed', we never delete it. That gives us full audit history for free.

The trickiest correctness problem was preventing double-counting when the same invoice gets
recalculated multiple times, or when two recalculations somehow run at the same time. We
solved that two ways: a Postgres advisory lock, scoped per scheme, that serializes concurrent
calculations for the same scheme at the database level; and, as a backstop independent of
whether our application code behaves correctly, a partial unique index — that's a Postgres
feature that lets you say 'only one row can have this combination of values, but only among
rows matching this condition' — here, only among rows where the contribution is still active.
Prisma's schema language can't express that kind of conditional constraint, so that one index
had to be hand-written directly into the migration SQL, which is a maintenance risk worth
flagging to whoever touches migrations next.

On the calculation side: eligibility is checked at two levels — the whole invoice first
(submitted status, correct dates, correct trade-type classification), then each individual
line (does the product's manufacturer match, normalized so 'Panasonic' and ' panasonic ' are
treated the same, but never fuzzy-matched so 'Panasonic India' doesn't accidentally count).
Only the matching lines' values get summed — we verified with a real mixed-manufacturer
invoice that only the correct portion counts, not the whole invoice.

For failure handling: we create the calculation-run audit record and commit it before doing
any real work, specifically so that if the calculation itself fails partway through and its
transaction rolls back, we still have a surviving record to mark as failed — with a sanitized
error message, so we never accidentally leak something like a database connection string into
an error log.

For testing: we have pure unit tests for the math and rules — no database needed, fast, always
run. And because this repo's existing test setup mocks the database entirely, which can't
actually prove a real transaction or lock works, we built a separate script that runs the real
service against a real, sandboxed database — including firing two calculations at once to
prove the lock actually serializes them. Fifty-one unit tests and twenty-nine real-database
assertions all pass. That proves the code does what we designed it to do — it does not prove
the business rules we picked, like which reward tier applies, are the ones the client actually
wants, and I want to be upfront that a couple of those are still open questions."

---

## 15. How to Present This to the Client (Non-Technical)

"We've built the part of the system that figures out, from your actual purchase records,
which purchases qualify for a manufacturer's incentive scheme, adds them up correctly, and
works out how much incentive you've earned.

Specifically, it knows to only count purchases from the right manufacturer, within the right
dates, billed the right way — and if one purchase invoice has products from two different
manufacturers on it, it correctly only counts the portion from the manufacturer the scheme is
actually about, not the whole invoice.

It keeps a complete history — every time we recalculate (say, because new purchases came in),
the old numbers aren't thrown away, they're kept on record, so we can always show exactly how
a number was arrived at and how it changed over time. If a purchase gets cancelled, the system
correctly removes its contribution without losing that history either.

We've also made sure the system can't accidentally double-count the same purchase, even if two
recalculations happened to run at exactly the same moment — we tested that directly.

What this demonstration does **not** yet do: there's no screen in the software for your team
to actually look at or interact with this yet — that's the next phase. And there are a couple
of business decisions we need your confirmation on before we treat the numbers as final —
most importantly, exactly how the reward tiers should apply once you've crossed a threshold
(the whole amount at the new rate, or split between the old rate and the new one for the
portion above the threshold). We also haven't yet built the part that would automatically
connect an incentive we calculated to the actual credit note or payment you receive from the
manufacturer — that reconciliation step comes later.

Next phase would be building the actual screens for your team to use, wiring the calculation
to run automatically when invoices are submitted or cancelled, and getting your sign-off on
the open business rules above."

---

## 16. Glossary

| Term | Plain-language meaning |
|---|---|
| **Incentive scheme** | A manufacturer's rebate program — buy enough, get money back. |
| **Manufacturer** | The brand offering the incentive (e.g. Panasonic). No dedicated table exists yet — it's matched via a text field. |
| **Manufacturer key** | The manufacturer's name, cleaned up (trimmed, lowercased) so matching isn't broken by capitalization or spacing. |
| **Eligible trade type** | Which invoice billing classifications (Distributor Sale, Super Trade, etc.) count for this scheme. |
| **Scheme period** | The start and end date the scheme is valid for. |
| **Threshold** | The achievement level a reward tier kicks in at. |
| **Slab** | One reward tier of a scheme (a threshold plus its reward rate). |
| **Achievement** | How much has actually been purchased/invoiced so far, that counts. |
| **Eligible value** | The rupee amount of purchase lines that actually qualify. |
| **Eligible quantity** | The unit count of purchase lines that actually qualify. |
| **Contribution** | The record of how much one specific invoice added to a scheme's total. |
| **Contribution item** | The line-level detail behind a contribution — exactly which product and quantity. |
| **Calculation run** | A log entry recording one attempt to calculate a scheme, and whether it worked. |
| **Active contribution** | The current, counted version of a contribution. |
| **Superseded contribution** | An old contribution, kept for history, replaced by a newer calculation. |
| **Reversed contribution** | A contribution that no longer counts because its invoice was cancelled. |
| **Recalculation** | Re-running the whole calculation from scratch, replacing old numbers with new ones (without deleting history). |
| **Idempotency** | The property that doing the same operation multiple times produces the same safe result — here, achieved by resetting/tagging test data so the POC script can be re-run safely. |
| **Partial unique index** | A database rule that enforces "no duplicates" but only among rows matching a specific condition — here, only among "still active" rows. |
| **Advisory lock** | A cooperative lock the application asks the database to hold, used to stop two operations from interfering with each other. |
| **Atomic transaction** | A group of database changes that either all happen together, or none happen at all. |
| **Rollback** | Undoing every change made inside a transaction because something went wrong partway through. |
| **Auditability** | The ability to later explain exactly how a number was calculated and where it came from. |
| **Settlement** | Actually receiving and reconciling the real-world payment/credit note for an earned incentive — not implemented here. |
| **Credit note** | A financial document reducing what's owed — the client's circulars mention Panasonic settles incentives this way, but this ERP has no model for an *incoming* one yet. |
| **eMitra booking channel** | Panasonic's own ordering portal; mentioned in one circular as eligible for a small extra incentive — currently just a text label in our system, with no automated way to verify it. |

---

## 17. Final Learning Section — Direct Answers

**1. What exactly have we built so far?**
A database design (5 new models, 1 new field, 7 new enums) and a calculation service (2 files)
that can compute, for a given manufacturer incentive scheme, exactly which purchase invoices
and product lines qualify, how much has been achieved, which reward tier applies, and how much
incentive that's worth — with full audit history and duplicate/concurrency protection. No
routes, controllers, or UI exist yet.

**2. What happens when a purchase invoice is submitted?**
Nothing incentive-related happens automatically. The invoice gets submitted through the
existing, unrelated ERP invoice-submission flow exactly as it always did.

**3. Does the incentive calculate automatically when an invoice is submitted?**
**No.**

**4. If not, how is the calculation currently triggered?**
By directly calling the `runIncentiveCalculation(schemeId, options)` function — today, only
from the POC script. No production code path calls it yet.

**5. Does the system calculate incentive for the whole invoice or only eligible lines?**
Only eligible lines. A mixed-manufacturer invoice contributes only its matching lines' value —
verified with real numbers.

**6. How does it know which manufacturer a product belongs to?**
By reading `Product.manufacturer` (a plain text field) and comparing it, normalized, to the
scheme's configured manufacturer. There's no separate manufacturer table.

**7. What happens if an invoice contains multiple manufacturers?**
Each line is checked independently; only lines matching the scheme's manufacturer count. The
rest of the invoice is simply ignored for that scheme's calculation.

**8. What happens if the invoice has an ineligible trade type?**
The entire invoice is excluded — no lines from it count at all, regardless of manufacturer.

**9. What happens during recalculation?**
Every currently-active contribution for that scheme is marked superseded (kept, not deleted),
and the whole scheme period is evaluated again from scratch, producing a fresh set of active
contributions linked back to what they replaced.

**10. What happens when an invoice is cancelled?**
If someone calls `reverseContributionForInvoice()`, its active contribution is marked reversed
(kept, not deleted). This is **not automatic** — nothing in the real invoice-cancellation code
calls this yet.

**11. How are duplicate contributions prevented?**
Two ways: the calculation logic itself supersedes old rows before inserting new ones, under a
scheme-scoped database lock; and, independently, a database-level partial unique index refuses
to allow two "active" contributions for the same scheme+invoice pair no matter what caused the
attempt.

**12. What happens if the calculation fails?**
The calculation transaction rolls back completely (no partial data is left behind), and a
separate, already-committed run record is updated to show it failed, with a safe (secret-
redacted) error message.

**13. What is still missing for production?**
Routes/controllers/UI, an automatic hook from real invoice submission/cancellation into this
calculation, settlement/credit-note tracking, returns handling, a manufacturer master table,
and confirmation of the open business rules in item 14.

**14. Which decisions must the client confirm?**
Primarily: how negative invoice lines should be treated (excluded vs. subtracted); whether any
scheme should use `PRE_TAX_AFTER_DISCOUNT` rather than the default `PRE_TAX_BEFORE_DISCOUNT`;
which specific `Supplier.id` records are the eligible suppliers for each Panasonic scheme;
which products (if any) are slab-only per scheme; who decides between a primary and an
alternate reward (e.g. cash vs. gold), and when; and how Panasonic's incoming settlement
credit notes should actually be reconciled against calculated incentives.
Highest-slab-wins is confirmed for all current Panasonic schemes.

**15. What should Phase 3 implement?**
Based on everything above, Phase 3 is the natural next step to make this usable: API routes
and controllers to create/view schemes and trigger calculations, at minimum a way for a real
invoice cancellation to call the existing reversal function, and getting the open business-rule
questions in item 14 answered before any number from this system is treated as final.
