import { getConnectionStatus, getSyncJobs, getSyncJobById } from './src/controllers/tally.controller';
import { prisma } from './src/lib/prisma';

const mockRes: any = {
  status: function(code: number) {
    this.statusCode = code;
    return this;
  },
  json: function(data: any) {
    console.log(`Status: ${this.statusCode}`, data);
  }
};

const mockReq: any = {
  user: { companyId: 'dummy-company-id' },
  query: {},
  params: { id: 'dummy-id' }
};

async function run() {
  console.log('Testing getConnectionStatus...');
  await getConnectionStatus(mockReq, mockRes);
  
  console.log('\nTesting getSyncJobs...');
  await getSyncJobs(mockReq, mockRes);
  
  console.log('\nTesting getSyncJobById...');
  await getSyncJobById(mockReq, mockRes);
}

run().finally(() => prisma.$disconnect());
