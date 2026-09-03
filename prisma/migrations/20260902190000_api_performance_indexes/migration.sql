CREATE INDEX IF NOT EXISTS "SalesOrder_companyId_status_deliveryDate_idx" ON "SalesOrder"("companyId", "status", "deliveryDate");
CREATE INDEX IF NOT EXISTS "SalesOrderItem_salesOrderId_supplyStatus_committedDeliveryDate_idx" ON "SalesOrderItem"("salesOrderId", "supplyStatus", "committedDeliveryDate");
CREATE INDEX IF NOT EXISTS "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");
CREATE INDEX IF NOT EXISTS "MaterialRequest_sourceDocumentType_sourceDocumentId_createdAt_idx" ON "MaterialRequest"("sourceDocumentType", "sourceDocumentId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_companyId_status_expectedDate_idx" ON "PurchaseOrder"("companyId", "status", "expectedDate");
