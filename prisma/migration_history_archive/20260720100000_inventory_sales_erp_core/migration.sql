-- These shared enums existed in the original database but were omitted from the
-- migration history. Keep creation duplicate-safe for already-provisioned databases
-- while making a zero-state/shadow replay deterministic.
DO $$ BEGIN
  CREATE TYPE "DocumentType" AS ENUM (
    'QUOTATION', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE',
    'PAYMENT_ENTRY', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_INVOICE',
    'EMPLOYEE', 'ATTENDANCE', 'LEAVE_APPLICATION', 'PAYROLL_ENTRY',
    'SALARY_SLIP', 'EMPLOYEE_LIFECYCLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ValuationMethod" AS ENUM ('FIFO', 'MOVING_AVERAGE', 'STANDARD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'PARTIAL', 'FULFILLED', 'RELEASED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "StockEntryPurpose" AS ENUM ('MATERIAL_RECEIPT', 'MATERIAL_ISSUE', 'MATERIAL_TRANSFER', 'STOCK_RECONCILIATION', 'OPENING_STOCK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SerialNumberStatus" AS ENUM ('AVAILABLE', 'DELIVERED', 'RESERVED', 'SCRAPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'STOCK_ENTRY';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "valuationMethod" "ValuationMethod" NOT NULL DEFAULT 'MOVING_AVERAGE';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maintainStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "hasBatchNo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "hasSerialNo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderLevel" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "manufacturer" TEXT;

ALTER TABLE "StockLevel" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION;
ALTER TABLE "StockLevel" ALTER COLUMN "reservedQty" TYPE DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "Batch" (
  "id" TEXT NOT NULL,
  "batchNo" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "expiryDate" TIMESTAMP(3),
  "manufacturingDate" TIMESTAMP(3),
  "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SerialNumber" (
  "id" TEXT NOT NULL,
  "serialNo" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "status" "SerialNumberStatus" NOT NULL DEFAULT 'AVAILABLE',
  "batchId" TEXT,
  "purchaseRate" DECIMAL(18,6),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockLedgerEntry" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voucherType" TEXT NOT NULL,
  "voucherId" TEXT,
  "voucherNo" TEXT NOT NULL,
  "actualQty" DECIMAL(18,6) NOT NULL,
  "qtyAfterTransaction" DECIMAL(18,6) NOT NULL,
  "incomingRate" DECIMAL(18,6),
  "outgoingRate" DECIMAL(18,6),
  "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "stockValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "stockValueDifference" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "batchId" TEXT,
  "serialNoId" TEXT,
  "isCancelled" BOOLEAN NOT NULL DEFAULT false,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryValuationLayer" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "sourceLedgerEntryId" TEXT,
  "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "originalQty" DECIMAL(18,6) NOT NULL,
  "remainingQty" DECIMAL(18,6) NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryValuationLayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockReservation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "salesOrderId" TEXT NOT NULL,
  "salesOrderItemId" TEXT NOT NULL,
  "reservedQty" DECIMAL(18,6) NOT NULL,
  "fulfilledQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockEntry" (
  "id" TEXT NOT NULL,
  "entryNo" TEXT NOT NULL,
  "purpose" "StockEntryPurpose" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fromWarehouseId" TEXT,
  "toWarehouseId" TEXT,
  "remarks" TEXT,
  "submittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockEntryItem" (
  "id" TEXT NOT NULL,
  "stockEntryId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "valuationRate" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "batchId" TEXT,
  "serialNoId" TEXT,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockEntryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PriceList" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "selling" BOOLEAN NOT NULL DEFAULT true,
  "buying" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ItemPrice" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "unitId" TEXT,
  "customerId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "price" DECIMAL(18,6) NOT NULL,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PricingRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceListId" TEXT,
  "productId" TEXT,
  "categoryId" TEXT,
  "customerId" TEXT,
  "minQty" DECIMAL(18,6),
  "maxQty" DECIMAL(18,6),
  "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "marginPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductUomConversion" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "fromUnitId" TEXT NOT NULL,
  "toUnitId" TEXT NOT NULL,
  "factor" DECIMAL(18,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductUomConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Batch_batchNo_key" ON "Batch"("batchNo");
CREATE UNIQUE INDEX IF NOT EXISTS "SerialNumber_serialNo_key" ON "SerialNumber"("serialNo");
CREATE UNIQUE INDEX IF NOT EXISTS "StockEntry_entryNo_key" ON "StockEntry"("entryNo");
CREATE UNIQUE INDEX IF NOT EXISTS "PriceList_name_key" ON "PriceList"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUomConversion_productId_fromUnitId_toUnitId_key" ON "ProductUomConversion"("productId", "fromUnitId", "toUnitId");

CREATE INDEX IF NOT EXISTS "Batch_productId_warehouseId_idx" ON "Batch"("productId", "warehouseId");
CREATE INDEX IF NOT EXISTS "Batch_expiryDate_idx" ON "Batch"("expiryDate");
CREATE INDEX IF NOT EXISTS "SerialNumber_productId_status_idx" ON "SerialNumber"("productId", "status");
CREATE INDEX IF NOT EXISTS "SerialNumber_warehouseId_idx" ON "SerialNumber"("warehouseId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_productId_warehouseId_postingDate_idx" ON "StockLedgerEntry"("productId", "warehouseId", "postingDate");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_voucherType_voucherId_idx" ON "StockLedgerEntry"("voucherType", "voucherId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_batchId_idx" ON "StockLedgerEntry"("batchId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_serialNoId_idx" ON "StockLedgerEntry"("serialNoId");
CREATE INDEX IF NOT EXISTS "InventoryValuationLayer_productId_warehouseId_isClosed_postingDate_idx" ON "InventoryValuationLayer"("productId", "warehouseId", "isClosed", "postingDate");
CREATE INDEX IF NOT EXISTS "StockReservation_productId_warehouseId_status_idx" ON "StockReservation"("productId", "warehouseId", "status");
CREATE INDEX IF NOT EXISTS "StockReservation_salesOrderId_idx" ON "StockReservation"("salesOrderId");
CREATE INDEX IF NOT EXISTS "StockReservation_salesOrderItemId_idx" ON "StockReservation"("salesOrderItemId");
CREATE INDEX IF NOT EXISTS "StockEntry_status_purpose_idx" ON "StockEntry"("status", "purpose");
CREATE INDEX IF NOT EXISTS "StockEntry_postingDate_idx" ON "StockEntry"("postingDate");
CREATE INDEX IF NOT EXISTS "StockEntryItem_stockEntryId_idx" ON "StockEntryItem"("stockEntryId");
CREATE INDEX IF NOT EXISTS "StockEntryItem_productId_idx" ON "StockEntryItem"("productId");
CREATE INDEX IF NOT EXISTS "ItemPrice_productId_priceListId_customerId_idx" ON "ItemPrice"("productId", "priceListId", "customerId");
CREATE INDEX IF NOT EXISTS "PricingRule_isActive_priority_idx" ON "PricingRule"("isActive", "priority");
CREATE INDEX IF NOT EXISTS "PricingRule_productId_idx" ON "PricingRule"("productId");
CREATE INDEX IF NOT EXISTS "PricingRule_categoryId_idx" ON "PricingRule"("categoryId");
CREATE INDEX IF NOT EXISTS "PricingRule_customerId_idx" ON "PricingRule"("customerId");

DO $$ BEGIN ALTER TABLE "Batch" ADD CONSTRAINT "Batch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Batch" ADD CONSTRAINT "Batch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_serialNoId_fkey" FOREIGN KEY ("serialNoId") REFERENCES "SerialNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InventoryValuationLayer" ADD CONSTRAINT "InventoryValuationLayer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InventoryValuationLayer" ADD CONSTRAINT "InventoryValuationLayer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockEntryItem" ADD CONSTRAINT "StockEntryItem_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "StockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockEntryItem" ADD CONSTRAINT "StockEntryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "StockEntryItem" ADD CONSTRAINT "StockEntryItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductUomConversion" ADD CONSTRAINT "ProductUomConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
