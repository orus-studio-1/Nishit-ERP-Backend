CREATE TYPE "SalesEnquiryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QUOTED', 'LOST', 'CANCELLED');
CREATE TYPE "SalesSupplyMode" AS ENUM ('MAKE_TO_STOCK', 'MAKE_TO_ORDER');
CREATE TYPE "SalesCreditStatus" AS ENUM ('NOT_CHECKED', 'PASSED', 'BLOCKED', 'APPROVED');
CREATE TYPE "SalesTaxMode" AS ENUM ('CGST_SGST', 'IGST', 'EXPORT', 'SEZ', 'NONE');

ALTER TABLE "Customer" ADD COLUMN "customerGroup" TEXT, ADD COLUMN "holdReason" TEXT, ADD COLUMN "isOnHold" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "salesChannel" TEXT, ADD COLUMN "territory" TEXT;
ALTER TABLE "ItemPrice" ADD COLUMN "customerGroup" TEXT, ADD COLUMN "maxQty" DECIMAL(18,6), ADD COLUMN "minQty" DECIMAL(18,6), ADD COLUMN "salesChannel" TEXT, ADD COLUMN "territory" TEXT;
ALTER TABLE "PricingRule" ADD COLUMN "currency" TEXT, ADD COLUMN "customerGroup" TEXT, ADD COLUMN "isPromotional" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "minimumMarginPercent" DECIMAL(9,4), ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "salesChannel" TEXT, ADD COLUMN "territory" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "approvalInstanceId" UUID, ADD COLUMN "billingAddressSnapshot" JSONB, ADD COLUMN "branchId" UUID, ADD COLUMN "commercialConditions" JSONB, ADD COLUMN "deliveryTerms" TEXT, ADD COLUMN "openedAt" TIMESTAMP(3), ADD COLUMN "placeOfSupply" TEXT, ADD COLUMN "publicToken" TEXT, ADD COLUMN "rejectedAt" TIMESTAMP(3), ADD COLUMN "rejectionReason" TEXT, ADD COLUMN "revisionNo" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "sentAt" TIMESTAMP(3), ADD COLUMN "shippingAddressSnapshot" JSONB, ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "supersedesId" TEXT, ADD COLUMN "taxMode" "SalesTaxMode" NOT NULL DEFAULT 'NONE', ADD COLUMN "transporterInfo" JSONB;
ALTER TABLE "QuotationItem" ADD COLUMN "costRate" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "marginPercent" DECIMAL(9,4) NOT NULL DEFAULT 0, ADD COLUMN "priceSource" TEXT, ADD COLUMN "uomId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "amendedFromId" TEXT, ADD COLUMN "approvalInstanceId" UUID, ADD COLUMN "billingAddressSnapshot" JSONB, ADD COLUMN "branchId" UUID, ADD COLUMN "cancelReason" TEXT, ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "closedAt" TIMESTAMP(3), ADD COLUMN "creditBlockReason" TEXT, ADD COLUMN "creditStatus" "SalesCreditStatus" NOT NULL DEFAULT 'NOT_CHECKED', ADD COLUMN "deliveryTerms" TEXT, ADD COLUMN "eWayBillNo" TEXT, ADD COLUMN "placeOfSupply" TEXT, ADD COLUMN "resumedAt" TIMESTAMP(3), ADD COLUMN "revisionNo" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "salesChannel" TEXT, ADD COLUMN "shippingAddressSnapshot" JSONB, ADD COLUMN "shortCloseReason" TEXT, ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "taxMode" "SalesTaxMode" NOT NULL DEFAULT 'NONE', ADD COLUMN "territory" TEXT, ADD COLUMN "transporterInfo" JSONB;
ALTER TABLE "SalesOrderItem" ADD COLUMN "backorderQty" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "producedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "supplyMode" "SalesSupplyMode" NOT NULL DEFAULT 'MAKE_TO_STOCK', ADD COLUMN "uomId" TEXT;
ALTER TABLE "StockReservation" ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN "releaseReason" TEXT, ADD COLUMN "releasedAt" TIMESTAMP(3);

CREATE TABLE "SalesEnquiry" ("id" TEXT NOT NULL, "companyId" TEXT, "enquiryNo" TEXT NOT NULL, "customerId" TEXT NOT NULL, "opportunityId" TEXT, "status" "SalesEnquiryStatus" NOT NULL DEFAULT 'DRAFT', "requirements" TEXT, "targetDate" TIMESTAMP(3), "currency" TEXT NOT NULL DEFAULT 'USD', "territory" TEXT, "salesChannel" TEXT, "branchId" UUID, "submittedAt" TIMESTAMP(3), "convertedQuotationId" TEXT, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SalesEnquiry_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SalesEnquiryItem" ("id" TEXT NOT NULL, "enquiryId" TEXT NOT NULL, "productId" TEXT NOT NULL, "description" TEXT, "targetQty" DECIMAL(18,6) NOT NULL, "targetDate" TIMESTAMP(3), "targetPrice" DECIMAL(18,6), "uomId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SalesEnquiryItem_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SalesProductionPlan" ("id" TEXT NOT NULL, "companyId" TEXT, "planNo" TEXT NOT NULL, "salesOrderId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT', "targetDate" TIMESTAMP(3), "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SalesProductionPlan_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SalesProductionPlanItem" ("id" TEXT NOT NULL, "productionPlanId" TEXT NOT NULL, "salesOrderItemId" TEXT NOT NULL, "plannedQty" DECIMAL(18,6) NOT NULL, "producedQty" DECIMAL(18,6) NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'PLANNED', CONSTRAINT "SalesProductionPlanItem_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SalesPriceVariance" ("id" TEXT NOT NULL, "companyId" TEXT, "documentType" TEXT NOT NULL, "documentId" TEXT NOT NULL, "lineId" TEXT, "productId" TEXT NOT NULL, "customerId" TEXT, "resolvedRate" DECIMAL(18,6) NOT NULL, "appliedRate" DECIMAL(18,6) NOT NULL, "variance" DECIMAL(18,6) NOT NULL, "priceSource" TEXT, "approvedById" TEXT, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SalesPriceVariance_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "SalesEnquiry_enquiryNo_key" ON "SalesEnquiry"("enquiryNo");
CREATE UNIQUE INDEX "SalesEnquiry_convertedQuotationId_key" ON "SalesEnquiry"("convertedQuotationId");
CREATE INDEX "SalesEnquiry_companyId_status_createdAt_idx" ON "SalesEnquiry"("companyId", "status", "createdAt");
CREATE INDEX "SalesEnquiry_customerId_status_idx" ON "SalesEnquiry"("customerId", "status");
CREATE INDEX "SalesEnquiry_opportunityId_idx" ON "SalesEnquiry"("opportunityId");
CREATE UNIQUE INDEX "SalesProductionPlan_planNo_key" ON "SalesProductionPlan"("planNo");
CREATE INDEX "SalesProductionPlan_salesOrderId_status_idx" ON "SalesProductionPlan"("salesOrderId", "status");
CREATE INDEX "SalesPriceVariance_companyId_documentType_documentId_idx" ON "SalesPriceVariance"("companyId", "documentType", "documentId");
CREATE INDEX "SalesPriceVariance_productId_createdAt_idx" ON "SalesPriceVariance"("productId", "createdAt");
CREATE UNIQUE INDEX "Quotation_publicToken_key" ON "Quotation"("publicToken");

ALTER TABLE "SalesEnquiry" ADD CONSTRAINT "SalesEnquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesEnquiry" ADD CONSTRAINT "SalesEnquiry_convertedQuotationId_fkey" FOREIGN KEY ("convertedQuotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesEnquiryItem" ADD CONSTRAINT "SalesEnquiryItem_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "SalesEnquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesEnquiryItem" ADD CONSTRAINT "SalesEnquiryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_amendedFromId_fkey" FOREIGN KEY ("amendedFromId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesProductionPlan" ADD CONSTRAINT "SalesProductionPlan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProductionPlanItem" ADD CONSTRAINT "SalesProductionPlanItem_productionPlanId_fkey" FOREIGN KEY ("productionPlanId") REFERENCES "SalesProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductionPlanItem" ADD CONSTRAINT "SalesProductionPlanItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
