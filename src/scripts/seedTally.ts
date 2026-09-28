import prisma from '../../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding Tally Connection Data...');

  // Ensure a Tenant exists
  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Test Tenant',
        slug: 'test-tenant-' + Date.now(),
      }
    });
  }

  // Ensure a Company exists
  let company = await prisma.company.findFirst({
    where: { name: 'Test Tally Company' }
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        tenantId: tenant.id,
        name: 'Test Tally Company',
        slug: 'test-tally-' + Date.now(),
      }
    });
  }

  // Generate API key and Connection
  const plainTextSecret = 'super-secret-tally-key';
  const hashedSecret = await bcrypt.hash(plainTextSecret, 10);

  let connection = await prisma.tallyConnection.findFirst({
    where: { companyId: company.id }
  });

  if (!connection) {
    connection = await prisma.tallyConnection.create({
      data: {
        companyId: company.id,
        agentApiKeyHash: hashedSecret,
        tallyCompanyName: 'Test Tally Company',
        label: 'Local Dev Agent',
        isActive: true,
      }
    });
  } else {
    // Update it just in case
    connection = await prisma.tallyConnection.update({
      where: { id: connection.id },
      data: { agentApiKeyHash: hashedSecret }
    });
  }

  const apiKey = `${connection.id}.${plainTextSecret}`;

  console.log('--- SEED SUCCESS ---');
  console.log(`Company ID: ${company.id}`);
  console.log(`Connection ID: ${connection.id}`);
  console.log(`AGENT_API_KEY: ${apiKey}`);
  console.log('--------------------');
}

main().catch(console.error).finally(() => prisma.$disconnect());
