import { 
  MovementType, 
  SerialNumberStatus
} from '@prisma/client';
import { prisma } from '../lib/prisma';

async function main() {
  console.log('Starting Inventory demo data seed...');

  // Fetch existing company and tenant to associate data
  const company = await prisma.company.findUnique({
    where: { slug: 'acme-corp' }
  });
  
  if (!company) {
    throw new Error('Company not found. Please run the main seed script first.');
  }

  // 1. Categories
  const categories = [
    { name: 'Raw Materials', code: 'RAW', description: 'Raw materials for production' },
    { name: 'Finished Goods', code: 'FIN', description: 'Finished products ready for sale' },
    { name: 'Consumables', code: 'CON', description: 'Consumable items for office and factory' },
    { name: 'Electronics', code: 'ELEC', description: 'Electronic components' },
    { name: 'Packaging', code: 'PKG', description: 'Packaging materials' }
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { companyId_code: { companyId: company.id, code: cat.code } },
      update: {},
      create: { ...cat, companyId: company.id }
    });
  }
  console.log('✅ Categories created');

  // Fetch a category to use
  const rawCat = await prisma.category.findUnique({ where: { companyId_code: { companyId: company.id, code: 'RAW' } } });
  const finCat = await prisma.category.findUnique({ where: { companyId_code: { companyId: company.id, code: 'FIN' } } });

  // 2. Units
  const units = [
    { name: 'Numbers', symbol: 'NOS' },
    { name: 'Kilograms', symbol: 'KG' },
    { name: 'Liters', symbol: 'LTR' },
    { name: 'Boxes', symbol: 'BOX' },
    { name: 'Pieces', symbol: 'PCS' }
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { companyId_name: { companyId: company.id, name: unit.name } },
      update: {},
      create: { ...unit, companyId: company.id }
    });
  }
  console.log('✅ Units created');

  const nosUnit = await prisma.unit.findUnique({ where: { companyId_name: { companyId: company.id, name: 'Numbers' } } });
  const kgUnit = await prisma.unit.findUnique({ where: { companyId_name: { companyId: company.id, name: 'Kilograms' } } });

  // 3. Warehouses
  const warehouses = [
    { name: 'Raw Material Store', code: 'WH-RAW' },
    { name: 'Finished Goods Store', code: 'WH-FIN' },
    { name: 'Scrap Warehouse', code: 'WH-SCRAP' }
  ];

  for (const wh of warehouses) {
    await prisma.warehouse.upsert({
      where: { companyId_code: { companyId: company.id, code: wh.code } },
      update: {},
      create: { ...wh, companyId: company.id, tenantId: company.tenantId }
    });
  }
  console.log('✅ Warehouses created');

  const whRaw = await prisma.warehouse.findUnique({ where: { companyId_code: { companyId: company.id, code: 'WH-RAW' } } });
  const whFin = await prisma.warehouse.findUnique({ where: { companyId_code: { companyId: company.id, code: 'WH-FIN' } } });

  // 4. Products
  const products = [
    { sku: 'STEEL-001', name: 'Stainless Steel Sheet', catId: rawCat!.id, unitId: kgUnit!.id, minStock: 500, cost: 120, sale: 150, hasBatch: true, hasSerial: false },
    { sku: 'ALUM-001', name: 'Aluminum Ingot', catId: rawCat!.id, unitId: kgUnit!.id, minStock: 200, cost: 250, sale: 300, hasBatch: true, hasSerial: false },
    { sku: 'MOTOR-001', name: 'Industrial Motor 5HP', catId: finCat!.id, unitId: nosUnit!.id, minStock: 20, cost: 15000, sale: 22000, hasBatch: false, hasSerial: true },
    { sku: 'PUMP-001', name: 'Water Pump', catId: finCat!.id, unitId: nosUnit!.id, minStock: 30, cost: 5000, sale: 8500, hasBatch: true, hasSerial: true },
    { sku: 'WIFI-ROUTER', name: 'Enterprise Wi-Fi Router', catId: finCat!.id, unitId: nosUnit!.id, minStock: 15, cost: 8000, sale: 12000, hasBatch: false, hasSerial: true }
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { companyId_sku: { companyId: company.id, sku: p.sku } },
      update: {},
      create: {
        companyId: company.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.catId,
        unitId: p.unitId,
        minStockLevel: p.minStock,
        costPrice: p.cost,
        salePrice: p.sale,
        hasBatchNo: p.hasBatch,
        hasSerialNo: p.hasSerial
      }
    });
  }
  console.log('✅ Products created');

  // Fetch the created products
  const motor = await prisma.product.findUnique({ where: { companyId_sku: { companyId: company.id, sku: 'MOTOR-001' } } });
  const steel = await prisma.product.findUnique({ where: { companyId_sku: { companyId: company.id, sku: 'STEEL-001' } } });
  const pump = await prisma.product.findUnique({ where: { companyId_sku: { companyId: company.id, sku: 'PUMP-001' } } });

  // 5. Stock Levels
  // We will set one product to have stock below minimum to trigger "Low Stock" warning
  const stockData = [
    { prodId: motor!.id, whId: whFin!.id, qty: 10 }, // Below minStock of 20
    { prodId: steel!.id, whId: whRaw!.id, qty: 1000 },
    { prodId: pump!.id, whId: whFin!.id, qty: 50 }
  ];

  for (const st of stockData) {
    const existing = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: st.prodId, warehouseId: st.whId } }
    });
    if (!existing) {
      await prisma.stockLevel.create({
        data: {
          companyId: company.id,
          productId: st.prodId,
          warehouseId: st.whId,
          quantity: st.qty
        }
      });
    } else {
      await prisma.stockLevel.update({
        where: { productId_warehouseId: { productId: st.prodId, warehouseId: st.whId } },
        data: { quantity: st.qty }
      });
    }
  }
  console.log('✅ Stock Levels created');

  // 6. Batches & Serial Numbers
  const batch1 = await prisma.batch.upsert({
    where: { companyId_batchNo_warehouseId: { companyId: company.id, batchNo: 'BATCH-STL-01', warehouseId: whRaw!.id } },
    update: {},
    create: {
      companyId: company.id,
      batchNo: 'BATCH-STL-01',
      productId: steel!.id,
      warehouseId: whRaw!.id,
      quantity: 1000,
      manufacturingDate: new Date()
    }
  });

  const serials = ['MTR-SN-001', 'MTR-SN-002', 'MTR-SN-003', 'MTR-SN-004', 'MTR-SN-005'];
  for (const sn of serials) {
    await prisma.serialNumber.upsert({
      where: { companyId_serialNo: { companyId: company.id, serialNo: sn } },
      update: {},
      create: {
        companyId: company.id,
        serialNo: sn,
        productId: motor!.id,
        warehouseId: whFin!.id,
        status: SerialNumberStatus.AVAILABLE
      }
    });
  }
  console.log('✅ Batches and Serial Numbers created');

  // 7. Stock Movements
  await prisma.stockMovement.create({
    data: {
      companyId: company.id,
      productId: steel!.id,
      warehouseId: whRaw!.id,
      type: MovementType.IN,
      quantity: 1000,
      notes: 'Initial opening stock entry',
    }
  });

  await prisma.stockMovement.create({
    data: {
      companyId: company.id,
      productId: motor!.id,
      warehouseId: whFin!.id,
      type: MovementType.IN,
      quantity: 10,
      notes: 'Initial opening stock entry',
    }
  });
  console.log('✅ Stock Movements created');

  console.log('Inventory demo data seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during inventory seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
