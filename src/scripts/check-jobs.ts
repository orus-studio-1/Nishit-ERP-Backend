import prisma from '../lib/prisma';

async function main() {
  const activeJobs = await prisma.tallySyncJob.findMany({
    where: {
      status: {
        in: ['PENDING', 'CLAIMED', 'PROCESSING']
      }
    }
  });
  
  console.log(`Found ${activeJobs.length} active jobs.`);
  console.log(JSON.stringify(activeJobs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
