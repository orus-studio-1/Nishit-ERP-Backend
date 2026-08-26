ALTER TABLE "PurchaseOrder"
  ADD COLUMN "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "trackingReference" TEXT,
  ADD COLUMN "estimatedArrivalAt" TIMESTAMP(3),
  ADD COLUMN "delayReason" TEXT,
  ADD COLUMN "lastFollowUpAt" TIMESTAMP(3);

ALTER TABLE "SupplierCommunicationLog" ADD COLUMN "purchaseOrderId" TEXT;
CREATE INDEX "SupplierCommunicationLog_purchaseOrderId_sentAt_idx"
  ON "SupplierCommunicationLog"("purchaseOrderId", "sentAt");
ALTER TABLE "SupplierCommunicationLog"
  ADD CONSTRAINT "SupplierCommunicationLog_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesInvoiceItem" ADD COLUMN "salesOrderItemId" TEXT;
CREATE INDEX "SalesInvoiceItem_salesOrderItemId_idx" ON "SalesInvoiceItem"("salesOrderItemId");
ALTER TABLE "SalesInvoiceItem"
  ADD CONSTRAINT "SalesInvoiceItem_salesOrderItemId_fkey"
  FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeliveryNoteItem" ADD COLUMN "salesOrderItemId" TEXT;
CREATE INDEX "DeliveryNoteItem_salesOrderItemId_idx" ON "DeliveryNoteItem"("salesOrderItemId");
ALTER TABLE "DeliveryNoteItem"
  ADD CONSTRAINT "DeliveryNoteItem_salesOrderItemId_fkey"
  FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Batch_companyId_batchNo_key";
CREATE UNIQUE INDEX "Batch_companyId_batchNo_warehouseId_key" ON "Batch"("companyId", "batchNo", "warehouseId");
