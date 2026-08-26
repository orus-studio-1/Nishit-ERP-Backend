import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { success } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { serializeInvoice, serializeMoney } from '../utils/invoice';
import { AuthRequest } from '../middleware/auth';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const companyId = (req as AuthRequest).user?.companyId || null;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [
      totalRevenue,
      monthRevenue,
      totalExpenses,
      pendingInvoicesData,
      overdueInvoicesData,
      activeCustomers,
      activeEmployees,
      openLeads,
      pendingTasks,
      lowStockProducts,
      recentInvoices,
      recentLeads,
      recentActivities,
      invoiceStatusCounts,
      leadStatusCounts,
      opportunities,
      paidInvoicesYear,
      monthlyRevenue,
    ] = await Promise.all([
      prisma.salesInvoice.aggregate({
        where: { status: 'SUBMITTED', paymentStatus: 'PAID' },
        _sum: { total: true },
      }),
      prisma.salesInvoice.aggregate({
        where: { status: 'SUBMITTED', paymentStatus: 'PAID', date: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      prisma.purchaseInvoice.aggregate({
        where: { status: 'PAID' },
        _sum: { total: true },
      }),
      prisma.salesInvoice.aggregate({
        where: { status: 'SUBMITTED', paymentStatus: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
        _sum: { outstandingAmount: true },
        _count: true,
      }),
      prisma.salesInvoice.aggregate({
        where: { status: 'SUBMITTED', paymentStatus: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }, dueDate: { lt: now } },
        _sum: { outstandingAmount: true },
        _count: true,
      }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.lead.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } }),
      prisma.task.count({ where: { status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      prisma.product.findMany({
        where: { isActive: true },
        include: { stockLevels: true },
        take: 50,
      }),
      prisma.salesInvoice.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } } },
      }),
      prisma.lead.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, firstName: true, lastName: true, company: true, status: true, source: true, createdAt: true },
      }),
      prisma.activity.findMany({
        where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { lte: endOfToday } },
        include: {
          lead: { select: { id: true, title: true } },
          opportunity: { select: { id: true, title: true } },
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 8,
      }),
      prisma.salesInvoice.groupBy({ by: ['status', 'paymentStatus'], _count: { id: true }, _sum: { grandTotal: true, outstandingAmount: true } }),
      prisma.lead.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.opportunity.findMany({ select: { stage: true, value: true, probability: true } }),
      prisma.salesInvoice.findMany({
        where: { status: 'SUBMITTED', paymentStatus: 'PAID', date: { gte: startOfYear } },
        select: { customerId: true, grandTotal: true, customer: { select: { name: true } } },
      }),
      prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', "date") as month,
          SUM("grandTotal") as revenue
        FROM "SalesInvoice"
        WHERE status = 'SUBMITTED'
          AND "paymentStatus" = 'PAID'
          AND "date" >= ${startOfYear}
          AND (${companyId}::text IS NULL OR "companyId" = ${companyId})
        GROUP BY DATE_TRUNC('month', "date")
        ORDER BY month ASC
      `,
    ]);

    const lowStock = lowStockProducts.filter(p => {
      const totalQty = p.stockLevels.reduce((sum, sl) => sum + Number(sl.quantity), 0);
      return totalQty <= Number(p.minStockLevel);
    }).slice(0, 10);

    const pipeline = opportunities.reduce((acc: any, opportunity) => {
      const row = acc[opportunity.stage] || { count: 0, value: 0, weightedValue: 0 };
      row.count += 1;
      row.value += Number(opportunity.value || 0);
      row.weightedValue += Number(opportunity.value || 0) * (Number(opportunity.probability || 0) / 100);
      acc[opportunity.stage] = row;
      return acc;
    }, {});
    const topCustomers = Array.from(paidInvoicesYear.reduce((map: Map<string, any>, invoice) => {
      const row = map.get(invoice.customerId) || { customerId: invoice.customerId, customerName: invoice.customer?.name || 'Unknown', revenue: 0, invoiceCount: 0 };
      row.revenue += serializeMoney(invoice.grandTotal);
      row.invoiceCount += 1;
      map.set(invoice.customerId, row);
      return map;
    }, new Map()).values()).sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 8);
    const invoiceStatus = invoiceStatusCounts.map((row) => ({
      status: row.status === 'SUBMITTED' ? (row.paymentStatus === 'UNPAID' ? 'SENT' : row.paymentStatus) : row.status,
      count: row._count.id,
      total: serializeMoney(row._sum.grandTotal),
      outstanding: serializeMoney(row._sum.outstandingAmount),
    }));

    return success(res, {
      revenue: {
        total: serializeMoney(totalRevenue._sum.total),
        thisMonth: serializeMoney(monthRevenue._sum.total),
      },
      expenses: {
        total: Number(totalExpenses._sum.total || 0),
      },
      pendingInvoices: {
        count: pendingInvoicesData._count,
        amount: serializeMoney(pendingInvoicesData._sum.outstandingAmount),
      },
      overdueInvoices: {
        count: overdueInvoicesData._count,
        amount: serializeMoney(overdueInvoicesData._sum.outstandingAmount),
      },
      activeCustomers,
      activeEmployees,
      openLeads,
      pendingTasks,
      pipeline: {
        stages: pipeline,
        openValue: Object.entries(pipeline).filter(([stage]) => !['CLOSED_WON', 'CLOSED_LOST'].includes(stage)).reduce((sum, [, row]: any) => sum + row.value, 0),
        weightedValue: Object.entries(pipeline).filter(([stage]) => !['CLOSED_WON', 'CLOSED_LOST'].includes(stage)).reduce((sum, [, row]: any) => sum + row.weightedValue, 0),
      },
      lowStock: lowStock.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        currentStock: p.stockLevels.reduce((sum, sl) => sum + Number(sl.quantity), 0),
        minStockLevel: Number(p.minStockLevel),
      })),
      recentInvoices: recentInvoices.map((invoice: any) => {
        const serialized = serializeInvoice(invoice);
        if (serialized.status === 'SUBMITTED') serialized.status = serialized.paymentStatus === 'UNPAID' ? 'SENT' : serialized.paymentStatus;
        return serialized;
      }),
      recentLeads,
      recentActivities,
      invoiceStatus,
      leadStatus: leadStatusCounts.map((row) => ({ status: row.status, count: row._count.id })),
      topCustomers,
      monthlyRevenue,
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
