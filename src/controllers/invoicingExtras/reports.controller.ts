import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { serializeInvoice, serializeMoney } from '../../utils/invoice';

function dateWhere(fromDate?: string, toDate?: string) {
  return fromDate || toDate ? { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) } : undefined;
}

export const getOutstandingInvoices = async (req: Request, res: Response) => {
  try {
    const { customerId, fromDate, toDate, overdue, search } = req.query as any;
    const where: any = { status: 'SUBMITTED', outstandingAmount: { gt: 0 } };
    if (customerId) where.customerId = customerId;
    const date = dateWhere(fromDate, toDate);
    if (date) where.date = date;
    if (overdue === 'true') where.dueDate = { lt: new Date() };
    if (search) where.OR = [
      { invoiceNo: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
    const invoices = await prisma.salesInvoice.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const rows = invoices.map((invoice) => {
      const serialized = serializeInvoice(invoice);
      const dueDate = invoice.dueDate || invoice.date;
      return {
        ...serialized,
        daysOverdue: Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000)),
      };
    });
    const totals = rows.reduce((acc: any, invoice: any) => {
      acc.invoiceCount += 1;
      acc.grandTotal += Number(invoice.grandTotal || invoice.total || 0);
      acc.amountPaid += Number(invoice.amountPaid || 0);
      acc.outstandingAmount += Number(invoice.outstandingAmount || 0);
      acc.overdueOutstanding += invoice.daysOverdue > 0 ? Number(invoice.outstandingAmount || 0) : 0;
      return acc;
    }, { invoiceCount: 0, grandTotal: 0, amountPaid: 0, outstandingAmount: 0, overdueOutstanding: 0 });
    return success(res, { rows, totals });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getRevenueByCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId, fromDate, toDate } = req.query as any;
    const where: any = { status: 'SUBMITTED' };
    if (customerId) where.customerId = customerId;
    const date = dateWhere(fromDate, toDate);
    if (date) where.date = date;
    const invoices = await prisma.salesInvoice.findMany({ where, include: { customer: { select: { id: true, name: true } } } });
    const rows = new Map<string, any>();
    invoices.forEach((invoice) => {
      const key = invoice.customerId;
      const row = rows.get(key) || { customerId: key, customerName: invoice.customer?.name || 'Unknown', revenue: 0, subtotal: 0, taxAmount: 0, amountPaid: 0, outstandingAmount: 0, invoiceCount: 0, lastInvoiceDate: null };
      row.subtotal += serializeMoney(invoice.subtotal);
      row.taxAmount += serializeMoney(invoice.taxAmount);
      row.revenue += serializeMoney(invoice.grandTotal);
      row.amountPaid += serializeMoney(invoice.amountPaid);
      row.outstandingAmount += serializeMoney(invoice.outstandingAmount);
      row.invoiceCount += 1;
      row.lastInvoiceDate = !row.lastInvoiceDate || invoice.date > new Date(row.lastInvoiceDate) ? invoice.date : row.lastInvoiceDate;
      rows.set(key, row);
    });
    const data = Array.from(rows.values()).map((row) => ({ ...row, averageInvoiceValue: row.invoiceCount ? row.revenue / row.invoiceCount : 0 })).sort((a, b) => b.revenue - a.revenue);
    const totals = data.reduce((acc: any, row: any) => {
      acc.customerCount += 1;
      acc.invoiceCount += row.invoiceCount;
      acc.revenue += row.revenue;
      acc.amountPaid += row.amountPaid;
      acc.outstandingAmount += row.outstandingAmount;
      return acc;
    }, { customerCount: 0, invoiceCount: 0, revenue: 0, amountPaid: 0, outstandingAmount: 0 });
    return success(res, { rows: data, totals });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getRevenueByItem = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, customerId, search } = req.query as any;
    const invoiceWhere: any = { status: 'SUBMITTED' };
    if (customerId) invoiceWhere.customerId = customerId;
    const date = dateWhere(fromDate, toDate);
    if (date) invoiceWhere.date = date;
    const where: any = { salesInvoice: invoiceWhere };
    if (search) where.OR = [
      { itemCode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
      { product: { sku: { contains: search, mode: 'insensitive' } } },
    ];
    const items = await prisma.salesInvoiceItem.findMany({
      where,
      include: { product: { select: { sku: true, name: true } }, salesInvoice: { select: { id: true, customerId: true, status: true } } },
    });
    const rows = new Map<string, any>();
    items.forEach((item: any) => {
      const row = rows.get(item.productId) || { productId: item.productId, sku: item.product?.sku, name: item.product?.name, quantity: 0, netAmount: 0, taxAmount: 0, revenue: 0, invoiceCount: 0, customerCount: 0, _invoices: new Set(), _customers: new Set() };
      row.quantity += serializeMoney(item.quantity);
      row.netAmount += serializeMoney(item.netAmount);
      row.taxAmount += serializeMoney(item.taxAmount);
      row.revenue += serializeMoney(item.total);
      row._invoices.add(item.salesInvoice.id);
      row._customers.add(item.salesInvoice.customerId);
      rows.set(item.productId, row);
    });
    const data = Array.from(rows.values()).map((row) => {
      row.invoiceCount = row._invoices.size;
      row.customerCount = row._customers.size;
      delete row._invoices;
      delete row._customers;
      row.averageRate = row.quantity ? row.netAmount / row.quantity : 0;
      return row;
    }).sort((a, b) => b.revenue - a.revenue);
    const totals = data.reduce((acc: any, row: any) => {
      acc.itemCount += 1;
      acc.quantity += row.quantity;
      acc.netAmount += row.netAmount;
      acc.taxAmount += row.taxAmount;
      acc.revenue += row.revenue;
      return acc;
    }, { itemCount: 0, quantity: 0, netAmount: 0, taxAmount: 0, revenue: 0 });
    return success(res, { rows: data, totals });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getRevenueByPeriod = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, groupBy = 'month' } = req.query as any;
    const where: any = { status: 'SUBMITTED' };
    const date = dateWhere(fromDate, toDate);
    if (date) where.date = date;
    const invoices = await prisma.salesInvoice.findMany({ where, orderBy: { date: 'asc' } });
    const rows = new Map<string, any>();
    invoices.forEach((invoice) => {
      const dateValue = new Date(invoice.date);
      const year = dateValue.getFullYear();
      const month = dateValue.getMonth() + 1;
      const quarter = Math.floor(dateValue.getMonth() / 3) + 1;
      const key = groupBy === 'year' ? `${year}` : groupBy === 'quarter' ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2, '0')}`;
      const row = rows.get(key) || { period: key, invoiceCount: 0, subtotal: 0, taxAmount: 0, revenue: 0, amountPaid: 0, outstandingAmount: 0 };
      row.invoiceCount += 1;
      row.subtotal += serializeMoney(invoice.subtotal);
      row.taxAmount += serializeMoney(invoice.taxAmount);
      row.revenue += serializeMoney(invoice.grandTotal);
      row.amountPaid += serializeMoney(invoice.amountPaid);
      row.outstandingAmount += serializeMoney(invoice.outstandingAmount);
      rows.set(key, row);
    });
    const data = Array.from(rows.values());
    const totals = data.reduce((acc: any, row: any) => {
      acc.periodCount += 1;
      acc.invoiceCount += row.invoiceCount;
      acc.revenue += row.revenue;
      acc.amountPaid += row.amountPaid;
      acc.outstandingAmount += row.outstandingAmount;
      return acc;
    }, { periodCount: 0, invoiceCount: 0, revenue: 0, amountPaid: 0, outstandingAmount: 0 });
    return success(res, { rows: data, totals });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
