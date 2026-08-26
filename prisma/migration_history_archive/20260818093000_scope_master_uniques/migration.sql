DROP INDEX IF EXISTS "Batch_batchNo_key";
DROP INDEX IF EXISTS "SerialNumber_serialNo_key";
DROP INDEX IF EXISTS "PriceList_name_key";
DROP INDEX IF EXISTS "Department_code_key";
DROP INDEX IF EXISTS "TaxTemplate_code_key";

CREATE UNIQUE INDEX "Batch_companyId_batchNo_key" ON "Batch"("companyId", "batchNo");
CREATE UNIQUE INDEX "SerialNumber_companyId_serialNo_key" ON "SerialNumber"("companyId", "serialNo");
CREATE UNIQUE INDEX "PriceList_companyId_name_key" ON "PriceList"("companyId", "name");
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");
CREATE UNIQUE INDEX "TaxTemplate_companyId_code_key" ON "TaxTemplate"("companyId", "code");
