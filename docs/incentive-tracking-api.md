# Incentive Tracking: API and General Options

This covers what was added after the POC: per-scheme options that make the engine general, and the
API to manage schemes and run calculations. It describes what exists in the code today.

Nothing here changes the open business decisions in `incentive-tracking-business-decisions.md`.
The engine can now be configured either way on the points below; it does not decide them.

## 1. Per-scheme options

| Field | Values | Default | Effect |
|---|---|---|---|
| `allowAnyTradeType` | true / false | false | When true, the invoice trade type is ignored entirely (NULL included) and `eligibleTradeTypes` is not consulted. Every other rule still applies (submitted, in period, supplier, manufacturer, non-negative lines). |
| `slabMode` | `HIGHEST_SLAB_WINS` / `PROGRESSIVE` | `HIGHEST_SLAB_WINS` | How the slab ladder turns achievement into an incentive. Panasonic uses `HIGHEST_SLAB_WINS` (confirmed). |
| `eligibleTradeTypes` | list of the five trade types | none | Required (at least one) unless `allowAnyTradeType` is true. |
| `eligibleSupplierIds` | array of Supplier IDs | (empty) | When non-empty, only invoices from one of these suppliers count. When empty, `allowAnySupplier` decides. |
| `allowAnySupplier` | true / false | false | When true, any supplier's invoices count (no supplier filter). Mutually exclusive with a non-empty `eligibleSupplierIds`. |
| `rewardExcludedProductIds` | array of Product IDs | (empty) | Products whose lines count toward the **slab threshold** but earn **no reward**. Only valid on `HIGHEST_SLAB_WINS` schemes. |
| `amountBasis` | `PRE_TAX_BEFORE_DISCOUNT` / `PRE_TAX_AFTER_DISCOUNT` | `PRE_TAX_BEFORE_DISCOUNT` | Which per-line amount the engine uses. `PRE_TAX_BEFORE_DISCOUNT` = `quantity × unitPrice`; `PRE_TAX_AFTER_DISCOUNT` = `quantity × unitPrice × (1 − discount/100)`. Neither includes GST. |

Existing schemes keep their previous behaviour because all columns have defaults.

### Slab modes, with the same slabs (0 -> 0.10%, 500,000 -> 0.15%, 1,000,000 -> 0.25%)

| Achievement | HIGHEST_SLAB_WINS (Panasonic default) | PROGRESSIVE |
|---|---|---|
| 400,000 | 400,000 x 0.10% = 400 | 400 |
| 750,000 | 750,000 x 0.15% = 1,125 | 500,000 x 0.10% + 250,000 x 0.15% = 875 |
| 1,200,000 | 1,200,000 x 0.25% = 3,000 | 500 + 750 + 200,000 x 0.25% = 1,750 |

Panasonic uses `HIGHEST_SLAB_WINS` (confirmed from the circulars and verified in the demo seed).
`HIGHEST_SLAB_WINS` is therefore the default. `PROGRESSIVE` is available for schemes where the circular
specifies a tiered/bracket structure.

**PROGRESSIVE rules**
- The rate of each slab applies only to the band between its threshold and the next slab's threshold.
- Anything below the first slab's threshold earns nothing.
- It is only accepted when the reward matches the measurement: `VALUE` schemes need `PERCENTAGE`
  rewards, `QUANTITY` schemes need `FIXED_PER_UNIT`. A mix would need the quantity that fell inside a
  value band, which cannot be worked out, so it is rejected instead of guessed.
- Alternate rewards must be set on every slab or on none.
- HIGHEST_SLAB_WINS has no such restrictions.

**Per-invoice amounts.** Each contribution stores its own incentive amount, and the amounts always add up
to the scheme total.
- HIGHEST_SLAB_WINS: every invoice is rewarded at the scheme's slab (the reward is linear, so no
  adjustment is needed).
- PROGRESSIVE: invoices are taken in order (invoice date, then invoice number). Each gets the increase in
  the scheme incentive it caused. Example with invoices of 500,000, 300,000, 100,000 and 60,000: 500, 450,
  150, 90, total 1,190. A different order would split the total differently but never change the total.

## 2. Endpoints

Mounted at `/api/incentives` and `/api/v1/incentives`. All require login. Responses use the ERP's
standard `{ success, message, data }` shape; lists are paginated (`page`, `limit`, max 100).

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /schemes` | schemes: read | List. Filters: `status`, `manufacturer` (normalised), `search` (name or code). |
| `POST /schemes` | schemes: create | Create, optionally with `slabs`. Starts as DRAFT unless `status` is given. |
| `GET /schemes/:id` | schemes: read | One scheme with its slabs. |
| `PUT /schemes/:id` | schemes: write | Edit scheme settings. Does not recalculate; the response says when a recalculation is recommended. |
| `PATCH /schemes/:id/status` | schemes: write | DRAFT to ACTIVE or CANCELLED, ACTIVE to CLOSED or CANCELLED, CLOSED to ACTIVE. |
| `POST /schemes/:id/slabs` | schemes: write | Add a slab. Slabs are kept in ascending threshold order automatically. |
| `PUT /schemes/:id/slabs/:slabId` | schemes: write | Edit a slab. |
| `DELETE /schemes/:id/slabs/:slabId` | schemes: delete | Delete a slab that no past calculation refers to. |
| `GET /schemes/:id/summary` | schemes: read | Current totals, incentive so far, slab reached, next slab, gap to it, and when it was last calculated. |
| `GET /schemes/:id/contributions` | contributions: read | ACTIVE by default; `status=SUPERSEDED / REVERSED / ALL`; `purchaseInvoiceId`. Includes the invoice and its counted lines. |
| `GET /schemes/:id/runs` | calculations: read | Calculation history with status and errors. |
| `POST /schemes/:id/calculate` | calculations: manage | Manual recalculation of the complete scheme period. `?detail=true` adds per-invoice, per-line reasons. |

A scheme can only be activated when it has at least one slab and the slab set is valid for its mode.
Errors: `400` with code `VALIDATION_FAILED` (details in `errors`) or `CALCULATION_NOT_ALLOWED`, `403` for a
missing permission, `404` for an unknown scheme or one that belongs to another company.

## 3. Permissions

A new `incentives` module was added to the permission catalogue with resources `schemes`,
`calculations` and `contributions` and actions read, create, write, delete and manage. The default Admin
role includes it, and super admins bypass checks as everywhere else. Managing a resource grants all its
actions.

Permission rows and default roles are created by the existing access-control code the next time it runs
for a company (the access endpoints call it). A company that has not hit those endpoints since this
change may need that to happen before its Admin role shows the new permissions.

Who should hold `calculations: manage`, and whether results need an approval step, is still an open
client decision. Nothing approves or finalises an amount today.

## 4. Company isolation

Schemes carry the company id and are scoped automatically. Slabs, runs and contributions are only ever
reached through a scheme that was first loaded in the caller's company, so another company gets `404`.
Verified against the real database (see below).

## 5. Verifying it

```bash
npm test                                  # 124 unit tests, no database
npm run incentive:poc                     # original service-level scenario, 31 assertions
npm run incentive:api-check               # API against the real database, 89 checks
npm run incentive:api-check -- --cleanup-only
```

The API check runs the real router, permission checks, controller, services and tenant scoping. Only login is
stubbed, so it needs no token. Everything it creates sits in dedicated sandbox companies and is tagged
`POC-INCENTIVE-API-2026`; cleanup removes only tagged rows. It covers permissions, validation, both slab
modes, any-trade-type, eligible suppliers, reward-excluded products, amount basis, billing type per line,
slab management, pagination, summary, runs, status rules and company isolation.

## 6. Still not built

- Trade type assignment on real invoices (nothing sets `tradeType` yet).
- Automatic calculation on invoice submission or cancellation, and automatic contribution reversal on
  cancellation. Calculation is manual only; figures can go stale until someone recalculates.
- Returns, credit notes, settlement, payout tracking, and approval or sign-off of results.
- Alternate reward selection workflow (both amounts are calculated and stored; nothing records a choice).
- eMitra or booking-channel validation.
- Product or region restrictions inside a scheme, bonus-on-achievement schemes, stacking of schemes.
- A frontend.

## 7. Known limits

- Recalculation reads every purchase invoice for the company, then filters in code. Fine at current
  volumes; it should be tightened before large volumes.
- Stored per-invoice amounts have six decimal places, so under PROGRESSIVE their sum can differ from the
  scheme total by less than a millionth if a rate has more precision than that.
- A crashed calculation leaves its run as RUNNING; nothing detects or cleans that up.
- Editing a scheme's rules does not change stored results until a recalculation is run.
- `rewardExcludedProductIds` is not supported on PROGRESSIVE schemes (progressive calculates per-band
  amounts and cannot split slab vs. reward amounts within a band).

## 8. Demo data for the frontend

```bash
npm run seed:incentives                                  # lists companies (no company given)
npm run seed:incentives -- --company <slug-or-id>        # seed (or reseed) demo data
npm run seed:incentives -- --company <slug-or-id> --cleanup-only
npm run seed:incentives -- --company <slug-or-id> --detach-others
```

Seeds into an existing company (also settable with `SEED_INCENTIVES_COMPANY`); it never creates one. Everything it
creates carries the marker `SEED-INCENTIVE-DEMO` (scheme code, invoice number, product SKU, supplier number),
and each run deletes only tagged rows before recreating them.

It creates one supplier, seven products (including one with an oddly cased manufacturer that still matches, and
one "Panasonic India" that does not), 17 purchase invoices covering all five trade types, a NULL trade type, an
out-of-period invoice, an other-manufacturer invoice, a draft and a cancelled one, and eight schemes:
active highest-slab, active progressive, active quantity with any trade type, active with alternate rewards,
a draft with no slabs, a closed one whose achievement stayed below the first slab, a cancelled one, and an
active one that is deliberately not calculated. One scheme carries ACTIVE, SUPERSEDED and REVERSED history.
It prints expected totals per scheme, computed independently of the engine, and checks the engine agrees.

The demo invoices are inserted directly as SUBMITTED, so they have no ledger or stock entries. It adds only the
incentive permissions to the company's existing Admin role (or creates the default roles if there is no Admin
role); `--cleanup-only` leaves that configuration in place. If a scheme you created has already counted demo
invoices, the script stops and names it; `--detach-others` deletes just those contribution rows.
