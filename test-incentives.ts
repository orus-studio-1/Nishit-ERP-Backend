import { getScheme, getSummary } from './src/controllers/incentives/incentives.controller';
import { prisma } from './src/lib/prisma';

const mockRes: any = {
  status: function(code: number) {
    this.statusCode = code;
    return this;
  },
  json: function(data: any) {
    console.log(`Status: ${this.statusCode}`, JSON.stringify(data, null, 2));
  }
};

const mockReq: any = {
  user: { companyId: 'cmu0y0cie0000xs97yc2266cn' }, // nishit-erp
  query: {},
  params: { id: 'cmu7bfxg700qk1o97ggahubqw' }
};

async function run() {
  console.log('Testing getScheme...');
  await getScheme(mockReq, mockRes);
  
  console.log('Testing getSummary...');
  await getSummary(mockReq, mockRes);
}

run().finally(() => prisma.$disconnect());
