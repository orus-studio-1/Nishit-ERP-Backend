import { prisma } from './src/lib/prisma';

async function main() {
  try {
    const connection = await prisma.tallyConnection.findFirst({
      where: { companyId: 'some-company', isActive: true },
    });
    console.log('tallyConnection:', connection);
  } catch (e) {
    console.error('Error fetching tallyConnection:', e);
  }

  try {
    const jobs = await prisma.tallySyncJob.findMany({
      where: { companyId: 'some-company' },
    });
    console.log('tallySyncJobs count:', jobs.length);
  } catch (e) {
    console.error('Error fetching tallySyncJobs:', e);
  }
}

main().finally(() => process.exit(0));
