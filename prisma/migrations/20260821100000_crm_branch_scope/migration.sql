ALTER TABLE "Opportunity" ADD COLUMN "branchId" UUID;
ALTER TABLE "Activity" ADD COLUMN "branchId" UUID;

CREATE INDEX "Opportunity_branchId_ownerId_idx" ON "Opportunity"("branchId", "ownerId");
CREATE INDEX "Activity_branchId_userId_idx" ON "Activity"("branchId", "userId");
