DROP INDEX IF EXISTS "Category_code_key";
DROP INDEX IF EXISTS "Unit_name_key";
DROP INDEX IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Warehouse_code_key";

CREATE UNIQUE INDEX "Category_companyId_code_key" ON "Category"("companyId", "code");
CREATE UNIQUE INDEX "Unit_companyId_name_key" ON "Unit"("companyId", "name");
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");
CREATE UNIQUE INDEX "Warehouse_companyId_code_key" ON "Warehouse"("companyId", "code");
