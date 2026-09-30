import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';
import { calculateOpportunityItems, logCrmActivity, opportunityInclude } from './shared';
import { generateCustomerNo, generateOrderNo, generateQuotationNo } from '../../utils/generate';
import { Prisma } from '@prisma/client';
import { crmScopeWhere } from './scope';
import { respondPaginated } from '../../utils/pagination';

export const getOpportunities = async (req: Request, res: Response) => {
  try {
    const { stage, search, view } = req.query as any;
    const where: any = await crmScopeWhere(req as AuthRequest, 'OPPORTUNITY');
    if (stage) where.stage = stage;
    if (search) where.title = { contains: search, mode: 'insensitive' };
    if (view === 'open') where.stage = { notIn: ['CLOSED_WON', 'CLOSED_LOST'] };

    return respondPaginated(res, prisma.opportunity, req, { where, include: opportunityInclude, orderBy: { createdAt: 'desc' } });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createOpportunity = async (req: Request, res: Response) => {
  try {
    const { items = [], ...body } = req.body;
    const calculated = calculateOpportunityItems(items);
    const opp = await prisma.opportunity.create({
      data: {
        ...body,
        companyId: (req as AuthRequest).user?.companyId,
        branchId: (req as AuthRequest).user?.branchId,
        ownerId: body.ownerId || (req as AuthRequest).user?.id,
        value: Number(body.value ?? calculated.total ?? 0),
        probability: Number(body.probability ?? 0),
        expectedClose: body.expectedClose ? new Date(body.expectedClose) : undefined,
        items: calculated.lines.length ? { create: calculated.lines } : undefined,
      },
      include: opportunityInclude,
    });
    return success(res, opp, 'Opportunity created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateOpportunity = async (req: AuthRequest, res: Response) => {
  try {
    const { items, ...body } = req.body;
    const opp = await prisma.$transaction(async (tx) => {
      const existing = await tx.opportunity.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req, 'OPPORTUNITY')) } });
      if (!existing) throw new Error('Opportunity not found');
      const data: any = {
        ...body,
        ...(body.probability !== undefined ? { probability: Number(body.probability) } : {}),
        ...(body.expectedClose ? { expectedClose: new Date(body.expectedClose) } : {}),
      };
      if (body.stage === 'CLOSED_WON' && existing.stage !== 'CLOSED_WON') {
        data.wonAt = new Date();
        data.erpSyncStatus = 'QUEUED';
      }
      if (body.stage === 'CLOSED_LOST' && existing.stage !== 'CLOSED_LOST') data.lostAt = new Date();
      if (body.stage === 'CLOSED_LOST' && existing.stage !== 'CLOSED_LOST') {
        const reason = await tx.crmLostReason.findFirst({ where: { id: body.lostReasonId, companyId: req.user?.companyId, isActive: true, appliesTo: { in: ['OPPORTUNITY', 'BOTH'] } } });
        if (!reason) throw new Error('A valid loss reason is required');
        data.lostReasonId = reason.id;
        data.lostReason = reason.name;
      }
      if (items) {
        const calculated = calculateOpportunityItems(items);
        data.value = Number(body.value ?? calculated.total);
        await tx.opportunityItem.deleteMany({ where: { opportunityId: existing.id } });
        data.items = { create: calculated.lines };
      }
      const updated = await tx.opportunity.update({ where: { id: existing.id }, data, include: opportunityInclude });
      if (body.stage && body.stage !== existing.stage) {
        await logCrmActivity(tx, req.user!.id, {
          type: 'STATUS_CHANGE',
          subject: `Opportunity moved to ${body.stage}`,
          description: `${existing.stage} → ${body.stage}`,
          opportunityId: existing.id,
          metadata: { before: existing.stage, after: body.stage },
        });
      }
      return updated;
    });
    return success(res, opp, 'Opportunity updated');
  } catch (err: any) {
    if (err.message === 'Opportunity not found') return error(res, err.message, 404);
    if (err.message === 'A valid loss reason is required') return error(res, err.message, 422);
    return handlePrismaError(res, err);
  }
};

export const deleteOpportunity = async (req: Request, res: Response) => {
  try {
    const deleted = await prisma.opportunity.deleteMany({ where: { id: req.params.id, ...(await crmScopeWhere(req as AuthRequest, 'OPPORTUNITY')) } });
    if (!deleted.count) return error(res, 'Opportunity not found', 404);
    return success(res, null, 'Opportunity deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getOpportunity = async (req: Request, res: Response) => {
  try {
    const opp = await prisma.opportunity.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req as AuthRequest, 'OPPORTUNITY')) }, include: opportunityInclude });
    if (!opp) return error(res, 'Opportunity not found', 404);
    return success(res, opp);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getPipeline = async (req: Request, res: Response) => {
  try {
    const opportunities = await prisma.opportunity.findMany({ where: await crmScopeWhere(req as AuthRequest, 'OPPORTUNITY'), include: opportunityInclude, orderBy: { updatedAt: 'desc' } });
    const stages = ['PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
    const columns = stages.map((stage) => {
      const items = opportunities.filter((opp) => opp.stage === stage);
      return { stage, totalValue: items.reduce((sum, item) => sum + Number(item.value || 0), 0), count: items.length, items };
    });
    return success(res, columns);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

async function productForOpportunityItem(tx: any, item: any) {
  if (item.productId) return item.productId;
  const sku = item.itemCode || `CRM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = await tx.product.findFirst({ where: { sku } });
  if (existing) return existing.id;
  const product = await tx.product.create({
    data: {
      sku,
      name: item.description || sku,
      description: item.description,
      type: 'SERVICE',
      salePrice: item.rate || 0,
      taxRate: item.taxRate || 0,
      isActive: true,
    },
  });
  return product.id;
}

export const createOpportunityErpDocs = async (req: AuthRequest, res: Response) => {
  try {
    const createSalesOrder = req.body.createSalesOrder === true;
    const result = await prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findFirst({
        where: { id: req.params.id, ...(await crmScopeWhere(req, 'OPPORTUNITY')) },
        include: { organization: true, contact: true, lead: true, items: true, customer: true, quotation: true, salesOrder: true },
      });
      if (!opportunity) throw new Error('Opportunity not found');
      if (createSalesOrder && opportunity.stage !== 'CLOSED_WON') throw new Error('Only closed-won opportunities can create a sales order');

      let customer: any = opportunity.customer;
      if (!customer) {
        const email = opportunity.contact?.email || opportunity.lead?.email || opportunity.organization?.email;
        customer = email ? await tx.customer.findFirst({ where: { email } }) : null;
      }
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            customerNo: await generateCustomerNo(),
            name: opportunity.organization?.name || `${opportunity.contact?.firstName || opportunity.lead?.firstName || 'CRM'} ${opportunity.contact?.lastName || opportunity.lead?.lastName || 'Customer'}`.trim(),
            email: opportunity.contact?.email || opportunity.lead?.email || opportunity.organization?.email,
            phone: opportunity.contact?.phone || opportunity.lead?.phone || opportunity.organization?.phone,
            contactId: opportunity.contactId,
            address: opportunity.organization?.address,
            city: opportunity.organization?.city,
            state: opportunity.organization?.state,
            country: opportunity.organization?.country,
            zip: opportunity.organization?.zip,
            currency: opportunity.currency,
            notes: `Created from CRM opportunity ${opportunity.title}`,
          },
        });
      }

      const sourceItems = opportunity.items.length ? opportunity.items : [{
        description: opportunity.title,
        quantity: new Prisma.Decimal(1),
        rate: new Prisma.Decimal(opportunity.value || 0),
        discount: new Prisma.Decimal(0),
        taxRate: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(opportunity.value || 0),
      }];
      const quotationItems = [];
      let subtotal = new Prisma.Decimal(0);
      let taxAmount = new Prisma.Decimal(0);
      for (const item of sourceItems) {
        const productId = await productForOpportunityItem(tx, item);
        const quantity = new Prisma.Decimal(item.quantity || 1);
        const unitPrice = new Prisma.Decimal(item.rate || 0);
        const discount = new Prisma.Decimal(item.discount || 0);
        const taxRate = new Prisma.Decimal(item.taxRate || 0);
        const net = quantity.mul(unitPrice).mul(new Prisma.Decimal(1).minus(discount.div(100)));
        const tax = net.mul(taxRate.div(100));
        subtotal = subtotal.plus(net);
        taxAmount = taxAmount.plus(tax);
        quotationItems.push({ productId, description: item.description, quantity, unitPrice, taxRate, discount, total: net.plus(tax) });
      }
      const total = subtotal.plus(taxAmount);

      const quotation: any = opportunity.quotation || await tx.quotation.create({
        data: {
          quotationNo: await generateQuotationNo(),
          customerId: customer.id,
          date: new Date(),
          status: 'DRAFT',
          subtotal,
          taxAmount,
          total,
          discount: new Prisma.Decimal(0),
          currency: opportunity.currency,
          notes: `Created from CRM opportunity ${opportunity.title}`,
          items: { create: quotationItems },
        },
        include: { items: true },
      });

      let salesOrder: any = opportunity.salesOrder;
      if (createSalesOrder && !salesOrder) {
        salesOrder = await tx.salesOrder.create({
          data: {
            orderNo: await generateOrderNo(),
            customerId: customer.id,
            quotationId: quotation.id,
            date: new Date(),
            status: 'DRAFT',
            subtotal,
            taxAmount,
            total,
            discount: new Prisma.Decimal(0),
            currency: opportunity.currency,
            notes: `Created from CRM opportunity ${opportunity.title}`,
            items: { create: quotationItems },
          },
        });
      }

      const updated = await tx.opportunity.update({
        where: { id: opportunity.id },
        data: {
          customerId: customer.id,
          quotationId: quotation.id,
          salesOrderId: salesOrder?.id,
          erpSyncStatus: 'SYNCED',
          erpSyncError: null,
        },
        include: opportunityInclude,
      });
      await logCrmActivity(tx, req.user!.id, {
        type: 'CONVERSION',
        subject: 'ERP documents created',
        description: `${customer.customerNo} and ${quotation.quotationNo}${salesOrder ? ` / ${salesOrder.orderNo}` : ''} linked`,
        organizationId: opportunity.organizationId,
        contactId: opportunity.contactId,
        opportunityId: opportunity.id,
        metadata: { customerId: customer.id, quotationId: quotation.id, salesOrderId: salesOrder?.id },
      });
      return updated;
    }, { timeout: 60000 });
    return success(res, result, 'ERP documents created');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
