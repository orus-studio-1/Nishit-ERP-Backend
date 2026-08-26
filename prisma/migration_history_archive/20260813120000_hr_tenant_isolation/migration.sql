-- Add company ownership to HR master and payroll records.
ALTER TABLE "ShiftType" ADD COLUMN "companyId" TEXT;
ALTER TABLE "LeaveType" ADD COLUMN "companyId" TEXT;
ALTER TABLE "LeavePeriod" ADD COLUMN "companyId" TEXT;
ALTER TABLE "LeavePolicy" ADD COLUMN "companyId" TEXT;
ALTER TABLE "SalaryComponent" ADD COLUMN "companyId" TEXT;
ALTER TABLE "SalaryStructure" ADD COLUMN "companyId" TEXT;
ALTER TABLE "PayrollEntry" ADD COLUMN "companyId" TEXT;

-- Preserve existing data by deriving ownership from linked employees/users where possible.
UPDATE "ShiftType" s SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (a."shiftTypeId") a."shiftTypeId", u."companyId" FROM "ShiftAssignment" a JOIN "Employee" e ON e.id = a."employeeId" JOIN "User" u ON u.id = e."userId" WHERE u."companyId" IS NOT NULL ORDER BY a."shiftTypeId", a."createdAt") x
WHERE s.id = x."shiftTypeId";
UPDATE "LeaveType" t SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (a."leaveTypeId") a."leaveTypeId", u."companyId" FROM "LeaveAllocation" a JOIN "Employee" e ON e.id = a."employeeId" JOIN "User" u ON u.id = e."userId" WHERE u."companyId" IS NOT NULL ORDER BY a."leaveTypeId", a."createdAt") x
WHERE t.id = x."leaveTypeId";
UPDATE "LeavePeriod" p SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (a."leavePeriodId") a."leavePeriodId", u."companyId" FROM "LeaveAllocation" a JOIN "Employee" e ON e.id = a."employeeId" JOIN "User" u ON u.id = e."userId" WHERE a."leavePeriodId" IS NOT NULL AND u."companyId" IS NOT NULL ORDER BY a."leavePeriodId", a."createdAt") x
WHERE p.id = x."leavePeriodId";
UPDATE "SalaryStructure" s SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (a."salaryStructureId") a."salaryStructureId", u."companyId" FROM "SalaryStructureAssignment" a JOIN "Employee" e ON e.id = a."employeeId" JOIN "User" u ON u.id = e."userId" WHERE u."companyId" IS NOT NULL ORDER BY a."salaryStructureId", a."createdAt") x
WHERE s.id = x."salaryStructureId";
UPDATE "SalaryComponent" c SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (sc."salaryComponentId") sc."salaryComponentId", s."companyId" FROM "SalaryStructureComponent" sc JOIN "SalaryStructure" s ON s.id = sc."salaryStructureId" WHERE s."companyId" IS NOT NULL ORDER BY sc."salaryComponentId") x
WHERE c.id = x."salaryComponentId";
UPDATE "PayrollEntry" p SET "companyId" = x."companyId"
FROM (SELECT DISTINCT ON (s."payrollEntryId") s."payrollEntryId", u."companyId" FROM "SalarySlip" s JOIN "Employee" e ON e.id = s."employeeId" JOIN "User" u ON u.id = e."userId" WHERE s."payrollEntryId" IS NOT NULL AND u."companyId" IS NOT NULL ORDER BY s."payrollEntryId", s."createdAt") x
WHERE p.id = x."payrollEntryId";

-- In a single-company installation, unlinked legacy masters belong to that company.
UPDATE "ShiftType" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "LeaveType" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "LeavePeriod" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "LeavePolicy" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "SalaryComponent" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "SalaryStructure" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;
UPDATE "PayrollEntry" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL AND (SELECT COUNT(*) FROM "Company") = 1;

DROP INDEX IF EXISTS "LeavePolicy_name_key";
DROP INDEX IF EXISTS "SalaryComponent_name_key";
DROP INDEX IF EXISTS "SalaryStructure_name_key";
DROP INDEX IF EXISTS "PayrollEntry_payrollNo_key";
DROP INDEX IF EXISTS "PayrollEntry_month_year_key";

CREATE INDEX "ShiftType_companyId_idx" ON "ShiftType"("companyId");
CREATE INDEX "LeaveType_companyId_idx" ON "LeaveType"("companyId");
CREATE INDEX "LeavePeriod_companyId_idx" ON "LeavePeriod"("companyId");
CREATE INDEX "LeavePolicy_companyId_idx" ON "LeavePolicy"("companyId");
CREATE UNIQUE INDEX "LeavePolicy_companyId_name_key" ON "LeavePolicy"("companyId", "name");
CREATE INDEX "SalaryComponent_companyId_idx" ON "SalaryComponent"("companyId");
CREATE UNIQUE INDEX "SalaryComponent_companyId_name_key" ON "SalaryComponent"("companyId", "name");
CREATE INDEX "SalaryStructure_companyId_idx" ON "SalaryStructure"("companyId");
CREATE UNIQUE INDEX "SalaryStructure_companyId_name_key" ON "SalaryStructure"("companyId", "name");
CREATE INDEX "PayrollEntry_companyId_idx" ON "PayrollEntry"("companyId");
CREATE UNIQUE INDEX "PayrollEntry_companyId_payrollNo_key" ON "PayrollEntry"("companyId", "payrollNo");
CREATE UNIQUE INDEX "PayrollEntry_companyId_month_year_key" ON "PayrollEntry"("companyId", "month", "year");

ALTER TABLE "ShiftType" ADD CONSTRAINT "ShiftType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeavePeriod" ADD CONSTRAINT "LeavePeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalaryComponent" ADD CONSTRAINT "SalaryComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
