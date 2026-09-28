-- CreateTable
CREATE TABLE "TallyEntityMap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "tallyKey" TEXT NOT NULL,
    "erpId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyEntityMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TallyEntityMap_companyId_entityType_idx" ON "TallyEntityMap"("companyId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "TallyEntityMap_companyId_entityType_tallyKey_key" ON "TallyEntityMap"("companyId", "entityType", "tallyKey");
