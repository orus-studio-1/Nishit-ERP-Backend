# Incentive Tracking — Business Decision Checklist

This is a checklist of decisions that **must be confirmed by the client** before any incentive
amount produced by this system is used for a real business purpose (a settlement claim, a
credit-note reconciliation, or any figure reported as final). It is meant to be worked through
item by item with the client, not read as a technical document.

For each item, this checklist states: what the POC currently does, why that choice was made,
and exactly what confirming (or overriding) it would change.

---

## How to read the status labels

- **Implemented** — real, working code exists and was verified against a real database.
- **POC-only** — the behavior exists and works, but only inside the isolated test/demo script; it is not wired into any real invoice workflow.
- **Provisional assumption** — a default was chosen and coded because *something* had to be decided to make the calculation runnable, but the client has not confirmed it is the right rule.
- **Deferred** — nothing has been built for this at all.
- **Pending client decision** — this checklist item, specifically.

---

## 1. Highest-slab-wins vs. progressive/tiered slab calculation

**Status: Confirmed for Panasonic. Both modes are implemented.**

Panasonic schemes use the single highest reward tier reached applied to the *entire* eligible
achievement. This has been confirmed by reading the circulars against worked examples and is implemented
as `HIGHEST_SLAB_WINS`, the default.

> Example: slabs at ₹0→0.10%, ₹500,000→0.15%, ₹1,000,000→0.25%. At ₹750,000 achieved, the
> reward is 0.15% on the *full* ₹750,000 = ₹1,125.

The alternative — progressive/tiered, like income tax brackets — is also implemented (`PROGRESSIVE`)
and can be selected per scheme for circulars that explicitly specify a bracketed structure.

**Decision needed (per scheme)**: for any new scheme whose circular is ambiguous, confirm which mode
applies. A worked example from Panasonic (a known achievement mapped to a known payout) is the
most reliable way to settle this. `HIGHEST_SLAB_WINS` is the confirmed default for all current
circulars.

---

## 2. What metric are thresholds based on — purchase value, invoicing value, quantity, or something else?

**Status: Implemented for two metrics; the *choice between them* per scheme is confirmed correct by the documents but not exhaustively validated against every circular.**

The system supports two measurement types per scheme: `VALUE` (currency-based thresholds) or
`QUANTITY` (unit-count-based thresholds). Both are real, working code paths. What's
implemented is the *purchase invoice's line total*, not sales/resale value — this matches the
circulars' own wording ("Pre Tax Sales Value" on purchases, i.e. what Eastern Traders buys
from Panasonic).

**Decision needed**: confirm that "purchase invoicing value from Panasonic to Eastern Traders"
is the correct basis for every scheme type in scope (not, for instance, resale value to
Eastern Traders' own customers) — and confirm which specific schemes are value-based vs.
quantity-based, since this must be configured correctly per scheme.

---

## 3. Whether tax and discounts are included in the eligible value

**Status: Confirmed. `quantity × unitPrice` is the eligible amount per line.**

Each purchase invoice line contributes `quantity × unitPrice` to the incentive calculation. This is
pre-tax (GST is not included) and before any trade discount. It matches the "Pre Tax Sales Value"
language used across the circulars.

`PurchaseInvoiceItem.total` stores a different figure — it is the line's net after the percentage
discount is applied, then multiplied by `(1 + taxRate/100)` — and is **not** used for incentive
calculations. This was discovered during the engine implementation and corrected. The engine always
reads `quantity` and `unitPrice` directly.

A per-scheme `amountBasis` option is available:
- `PRE_TAX_BEFORE_DISCOUNT` (default): `quantity × unitPrice` — confirmed correct for all current Panasonic circulars.
- `PRE_TAX_AFTER_DISCOUNT`: `quantity × unitPrice × (1 − discount/100)` — available if a circular specifies net-of-discount value.

**Decision needed (per scheme)**: confirm whether the default (before discount) is correct for every
scheme, or whether any specific circular intends the post-discount net value.

---

## 4. Treatment of negative lines, returns, cancellations, and credit notes

**These are four separate workflows that must not be conflated — each has a different trigger, a different status today, and may need a different business rule.**

- **Negative lines** *(a calculation rule, evaluated inside a normal calculation run)* —
  **Provisional assumption, implemented.** A purchase-invoice line with a negative total is
  currently **excluded entirely** from the calculation (not subtracted from the total). This
  was a conservative default, not a confirmed rule.
- **Cancellation reversal** *(an invoice-level lifecycle event: the invoice itself is voided)*
  — **Implemented, POC-only.** A function exists (`reverseContributionForInvoice`) that
  correctly reverses a contribution when an invoice is cancelled — but nothing in the real
  invoice-cancellation flow calls it automatically today; it only runs inside the isolated POC
  script.
- **Returns** *(goods physically go back to the manufacturer after the invoice was already
  finalized — a different event from cancelling the invoice)* — **Deferred, not modeled at
  all.** The ERP's existing `PurchaseReturn` model links to goods-receipt records, not to
  purchase invoices — there is currently no way to connect a return to an incentive
  adjustment, and no rule yet for whether/how a return should reduce an already-counted
  contribution.
- **Credit notes** *(the manufacturer's own financial instrument for adjusting or paying out
  an incentive — distinct from either of the above, and distinct from settlement/payout
  tracking generally)* — **Deferred.** Nothing connects an incentive calculation to an actual
  incoming credit note from the manufacturer. This overlaps with, but is not identical to,
  item 9 (Settlement) — a credit note is one *possible form* a settlement could take, not the
  settlement workflow itself.

**Decision needed**: should a negative line reduce the achievement total instead of being
excluded? Separately, what should happen to an already-counted incentive contribution when
goods are later returned to the manufacturer — is that a reversal, a partial reduction, or
something else? Each of the four items above needs its own explicit answer; assuming one
answer covers all four would be a mistake.

---

## 5. How `tradeType` is assigned

**Status: Deferred — no assignment workflow exists. This is an operational gap, not a data-model problem.**

To be precise about what's actually missing here: **the `PurchaseInvoice.tradeType` field
itself is not broken, invalid, or missing any capability it needs.** It correctly represents
the client's own handwritten classification (Distributor Sale / Super Trade / Special Trade /
Project Non-SPA / Project SPA), it is correctly checked by the eligibility logic, and it was
verified working end-to-end in the POC. **The actual gap is that nothing in the real ERP
currently sets this value on a real invoice** — there is no data-entry field in the invoice
form, no default, and no automatic derivation from any other existing data (customer type, PO
type, price agreement used, etc.). The field is a correct, working piece of the design that
simply has no upstream process feeding it real values yet.

**Decision needed**: who assigns this value (accounts team, purchasing team, someone else),
at what point in the invoice lifecycle, and based on what criteria (e.g. which price agreement
was used)? Until this operational workflow is defined and built, every real invoice will have
`tradeType = NULL` and be excluded from every scheme by default — not because the field is
wrong, but because nothing populates it yet.

**Update:** a scheme can now be set to `allowAnyTradeType`, which ignores this field entirely. That
lets schemes that do not depend on billing type produce real numbers today. Schemes whose circular
restricts by billing type (for example "Trade purchases only") still need this workflow.

---

## 6. Whether eMitra booking is mandatory

**Status: Deferred — no way to check this today.**

One circular offers an extra 0.10% incentive specifically for orders booked through
Panasonic's eMitra portal. The system has a field (`IncentiveScheme.bookingChannel`) to
*record* that a scheme is associated with eMitra, but nothing anywhere in the ERP records
*which channel a specific purchase invoice was actually booked through* — so there's currently
no way to check whether this condition is met at all.

**Decision needed**: is this eMitra-specific incentive something we need to support in the
near term? If yes, where will the booking-channel data come from (see item 7)?

---

## 7. Where booking-channel data will come from

**Status: Deferred — pending client decision.**

Directly related to item 6. Possibilities: (a) Panasonic/eMitra provides some kind of data
export or API we could import, (b) the accounts team manually flags eMitra-booked invoices
during entry, (c) this is simply out of scope until a real integration exists. No source has
been identified or built.

**Decision needed**: which of these (or another option) is realistic, and on what timeline?

---

## 8. Whether alternate rewards (e.g. cash/gold) require user selection or approval

**Status: Implemented (calculation only). Selection/approval workflow — deferred.**

For schemes offering a choice (e.g. the RCCB scheme's "₹55 per piece *or* 5 grams of gold"),
the system correctly calculates **both** amounts and stores them side by side. It **never**
automatically picks one — that decision is left entirely to a human, and there is currently no
workflow, field, or approval step recording which option was actually chosen or paid out.

**Decision needed**: who makes this choice (a manager, the client, someone at Panasonic), when
in the process, and does it need a formal approval/sign-off step recorded in the system?

---

## 9. Settlement and payout workflow

**Status: Deferred entirely.**

Nothing in this system connects a calculated incentive amount to the real-world event of
actually receiving money or a credit note from Panasonic. There is no settlement model, no
reconciliation logic, and no link to the ERP's existing `CreditNote` model (which is built for
credit notes *issued to* Eastern Traders' own customers, not ones *received from* a
manufacturer — using it as-is would likely be incorrect without further investigation).

**Decision needed**: how does the client currently track receiving a Panasonic incentive
payout (credit note, bank transfer, adjustment against a future invoice)? This needs to be
understood before any settlement feature is designed.

---

## 10. Whether incentive calculations should run automatically on invoice submission

**Status: Deferred. Currently, calculation only runs when manually triggered.**

Today, `runIncentiveCalculation()` must be called directly — there is no hook in the real
invoice-submission code (`submitPurchaseInvoice`) that triggers it. A purchase invoice can be
submitted through the normal ERP flow and no incentive number will change until someone
manually re-runs the calculation.

**Important distinction**: this is **not a formula or correctness problem.** Whenever the
calculation *is* run — manually or automatically — it produces the correct number for the
data that exists at that moment; nothing about the math changes based on how the run was
triggered. It **is**, however, **a production-readiness problem**: if users are shown an
incentive figure and reasonably expect it to reflect the *current* state of their invoices
(including ones submitted or cancelled five minutes ago), a purely manual trigger means the
displayed number can silently go stale. Whether that staleness is acceptable depends entirely
on how the feature will actually be used day to day.

**Decision needed**: should this become automatic (triggered every time a relevant invoice is
submitted or cancelled), or should it remain a manual/on-demand action (e.g. run monthly, or
run by a specific role before a report is generated)? This affects both the technical design
(a real hook into invoice lifecycle code) and the operational process (who is responsible for
making sure it actually gets run).

---

## 11. Who can manually recalculate or approve incentive results

**Status: Permissions and routes implemented; approval workflow deferred.**

The module now has API routes protected by the ERP's permission system (an `incentives` module with
`schemes`, `calculations` and `contributions` resources; see `incentive-tracking-api.md`). Recalculation
requires `incentives:calculations:manage`, and the default Admin role has it. **Not implemented:** any
approval or sign-off step, so a calculated amount is never marked final by anyone.

**Decision needed**: which roles should be allowed to trigger a recalculation? Should a
calculated result require a sign-off/approval step before it's treated as final (e.g. before
it's used for a settlement claim)? This decision shapes the Phase 3 route/permission design.

---

## 12. Eligible supplier requirement

**Status: Implemented. Per-scheme configuration.**

Each scheme now has an `eligibleSupplierIds` list (array of `Supplier.id`). Only invoices from a
supplier in this list count toward that scheme. If the list is empty and `allowAnySupplier` is
true, any supplier qualifies.

For Panasonic schemes, the eligible supplier should be set to the "Panasonic Life Solutions India"
record in the supplier master (or the equivalent trading entity on record). This prevents a
purchase of the same Panasonic product from a third-party trader from counting toward a Panasonic
scheme meant only for direct purchases.

**Decision needed**: confirm which specific supplier record(s) represent Panasonic in the live
database (there may be more than one trading entity). Existing schemes created before this field
existed have an empty list and will return a 400 until `eligibleSupplierIds` is set on them.

---

## 13. Reward-excluded products

**Status: Implemented. Per-scheme configuration (HIGHEST_SLAB_WINS only).**

A scheme can carry a list of `rewardExcludedProductIds`. Lines for these products count toward
the slab threshold (contributing to the achievement total that determines which tier is reached)
but earn zero reward. The slab is selected on the full slab amount; the reward rate is then applied
only to the portion from non-excluded products.

This covers schemes (like the Isolator scheme) where some products push you into a higher tier
but the circular states a specific product category is not itself eligible for the payout.

**Decision needed**: for each scheme, identify which products (if any) are slab-only and
exclude them by product ID. Exclusions are currently per product, not per category — if a whole
category should be excluded, each product in it must be listed individually.

---

## 14. Billing type per invoice line

**Status: Implemented. `PurchaseInvoiceItem.tradeType` overrides the invoice-level value.**

When an invoice has lines from different billing classifications (for example, the body of the
invoice is Distributor Sale but one line is a Project purchase added at the same time), each line
can carry its own `tradeType`. The engine uses the line's `tradeType` if set, falling back to the
invoice-level `tradeType` otherwise.

**Decision needed**: confirm whether this per-line override is operationally realistic — i.e.
whether the invoice-entry workflow will actually set different trade types on individual lines, or
whether the invoice-level value is always uniform across all lines.

---

## Recommended Client Discussion Order

Not every item above needs to be raised at once, and some only matter once earlier ones are
settled. Work through the conversation in this order:

1. **`tradeType` assignment (item 5)** — the immediate operational blocker. Without this,
   there is no real data to discuss any of the other items against. Establish who assigns it
   and when, before anything else.
2. **Eligibility and trade-type mapping** — once assignment is defined, confirm the mapping
   itself is right: which of the five trade types should count for which schemes (item 5's
   classification meaning, cross-checked against each scheme's own "Billing Type Considered"
   wording).
3. **Slab interpretation (item 1)** — confirmed as HIGHEST_SLAB_WINS for all current Panasonic
   circulars. Confirm per new scheme as each is added.
4. **Value/quantity basis (item 2)** — confirm purchase-invoicing value (not resale value) is
   the right basis, and which specific schemes are value-based vs. quantity-based.
5. **Tax/discount/returns treatment (items 3 and 4)** — amount basis is confirmed as
   `quantity × unitPrice` (pre-tax, before discount); walk through the negative-line,
   cancellation, return, and credit-note questions as four distinct workflows.
6. **Supplier eligibility (item 12)** — set `eligibleSupplierIds` on each scheme; existing
   demo schemes without it will 400 until this is done.
7. **Reward exclusions (item 13)** — identify any products that are slab-only (count toward
   the tier but earn no reward) and configure them per scheme.
8. **Settlement and approval requirements (items 8, 9, 11)** — once the calculation basis is
   settled, discuss how a calculated number actually becomes a real payout, who approves it,
   and how alternate-reward choices get recorded.

Items 6 and 7 (eMitra/booking channel) can be deferred to a later conversation unless the
client confirms an eMitra-specific scheme is an immediate priority. Item 10 (automatic
trigger) is an operational/UX conversation, not a financial-correctness one, and can happen
alongside or after Phase 3 route design.

---

## Summary table

| # | Decision | Status | Blocks production use? |
|---|---|---|---|
| 1 | Highest-slab-wins vs. progressive | Confirmed: HIGHEST_SLAB_WINS for all current Panasonic schemes | **No** |
| 2 | Threshold metric (value/quantity/other) | Implemented for 2 metrics; per-scheme config not fully validated | Yes, per scheme |
| 3 | Tax/discount inclusion | Confirmed: `quantity × unitPrice` (pre-tax, before discount) | **No** |
| 4 | Negative lines / returns / cancellations / credit notes | Mixed: provisional + deferred + POC-only | Yes |
| 5 | `tradeType` assignment process | Deferred | **Yes — blocks all real data** |
| 6 | eMitra booking mandatory? | Deferred | Only if eMitra-specific schemes are in scope |
| 7 | Booking-channel data source | Deferred | Same as #6 |
| 8 | Alternate-reward selection/approval | Calculation implemented; workflow deferred | Only for alternate-reward schemes |
| 9 | Settlement/payout workflow | Deferred | Yes, before claiming any real payout |
| 10 | Automatic calculation trigger | Deferred | Operational, not correctness-blocking |
| 11 | Recalculation/approval permissions | Permissions implemented; approval step deferred | Approval step, before results are treated as final |
| 12 | Eligible supplier per scheme | Implemented; must be configured per scheme | **Yes — schemes without it return 400** |
| 13 | Reward-excluded products per scheme | Implemented; must be identified per scheme | Only for schemes with slab-only products |
| 14 | Billing type per invoice line | Implemented; line-level override of invoice `tradeType` | Operational — depends on entry workflow |

Item 5 (`tradeType` assignment) is the most immediately blocking item. Under the current
eligibility logic, real invoices with `tradeType = NULL` are excluded from every scheme by
default. Therefore, no real incentive calculation can include those invoices until a workflow
populates and maintains this field.

Item 12 (`eligibleSupplierIds`) is also immediately blocking: any scheme whose eligible
supplier list is empty and `allowAnySupplier` is false will return a 400 on calculation.
