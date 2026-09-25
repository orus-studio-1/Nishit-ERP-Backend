-- Confirmed Panasonic rules:
--  * amountBasis: pre-tax amount, before discount by default.
--  * eligibleSupplierIds / allowAnySupplier: the incentive applies only to purchases from the named supplier(s).
--  * rewardExcludedProductIds: products that count towards the slab but earn no reward.
--  * Contribution keeps the reward amount separately from the slab amount; items record countForReward.
--  * PurchaseInvoiceItem.tradeType: optional billing type for one line, overriding the invoice's.
-- Existing schemes get allowAnySupplier = false and no suppliers, so they must be given eligible
-- suppliers before they can be calculated again.

CREATE TYPE "IncentiveAmountBasis" AS ENUM ('PRE_TAX_BEFORE_DISCOUNT', 'PRE_TAX_AFTER_DISCOUNT');

ALTER TABLE "IncentiveScheme"
  ADD COLUMN "amountBasis" "IncentiveAmountBasis" NOT NULL DEFAULT 'PRE_TAX_BEFORE_DISCOUNT',
  ADD COLUMN "eligibleSupplierIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "allowAnySupplier" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rewardExcludedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "IncentiveContribution"
  ADD COLUMN "rewardEligibleValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "rewardEligibleQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0;

UPDATE "IncentiveContribution" SET "rewardEligibleValue" = "eligibleValue", "rewardEligibleQuantity" = "eligibleQuantity";

ALTER TABLE "IncentiveContributionItem" ADD COLUMN "countForReward" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "tradeType" "PurchaseInvoiceTradeType";
