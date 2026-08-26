DROP INDEX IF EXISTS "Account_code_key";

CREATE UNIQUE INDEX "Account_companyId_code_key" ON "Account"("companyId", "code");
