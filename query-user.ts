import prisma from './src/lib/prisma'; async function main() { const u = await prisma.user.findUnique({ where: { email: 'yug2019raj@gmail.com' } }); console.log(JSON.stringify(u, null, 2)); } main();
