import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { apiStatusToWhere, invoiceInclude, invoiceResponse } from './shared';
import { AuthRequest } from '../../middleware/auth';

function userNameSearch(value: string) {
  return {
    OR: [
      { firstName: { contains: value, mode: 'insensitive' } },
      { lastName: { contains: value, mode: 'insensitive' } },
      { email: { contains: value, mode: 'insensitive' } },
    ],
  };
}

export const getInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const {
      status,
      customerId,
      search,
      fromDate,
      toDate,
      createdOn,
      overdue,
      assignedTo,
      assignedToId,
      assignedSearch,
      createdBy,
      createdById,
      createdSearch,
      createdPreset,
      tag,
      hasTags,
      savedFilter,
    } = req.query as any;
    const where: any = { ...apiStatusToWhere(status) };
    if (customerId) where.customerId = customerId;
    if (fromDate || toDate) where.date = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
    if (createdOn) {
      const start = new Date(createdOn);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.createdAt = { gte: start, lt: end };
    }
    if (overdue === 'true') where.paymentStatus = 'OVERDUE';
    if (assignedTo === 'me' && req.user?.id) where.assignedToId = req.user.id;
    if (assignedTo === 'unassigned') where.assignedToId = null;
    if (assignedToId) where.assignedToId = assignedToId;
    if (assignedSearch) where.assignedTo = userNameSearch(assignedSearch);
    if (createdBy === 'me' && req.user?.id) where.createdById = req.user.id;
    if (createdById) where.createdById = createdById;
    if (createdSearch) where.createdBy = userNameSearch(createdSearch);
    if (createdPreset === 'last7') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      where.createdAt = { ...(where.createdAt || {}), gte: start };
    }
    if (createdPreset === 'last30') {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      where.createdAt = { ...(where.createdAt || {}), gte: start };
    }
    if (tag) where.tags = { has: tag };
    if (hasTags === 'true') where.NOT = [...(where.NOT || []), { tags: { isEmpty: true } }];
    if (savedFilter === 'not_cancelled') where.status = { not: 'CANCELLED' };
    if (savedFilter === 'outstanding') where.outstandingAmount = { gt: 0 };
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { createdBy: userNameSearch(search) },
        { assignedTo: userNameSearch(search) },
        { tags: { has: search } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    return paginated(res, items.map(invoiceResponse), total, page, limit);
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const getInvoiceFilterOptions = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const [users, taggedInvoices] = await Promise.all([
      prisma.user.findMany({
        where: { ...(companyId ? { companyId } : {}), isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.salesInvoice.findMany({
        where: { NOT: { tags: { isEmpty: true } } },
        select: { tags: true },
        take: 500,
      }),
    ]);
    const tags = Array.from(new Set(taggedInvoices.flatMap(invoice => invoice.tags))).sort();
    return success(res, { users, tags });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getInvoice = async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.salesInvoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
    if (!invoice) return error(res, 'Invoice not found', 404);
    return success(res, invoiceResponse(invoice));
  } catch (err: any) {
    if (!err.code && err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
