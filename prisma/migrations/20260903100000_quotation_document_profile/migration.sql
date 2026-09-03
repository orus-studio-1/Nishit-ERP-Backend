ALTER TABLE "Company" ADD COLUMN "quotationDefaults" JSONB;

ALTER TABLE "Quotation"
  ADD COLUMN "deliveryCharges" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryChargesNote" TEXT,
  ADD COLUMN "customerNameSnapshot" TEXT,
  ADD COLUMN "companySnapshot" JSONB;

ALTER TABLE "QuotationItem"
  ADD COLUMN "hsnCode" TEXT,
  ADD COLUMN "brand" TEXT;
