ALTER TABLE "PurchaseOrder" ADD COLUMN "vendorDocumentDetails" JSONB;
ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "categoryCode" TEXT,
  ADD COLUMN "hsnCode" TEXT,
  ADD COLUMN "make" TEXT,
  ADD COLUMN "quantityTolerance" TEXT,
  ADD COLUMN "expectedDate" TIMESTAMP(3);
ALTER TABLE "SupplierQuotation" ADD COLUMN "vendorDocumentDetails" JSONB;
ALTER TABLE "SupplierQuotationItem"
  ADD COLUMN "categoryCode" TEXT,
  ADD COLUMN "hsnCode" TEXT,
  ADD COLUMN "make" TEXT,
  ADD COLUMN "quantityTolerance" TEXT;
