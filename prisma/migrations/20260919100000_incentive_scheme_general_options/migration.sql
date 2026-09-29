-- Incentive schemes: general per-scheme options.
--  * allowAnyTradeType: when true, the scheme ignores PurchaseInvoice.tradeType entirely
--    (including NULL). Default false keeps the existing "must match eligibleTradeTypes" behaviour.
--  * slabMode: HIGHEST_SLAB_WINS (existing behaviour, provisional) or PROGRESSIVE (banded).
-- Both columns have defaults, so existing rows keep their current behaviour.

CREATE TYPE "IncentiveSlabMode" AS ENUM ('HIGHEST_SLAB_WINS', 'PROGRESSIVE');

ALTER TABLE "IncentiveScheme"
  ADD COLUMN "allowAnyTradeType" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slabMode" "IncentiveSlabMode" NOT NULL DEFAULT 'HIGHEST_SLAB_WINS';
