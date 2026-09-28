import prisma from './src/lib/prisma'; async function main() { const conns = await prisma.tallyConnection.findMany(); console.log(JSON.stringify(conns, null, 2)); } main();
