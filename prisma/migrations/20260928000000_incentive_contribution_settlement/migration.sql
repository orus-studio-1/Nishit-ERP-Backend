-- Adds settlement tracking to IncentiveContribution: whether the incentive amount was
-- actually received from the manufacturer (as opposed to just calculated/estimated).
-- Hand-authored for the same reason as the other incentive migrations (see
-- 20260918100000_incentive_scheme_tracking_phase1): no shadowDatabaseUrl configured.

CREATE TYPE "IncentiveSettlementStatus" AS ENUM ('PENDING', 'SETTLED');

ALTER TABLE "IncentiveContribution"
  ADD COLUMN "settlementStatus" "IncentiveSettlementStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "settledAmount" DECIMAL(18,6),
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "settledReference" TEXT,
  ADD COLUMN "settledById" TEXT,
  ADD COLUMN "settlementNotes" TEXT;

CREATE INDEX "IncentiveContribution_schemeId_settlementStatus_idx" ON "IncentiveContribution"("schemeId", "settlementStatus");
