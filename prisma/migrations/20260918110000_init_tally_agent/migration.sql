CREATE TYPE "TallySyncJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');
CREATE TABLE "TallySyncHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromDate" TEXT,
    "toDate" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TallySyncHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallyConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentApiKeyHash" TEXT NOT NULL,
    "tallyCompanyName" TEXT,
    "label" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "tallyReachable" BOOLEAN NOT NULL DEFAULT false,
    "agentVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallySyncJob" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "companyId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL DEFAULT 'VOUCHERS',
    "status" "TallySyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "fromDate" TEXT,
    "toDate" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedByConnectionId" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" JSONB,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TallySyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TallyConnection_agentApiKeyHash_key" ON "TallyConnection"("agentApiKeyHash");
CREATE INDEX "TallyConnection_isActive_idx" ON "TallyConnection"("isActive");
CREATE UNIQUE INDEX "TallyConnection_companyId_tallyCompanyName_key" ON "TallyConnection"("companyId", "tallyCompanyName");
CREATE INDEX "TallySyncJob_connectionId_status_idx" ON "TallySyncJob"("connectionId", "status");
CREATE INDEX "TallySyncJob_companyId_status_createdAt_idx" ON "TallySyncJob"("companyId", "status", "createdAt");
ALTER TABLE "TallyConnection" ADD CONSTRAINT "TallyConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TallySyncJob" ADD CONSTRAINT "TallySyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TallyConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TallySyncJob" ADD CONSTRAINT "TallySyncJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
