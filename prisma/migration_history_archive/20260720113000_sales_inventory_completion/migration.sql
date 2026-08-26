ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
DO $$ BEGIN CREATE TYPE "WarehouseType" AS ENUM ('COMPANY', 'BRANCH', 'ROOM', 'BIN', 'WAREHOUSE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "type" "WarehouseType" NOT NULL DEFAULT 'WAREHOUSE';
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultWarehouseId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isVariant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantOfId" TEXT;

ALTER TYPE "StockEntryPurpose" ADD VALUE IF NOT EXISTS 'REPACK';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "customerPoNo" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "sourceWarehouseId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deliveredPercent" DECIMAL(9,4) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "billedPercent" DECIMAL(9,4) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "amountBilled" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "holdReason" TEXT;

ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "billedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "sourceWarehouseId" TEXT;

CREATE TABLE IF NOT EXISTS "ProductAttribute" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductAttributeValue" (
  "id" TEXT NOT NULL,
  "attributeId" TEXT NOT NULL,
  "productId" TEXT,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductAttribute_name_key" ON "ProductAttribute"("name");
CREATE INDEX IF NOT EXISTS "Warehouse_parentId_idx" ON "Warehouse"("parentId");
CREATE INDEX IF NOT EXISTS "Warehouse_companyId_idx" ON "Warehouse"("companyId");
CREATE INDEX IF NOT EXISTS "Product_variantOfId_idx" ON "Product"("variantOfId");
CREATE INDEX IF NOT EXISTS "Product_defaultWarehouseId_idx" ON "Product"("defaultWarehouseId");
CREATE INDEX IF NOT EXISTS "SalesOrder_customerPoNo_idx" ON "SalesOrder"("customerPoNo");
CREATE INDEX IF NOT EXISTS "SalesOrder_sourceWarehouseId_idx" ON "SalesOrder"("sourceWarehouseId");
CREATE INDEX IF NOT EXISTS "ProductAttributeValue_attributeId_idx" ON "ProductAttributeValue"("attributeId");
CREATE INDEX IF NOT EXISTS "ProductAttributeValue_productId_idx" ON "ProductAttributeValue"("productId");

DO $$ BEGIN ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Product" ADD CONSTRAINT "Product_variantOfId_fkey" FOREIGN KEY ("variantOfId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "ProductAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
