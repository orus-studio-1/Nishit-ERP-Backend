import { 
  UserRole, AccountType, DocumentStatus, InvoicePaymentStatus, 
  OpportunityStage, LeadStatus, EmployeeStatus 
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function main() {
  console.log('Starting extensive demo data seed...');

  // 1. Tenant & Company
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default-tenant' },
    update: {},
    create: {
      name: 'Default Tenant',
      slug: 'default-tenant',
      plan: 'ACTIVE',
      baseCurrency: 'INR',
    },
  });

  const company = await prisma.company.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Acme Corporation',
      slug: 'acme-corp',
      fiscalYearStart: 4,
      currency: 'INR',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { tenantId_companyId_code: { tenantId: tenant.id, companyId: company.id, code: 'HQ-01' } },
    update: {},
    create: { tenantId: tenant.id, companyId: company.id, code: 'HQ-01', name: 'Headquarters' }
  });

  // 2. Admin User
  const hashedPassword = await bcrypt.hash('password123', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: {
      email: 'admin@acme.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.SUPER_ADMIN,
      companyId: company.id,
    },
  });

  // 3. Departments & Employees
  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SALES' } },
    update: {},
    create: { companyId: company.id, name: 'Sales', code: 'SALES' }
  });

  for (let i = 1; i <= 5; i++) {
    const userEmail = `emp${i}@acme.com`;
    const user = await prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: {
        email: userEmail,
        password: hashedPassword,
        firstName: `Employee`,
        lastName: `${i}`,
        companyId: company.id,
      }
    });

    await prisma.employee.upsert({
      where: { employeeId: `EMP-00${i}` },
      update: {},
      create: {
        employeeId: `EMP-00${i}`,
        userId: user.id,
        departmentId: department.id,
        hireDate: new Date(),
        salary: 50000 + (i * 5000),
        status: EmployeeStatus.ACTIVE,
      }
    });
  }
  console.log('✅ HR & Employees created');

  // 4. Customers
  const customers = [];
  for (let i = 1; i <= 5; i++) {
    const cust = await prisma.customer.upsert({
      where: { customerNo: `CUST-00${i}` },
      update: {},
      create: {
        companyId: company.id,
        customerNo: `CUST-00${i}`,
        name: `Tech Innovators ${i}`,
        email: `contact@techinnovators${i}.com`,
      }
    });
    customers.push(cust);
  }
  console.log('✅ Customers created');

  // 5. Products, Warehouse & Low Stock
  const warehouse = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: company.id, code: 'WH-MAIN' } },
    update: {},
    create: { companyId: company.id, name: 'Main Warehouse', code: 'WH-MAIN', tenantId: tenant.id }
  });

  const products = [];
  for (let i = 1; i <= 3; i++) {
    const prod = await prisma.product.upsert({
      where: { companyId_sku: { companyId: company.id, sku: `PROD-00${i}` } },
      update: {},
      create: {
        companyId: company.id,
        sku: `PROD-00${i}`,
        name: `Enterprise Software License ${i}`,
        minStockLevel: 50, // Minimum stock for alerts
        costPrice: 10000,
        salePrice: 25000,
      }
    });
    products.push(prod);

    // Create low stock for the first product, normal stock for others
    const qty = i === 1 ? 10 : 100;
    
    // Check if StockLevel exists
    const existingStock = await prisma.stockLevel.findUnique({
        where: { productId_warehouseId: { productId: prod.id, warehouseId: warehouse.id } }
    });

    if (!existingStock) {
        await prisma.stockLevel.create({
        data: {
            companyId: company.id,
            productId: prod.id,
            warehouseId: warehouse.id,
            quantity: qty,
        }
        });
    }
  }
  console.log('✅ Products & Stock created (including Low Stock)');

  // 6. CRM Leads & Opportunities
  for (let i = 1; i <= 5; i++) {
    await prisma.lead.create({
      data: {
        companyId: company.id,
        title: `Lead for Expansion ${i}`,
        firstName: `John`,
        lastName: `Doe ${i}`,
        email: `john.doe${i}@example.com`,
        status: i % 2 === 0 ? LeadStatus.NEW : LeadStatus.CONTACTED,
        createdById: adminUser.id,
      }
    });
  }
  
  for (let i = 1; i <= 3; i++) {
    await prisma.opportunity.create({
      data: {
        companyId: company.id,
        title: `Deal with ${customers[i].name}`,
        customerId: customers[i].id,
        value: 150000 * i,
        stage: i === 1 ? OpportunityStage.PROSPECTING : OpportunityStage.PROPOSAL,
      }
    });
  }
  console.log('✅ CRM Pipeline & Leads created');

  // 7. Sales Invoices (Revenue, Receivables, Overdue)
  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - 10);
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 10);

  // PAID Invoice (contributes to Revenue)
  await prisma.salesInvoice.upsert({
    where: { invoiceNo: 'INV-PAID-01' },
    update: {},
    create: {
      companyId: company.id,
      invoiceNo: 'INV-PAID-01',
      customerId: customers[0].id,
      date: pastDate,
      dueDate: futureDate,
      status: DocumentStatus.SUBMITTED,
      paymentStatus: InvoicePaymentStatus.PAID,
      total: 500000,
      grandTotal: 500000,
      outstandingAmount: 0,
      amountPaid: 500000,
    }
  });

  // UNPAID Future Invoice (contributes to Receivables)
  await prisma.salesInvoice.upsert({
    where: { invoiceNo: 'INV-REC-01' },
    update: {},
    create: {
      companyId: company.id,
      invoiceNo: 'INV-REC-01',
      customerId: customers[1].id,
      date: today,
      dueDate: futureDate,
      status: DocumentStatus.SUBMITTED,
      paymentStatus: InvoicePaymentStatus.UNPAID,
      total: 250000,
      grandTotal: 250000,
      outstandingAmount: 250000,
      amountPaid: 0,
    }
  });

  // UNPAID Past Invoice (contributes to Overdue & Receivables)
  await prisma.salesInvoice.upsert({
    where: { invoiceNo: 'INV-OVER-01' },
    update: {},
    create: {
      companyId: company.id,
      invoiceNo: 'INV-OVER-01',
      customerId: customers[2].id,
      date: pastDate,
      dueDate: pastDate, // Overdue
      status: DocumentStatus.SUBMITTED,
      paymentStatus: InvoicePaymentStatus.OVERDUE,
      total: 100000,
      grandTotal: 100000,
      outstandingAmount: 100000,
      amountPaid: 0,
    }
  });
  console.log('✅ Sales Invoices created (Revenue, Receivables, Overdue)');

  console.log('Extensive demo seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
