import { syncTallyVouchers } from '../services/tally/tallySync';
import prisma from '../lib/prisma';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: npm run sync:tally <companyId> <fromDate: YYYYMMDD> <toDate: YYYYMMDD>');
    console.error('Example: npm run sync:tally cm123abcd 20230401 20240331');
    process.exit(1);
  }

  const [companyId, fromDate, toDate] = args;

  // Basic validation
  if (!/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate)) {
    console.error('Error: Dates must be in YYYYMMDD format.');
    process.exit(1);
  }

  // Verify company exists
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true }
  });

  if (!company) {
    console.error(`Error: Company with ID ${companyId} not found in database.`);
    process.exit(1);
  }

  console.log(`Starting Manual Tally Sync for Company: ${company.name} (${company.id})`);
  console.log(`Date Range: ${fromDate} to ${toDate}`);

  try {
    const result = await syncTallyVouchers(company.id, fromDate, toDate);
    console.log('Manual sync completed successfully:', result);
  } catch (err) {
    console.error('Manual sync failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
