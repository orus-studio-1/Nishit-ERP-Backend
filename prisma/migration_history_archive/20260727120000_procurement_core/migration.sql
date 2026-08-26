ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'MATERIAL_REQUEST';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'REQUEST_FOR_QUOTATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_QUOTATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'LANDED_COST_VOUCHER';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'BLANKET_PURCHASE_ORDER';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'QUALITY_INSPECTION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'BUYING_SETTINGS';

ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT';
ALTER TYPE "LedgerVoucherType" ADD VALUE IF NOT EXISTS 'LANDED_COST_VOUCHER';

DO $$ BEGIN CREATE TYPE "MaterialRequestType" AS ENUM ('PURCHASE', 'TRANSFER', 'MANUFACTURE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MaterialRequestSource" AS ENUM ('MANUAL', 'REORDER', 'PROJECT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SENT', 'QUOTED', 'CLOSED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RfqSupplierStatus" AS ENUM ('PENDING', 'SENT', 'RESPONDED', 'DECLINED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierQuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "QualityInspectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LandedCostAllocationBasis" AS ENUM ('VALUE', 'QUANTITY', 'WEIGHT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LandedCostChargeType" AS ENUM ('FREIGHT', 'CUSTOMS', 'INSURANCE', 'HANDLING', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierPaymentType" AS ENUM ('ADVANCE', 'INVOICE_PAYMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CommunicationChannel" AS ENUM ('EMAIL', 'PHONE', 'PORTAL', 'NOTE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "materialRequestId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "rfqId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "supplierQuotationId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "blanketPurchaseOrderId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "workflowStatus" "DocumentStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "shippingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "baseTotal" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "advancePaid" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "receivedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "billedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paymentTermsTemplateId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "amendedFromId" TEXT;

ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "billedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "uom" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "stockUom" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "supplierItemCode" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "supplierItemName" TEXT;

ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "purchaseReceiptId" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "workflowStatus" "DocumentStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "shippingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "baseTotal" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "outstandingAmount" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "uom" TEXT;
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "stockUom" TEXT;
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "BuyingSettings" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "defaultBuyingPriceListId" TEXT,
  "requirePurchaseOrderForInvoice" BOOLEAN NOT NULL DEFAULT false,
  "requirePurchaseReceiptForInvoice" BOOLEAN NOT NULL DEFAULT false,
  "defaultRfqTerms" TEXT,
  "overReceiptAllowancePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "overBillingAllowancePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "autoCreateMaterialRequest" BOOLEAN NOT NULL DEFAULT true,
  "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyingSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BuyingSettings_companyId_key" ON "BuyingSettings"("companyId");

CREATE TABLE IF NOT EXISTS "PaymentTermsTemplate" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTermsTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTermsTemplate_companyId_name_key" ON "PaymentTermsTemplate"("companyId","name");

CREATE TABLE IF NOT EXISTS "PaymentTerm" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "percentage" DECIMAL(9,4) NOT NULL,
  "dueAfterDays" INTEGER NOT NULL DEFAULT 0,
  "milestone" TEXT,
  "rowOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PaymentTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierItem" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierItemCode" TEXT NOT NULL,
  "supplierItemName" TEXT,
  "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierItem_supplierId_productId_key" ON "SupplierItem"("supplierId","productId");

CREATE TABLE IF NOT EXISTS "MaterialRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "requestNo" TEXT NOT NULL,
  "type" "MaterialRequestType" NOT NULL DEFAULT 'PURCHASE',
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "MaterialRequestSource" NOT NULL DEFAULT 'MANUAL',
  "requiredBy" TIMESTAMP(3),
  "requestedById" TEXT,
  "costCenterId" TEXT,
  "projectId" TEXT,
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialRequest_requestNo_key" ON "MaterialRequest"("requestNo");

CREATE TABLE IF NOT EXISTS "MaterialRequestItem" (
  "id" TEXT NOT NULL,
  "materialRequestId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "orderedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "uom" TEXT,
  "stockUom" TEXT,
  "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "requiredBy" TIMESTAMP(3),
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RequestForQuotation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "rfqNo" TEXT NOT NULL,
  "materialRequestId" TEXT,
  "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
  "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "terms" TEXT,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestForQuotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestForQuotation_rfqNo_key" ON "RequestForQuotation"("rfqNo");

CREATE TABLE IF NOT EXISTS "RequestForQuotationItem" (
  "id" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT,
  "stockUom" TEXT,
  "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "description" TEXT,
  "requiredBy" TIMESTAMP(3),
  CONSTRAINT "RequestForQuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RequestForQuotationSupplier" (
  "id" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "email" TEXT,
  "status" "RfqSupplierStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "RequestForQuotationSupplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestForQuotationSupplier_rfqId_supplierId_key" ON "RequestForQuotationSupplier"("rfqId","supplierId");

CREATE TABLE IF NOT EXISTS "SupplierQuotation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "quotationNo" TEXT NOT NULL,
  "rfqId" TEXT,
  "supplierId" TEXT NOT NULL,
  "status" "SupplierQuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "shippingAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "deliveryScore" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "terms" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierQuotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierQuotation_quotationNo_key" ON "SupplierQuotation"("quotationNo");

CREATE TABLE IF NOT EXISTS "SupplierQuotationItem" (
  "id" TEXT NOT NULL,
  "supplierQuotationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierItemCode" TEXT,
  "description" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uom" TEXT,
  "stockUom" TEXT,
  "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "rate" DECIMAL(18,6) NOT NULL,
  "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "discount" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "deliveryDate" TIMESTAMP(3),
  CONSTRAINT "SupplierQuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BlanketPurchaseOrder" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "agreementNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "terms" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlanketPurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlanketPurchaseOrder_agreementNo_key" ON "BlanketPurchaseOrder"("agreementNo");

CREATE TABLE IF NOT EXISTS "BlanketPurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "blanketPurchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "orderedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rate" DECIMAL(18,6) NOT NULL,
  "uom" TEXT,
  "stockUom" TEXT,
  "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  CONSTRAINT "BlanketPurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseReceipt" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "receiptNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "landedCostAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "costCenterId" TEXT,
  "projectId" TEXT,
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReceipt_receiptNo_key" ON "PurchaseReceipt"("receiptNo");

CREATE TABLE IF NOT EXISTS "PurchaseReceiptItem" (
  "id" TEXT NOT NULL,
  "purchaseReceiptId" TEXT NOT NULL,
  "purchaseOrderItemId" TEXT,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "description" TEXT,
  "receivedQty" DECIMAL(18,6) NOT NULL,
  "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "landedCostShare" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "uom" TEXT,
  "stockUom" TEXT,
  "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "batchNo" TEXT,
  "serialNo" TEXT,
  "qualityStatus" "QualityInspectionStatus",
  CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QualityInspection" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "inspectionNo" TEXT NOT NULL,
  "purchaseReceiptId" TEXT,
  "productId" TEXT,
  "status" "QualityInspectionStatus" NOT NULL DEFAULT 'PENDING',
  "inspectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "acceptedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "inspectedById" TEXT,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QualityInspection_inspectionNo_key" ON "QualityInspection"("inspectionNo");

CREATE TABLE IF NOT EXISTS "LandedCostVoucher" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "voucherNo" TEXT NOT NULL,
  "purchaseReceiptId" TEXT NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "allocationBasis" "LandedCostAllocationBasis" NOT NULL DEFAULT 'VALUE',
  "totalCharges" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandedCostVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LandedCostVoucher_voucherNo_key" ON "LandedCostVoucher"("voucherNo");

CREATE TABLE IF NOT EXISTS "LandedCostCharge" (
  "id" TEXT NOT NULL,
  "landedCostVoucherId" TEXT NOT NULL,
  "type" "LandedCostChargeType" NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(18,6) NOT NULL,
  "accountId" TEXT,
  CONSTRAINT "LandedCostCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LandedCostAllocation" (
  "id" TEXT NOT NULL,
  "landedCostVoucherId" TEXT NOT NULL,
  "purchaseReceiptItemId" TEXT NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL,
  CONSTRAINT "LandedCostAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierPayment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "paymentNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "purchaseInvoiceId" TEXT,
  "status" "PaymentEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "type" "SupplierPaymentType" NOT NULL DEFAULT 'INVOICE_PAYMENT',
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "amount" DECIMAL(18,6) NOT NULL,
  "allocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "unallocatedAmount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
  "reference" TEXT,
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPayment_paymentNo_key" ON "SupplierPayment"("paymentNo");

CREATE TABLE IF NOT EXISTS "SupplierCommunicationLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "supplierId" TEXT,
  "rfqId" TEXT,
  "supplierQuotationId" TEXT,
  "channel" "CommunicationChannel" NOT NULL DEFAULT 'EMAIL',
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "SupplierCommunicationLog_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN ALTER TABLE "PaymentTerm" ADD CONSTRAINT "PaymentTerm_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PaymentTermsTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RequestForQuotationItem" ADD CONSTRAINT "RequestForQuotationItem_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RequestForQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RequestForQuotationSupplier" ADD CONSTRAINT "RequestForQuotationSupplier_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RequestForQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SupplierQuotationItem" ADD CONSTRAINT "SupplierQuotationItem_supplierQuotationId_fkey" FOREIGN KEY ("supplierQuotationId") REFERENCES "SupplierQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BlanketPurchaseOrderItem" ADD CONSTRAINT "BlanketPurchaseOrderItem_blanketPurchaseOrderId_fkey" FOREIGN KEY ("blanketPurchaseOrderId") REFERENCES "BlanketPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LandedCostCharge" ADD CONSTRAINT "LandedCostCharge_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "LandedCostVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LandedCostAllocation" ADD CONSTRAINT "LandedCostAllocation_landedCostVoucherId_fkey" FOREIGN KEY ("landedCostVoucherId") REFERENCES "LandedCostVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
