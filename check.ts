import prisma from './src/lib/prisma';
async function main() { 
  const schemeId = 'cmu8ffw2g00qsv897jrpydng9'; // S1 id
  const rows = await prisma.incentiveContribution.groupBy({ by: ['lifecycleStatus'], where: { schemeId }, _count: { _all: true } }); 
  console.log('groupBy with where', rows); 
  const count = await prisma.incentiveContribution.count({ where: { schemeId } });
  console.log('count', count);
  const rows2 = await prisma.$queryRaw`SELECT "lifecycleStatus", COUNT(*) FROM "IncentiveContribution" WHERE "schemeId" = ${schemeId} GROUP BY "lifecycleStatus"`;
  console.log('queryRaw', rows2);
} 
main().finally(() => prisma.$disconnect());
