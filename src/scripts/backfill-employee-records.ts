/**
 * Creates the missing Employee record for users who signed up through the Register page
 * while the record was being dropped (duplicate employee number from the wrong numbering series).
 * Numbers come from each company's own EMPLOYEE series, exactly like HR → Employees.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-employee-records.ts --dry-run   # list who would get a record
 *   npx tsx src/scripts/backfill-employee-records.ts             # create the records
 */
import prisma from '../lib/prisma';
import { runWithTenant } from '../utils/tenant';
import { generateEmployeeId } from '../utils/generate';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const users = await prisma.user.findMany({
    where: { employee: null, companyId: { not: null } },
    select: { id: true, email: true, createdAt: true, companyId: true, company: { select: { tenantId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${users.length} user(s) without an employee record${dryRun ? ' (dry run, nothing written)' : ''}`);

  for (const user of users) {
    const masked = user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
    const branch = await prisma.branch.findFirst({ where: { companyId: user.companyId!, isActive: true }, orderBy: { createdAt: 'asc' } });
    if (dryRun) { console.log(`  would create: ${masked} (signed up ${user.createdAt.toISOString().slice(0, 10)})`); continue; }
    const employeeId = await runWithTenant({ tenantId: user.company?.tenantId, companyId: user.companyId, branchId: branch?.id }, () =>
      prisma.$transaction(async (tx: any) => {
        const id = await generateEmployeeId(tx);
        await tx.employee.create({ data: { employeeId: id, userId: user.id, hireDate: user.createdAt, salary: 0, salaryType: 'MONTHLY', status: 'ACTIVE', companyEmail: user.email, branch: branch?.name } });
        return id;
      }));
    console.log(`  created ${employeeId} for ${masked}`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
