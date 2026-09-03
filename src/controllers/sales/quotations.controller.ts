import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateOrderNo, generateQuotationNo } from '../../utils/generate';
import { normalizeSalesItems } from './shared';
import { determineSalesTax } from '../../services/sales/tax.service';
import { quotationDefaults, quotationGrandTotal } from '../../services/sales/quotation-profile.service';

export const getQuotations = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { status, customerId, search } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) where.quotationNo = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true, email: true } }, items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.quotation.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getQuotation = async (req: Request, res: Response) => {
  try {
    const q = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: { include: { product: true } } },
    });
    if (!q) return error(res, 'Quotation not found', 404);
    return success(res, q);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getQuotationArtifact = async (req: Request, res: Response) => {
  try {
    const artifact = await prisma.quotationArtifact.findUnique({ where: { quotationId: req.params.id } });
    if (!artifact) return error(res, 'The immutable PDF has not been generated yet', 404);
    res.setHeader('Content-Type', artifact.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${artifact.fileName.replace(/["\r\n]/g, '')}"`);
    res.setHeader('X-Content-Checksum-SHA256', artifact.checksum);
    return res.send(Buffer.from(artifact.content));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createQuotation = async (req: Request, res: Response) => {
  try {
    const { customerId, date, validUntil, items = [], notes, discount } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    if (!items.length) return error(res, 'At least one quotation item is required', 400);

    const quotation = await prisma.$transaction(async (tx) => {
      const quotationNo = `DRAFT-QTN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error('Customer not found');
      const requestCompanyId = (req as any).user?.companyId || customer.companyId;
      const company = requestCompanyId ? await tx.company.findUnique({ where: { id: requestCompanyId } }) : null;
      const defaults = quotationDefaults(company);
      const supplier = req.body.branchId ? await tx.branch.findUnique({ where: { id: req.body.branchId } }) : customer.companyId ? await tx.company.findUnique({ where: { id: customer.companyId } }) : null;
      const tax = determineSalesTax({ supplierGstin: supplier?.gstin, customerGstin: customer.taxId, customerCountry: customer.country, isSez: Boolean(req.body.isSez), isExport: Boolean(req.body.isExport) });
      const calculated = await normalizeSalesItems(tx, items, { customerId, currency: 'INR', priceListId: req.body.priceListId, customerGroup: customer.customerGroup || undefined, territory: req.body.territory || customer.territory || undefined, salesChannel: req.body.salesChannel || customer.salesChannel || undefined });
      const discountAmount = new Prisma.Decimal(discount || 0);
      const deliveryCharges = new Prisma.Decimal(req.body.deliveryCharges || 0);
      const total = quotationGrandTotal(calculated.subtotal, calculated.taxAmount, discountAmount, deliveryCharges);
      return tx.quotation.create({
        data: {
          quotationNo,
          companyId: requestCompanyId,
          customerId,
          customerNameSnapshot: req.body.customerNameSnapshot || customer.name,
          date: date ? new Date(date) : new Date(),
          validUntil: validUntil ? new Date(validUntil) : undefined,
          subtotal: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          total,
          discount: discountAmount,
          currency: 'INR',
          notes,
          terms: req.body.terms ?? defaults.terms,
          deliveryTerms: req.body.deliveryTerms ?? defaults.deliveryTerms,
          deliveryCharges,
          deliveryChargesNote: req.body.deliveryChargesNote ?? defaults.deliveryChargesNote,
          companySnapshot: req.body.companySnapshot || defaults.companySnapshot,
          commercialConditions: req.body.commercialConditions,
          billingAddressSnapshot: req.body.billingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          shippingAddressSnapshot: req.body.shippingAddressSnapshot || req.body.shippingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          branchId: req.body.branchId,
          placeOfSupply: req.body.placeOfSupply || tax.placeOfSupply || customer.state,
          taxMode: req.body.taxMode || tax.taxMode,
          transporterInfo: req.body.transporterInfo,
          items: { create: calculated.items },
        },
        include: { customer: true, items: { include: { product: true } } },
      });
    });
    return success(res, quotation, 'Quotation created', 201);
  } catch (err: any) {
    if (!err.code && err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

export const updateQuotation = async (req: Request, res: Response) => {
  try {
    const q = await prisma.$transaction(async tx => {
      const existing = await tx.quotation.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Quotation not found');
      if (existing.submittedAt) throw new Error('Submitted quotations are immutable; create a revision');
      const { items, discount, date, validUntil } = req.body;
      let calculated: any;
      let calculatedItems: any[] | undefined;
      if (items) {
        if (!Array.isArray(items) || !items.length) throw new Error('A quotation must contain at least one product');
        calculated = await normalizeSalesItems(tx, items, { customerId: existing.customerId, currency: 'INR', priceListId: req.body.priceListId });
        calculatedItems = calculated.items.map((item: any, index: number) => ({ ...item, requestedDeliveryDate: items[index]?.requestedDeliveryDate ? new Date(items[index].requestedDeliveryDate) : undefined, committedDeliveryDate: items[index]?.committedDeliveryDate ? new Date(items[index].committedDeliveryDate) : undefined }));
        await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      }
      const discountAmount = new Prisma.Decimal(discount ?? existing.discount);
      const subtotal = calculated?.subtotal || existing.subtotal;
      const taxAmount = calculated?.taxAmount || existing.taxAmount;
      const deliveryCharges = new Prisma.Decimal(req.body.deliveryCharges ?? existing.deliveryCharges);
      const updated = await tx.quotation.update({ where: { id: existing.id }, data: {
        currency: 'INR', discount: discountAmount, deliveryCharges,
        total: quotationGrandTotal(subtotal, taxAmount, discountAmount, deliveryCharges),
        notes: req.body.notes, terms: req.body.terms, internalNotes: req.body.internalNotes,
        customerNotes: req.body.customerNotes, negotiationNote: req.body.negotiationNote,
        customerNameSnapshot: req.body.customerNameSnapshot,
        companySnapshot: req.body.companySnapshot,
        billingAddressSnapshot: req.body.billingAddressSnapshot,
        shippingAddressSnapshot: req.body.shippingAddressSnapshot,
        deliveryTerms: req.body.deliveryTerms,
        deliveryChargesNote: req.body.deliveryChargesNote,
        ...(date ? { date: new Date(date) } : {}), ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
        ...(calculated ? { subtotal, taxAmount, items: { create: calculatedItems } } : {}),
      }, include: { customer: true, items: { include: { product: true } } } });
      const user = (req as any).user || {};
      await tx.platformAuditLog.create({ data: { tenantId: user.tenantId, companyId: user.companyId, userId: user.id, entityType: 'QUOTATION', entityId: existing.id, action: 'UPDATE_DRAFT', before: JSON.parse(JSON.stringify(existing)), after: JSON.parse(JSON.stringify(updated)), ip: req.ip, userAgent: req.get('user-agent') } });
      return updated;
    });
    return success(res, q, 'Quotation updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const updateQuotationStatus = async (req : Request , res : Response)=>{
  return error(res, 'Direct quotation status changes are disabled. Use the audited submit, approve, send, negotiate, accept, reject or expire action.', 400);
};

export const deleteQuotation = async (req: Request, res: Response) => {
  try {
    await prisma.$transaction(async tx => {
      const quotation = await tx.quotation.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!quotation) throw new Error('Quotation not found');
      if (quotation.status !== 'DRAFT' || quotation.submittedAt) throw new Error('Only an unsubmitted draft quotation can be deleted');
      const user = (req as any).user || {};
      await tx.platformAuditLog.create({ data: { tenantId: user.tenantId, companyId: user.companyId, userId: user.id, entityType: 'QUOTATION', entityId: quotation.id, action: 'DELETE_DRAFT', before: JSON.parse(JSON.stringify(quotation)), ip: req.ip, userAgent: req.get('user-agent') } });
      await tx.quotation.delete({ where: { id: quotation.id } });
    });
    return success(res, null, 'Quotation deleted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const convertQuotationToOrder = async (req: Request, res: Response) => {
  try {
    const order = await prisma.$transaction(async tx => {
      const q = await tx.quotation.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
      if (!q) throw new Error('Quotation not found');
      if (q.status !== 'ACCEPTED') throw new Error('Only accepted quotations can be converted');
      const existing = await tx.salesOrder.findFirst({ where: { quotationId: q.id, status: { not: 'CANCELLED' } }, include: { items: true, customer: true } });
      if (existing) return existing;
      let rootId = q.id, parentId = q.supersedesId;
      while (parentId) {
        const parent = await tx.quotation.findUnique({ where: { id: parentId }, select: { id: true, supersedesId: true } });
        if (!parent) break;
        rootId = parent.id; parentId = parent.supersedesId;
      }
      const enquiry = await tx.salesEnquiry.findFirst({ where: { convertedQuotationId: rootId }, select: { targetDate: true } });
      const committedDates = q.items.map(item => item.committedDeliveryDate || item.requestedDeliveryDate || enquiry?.targetDate).filter(Boolean) as Date[];
      const completionDate = committedDates.length ? new Date(Math.max(...committedDates.map(date => new Date(date).getTime()))) : enquiry?.targetDate;
      const created = await tx.salesOrder.create({
      data: {
        orderNo: `DRAFT-SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`, companyId: q.companyId, customerId: q.customerId, quotationId: q.id,
        customerPoNo: q.customerPoNo, date: new Date(), deliveryDate: completionDate, completionDate, subtotal: q.subtotal, taxAmount: q.taxAmount,
        total: q.total, discount: q.discount, currency: q.currency,
        notes: q.notes, terms: q.terms,
        branchId: q.branchId, billingAddressSnapshot: q.billingAddressSnapshot as any,
        shippingAddressSnapshot: q.shippingAddressSnapshot as any, placeOfSupply: q.placeOfSupply,
        taxMode: q.taxMode, deliveryTerms: q.deliveryTerms, transporterInfo: q.transporterInfo as any,
        items: {
          create: q.items.map(i => ({
            productId: i.productId, description: i.description,
            quantity: i.quantity, unitPrice: i.unitPrice,
            taxRate: i.taxRate, discount: i.discount, total: i.total,
            uomId: i.uomId, requestedDeliveryDate: i.requestedDeliveryDate || enquiry?.targetDate,
            committedDeliveryDate: i.committedDeliveryDate || i.requestedDeliveryDate || enquiry?.targetDate,
            supplyMode: i.product.supplyPolicy === 'MANUFACTURE' ? 'MAKE_TO_ORDER' : 'MAKE_TO_STOCK',
          })),
        },
      },
      include: { customer: true, items: { include: { product: true } } },
    });
      const user = (req as any).user || {};
      await tx.platformAuditLog.create({ data: { tenantId: user.tenantId, companyId: user.companyId, userId: user.id, entityType: 'SALES_ORDER', entityId: created.id, action: 'CREATE_FROM_ACCEPTED_QUOTATION', after: JSON.parse(JSON.stringify(created)), diff: { quotationId: q.id, revisionNo: q.revisionNo } } });
      return created;
    });
    return success(res, order, 'Quotation converted to sales order');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
