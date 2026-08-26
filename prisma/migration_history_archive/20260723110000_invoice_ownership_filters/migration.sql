ALTER TABLE "SalesInvoice"
ADD COLUMN "createdById" TEXT,
ADD COLUMN "assignedToId" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "SalesInvoice"
ADD CONSTRAINT "SalesInvoice_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesInvoice"
ADD CONSTRAINT "SalesInvoice_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesInvoice_createdById_idx" ON "SalesInvoice"("createdById");
CREATE INDEX "SalesInvoice_assignedToId_idx" ON "SalesInvoice"("assignedToId");
