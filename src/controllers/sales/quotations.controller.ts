import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateOrderNo, generateQuotationNo } from '../../utils/generate';
import { normalizeSalesItems } from './shared';
import { determineSalesTax } from '../../services/sales/tax.service';

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

export const createQuotation = async (req: Request, res: Response) => {
  try {
    const { customerId, date, validUntil, items = [], notes, terms, currency, discount } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    if (!items.length) return error(res, 'At least one quotation item is required', 400);

    const quotation = await prisma.$transaction(async (tx) => {
      const quotationNo = `DRAFT-QTN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error('Customer not found');
      const supplier = req.body.branchId ? await tx.branch.findUnique({ where: { id: req.body.branchId } }) : customer.companyId ? await tx.company.findUnique({ where: { id: customer.companyId } }) : null;
      const tax = determineSalesTax({ supplierGstin: supplier?.gstin, customerGstin: customer.taxId, customerCountry: customer.country, isSez: Boolean(req.body.isSez), isExport: Boolean(req.body.isExport) });
      const calculated = await normalizeSalesItems(tx, items, { customerId, currency: currency || customer.currency, priceListId: req.body.priceListId, customerGroup: customer.customerGroup || undefined, territory: req.body.territory || customer.territory || undefined, salesChannel: req.body.salesChannel || customer.salesChannel || undefined });
      const discountAmount = new Prisma.Decimal(discount || 0);
      const total = calculated.subtotal.plus(calculated.taxAmount).minus(discountAmount);
      return tx.quotation.create({
        data: {
          quotationNo,
          customerId,
          date: date ? new Date(date) : new Date(),
          validUntil: validUntil ? new Date(validUntil) : undefined,
          subtotal: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          total,
          discount: discountAmount,
          currency: currency || customer.currency,
          notes,
          terms,
          commercialConditions: req.body.commercialConditions,
          billingAddressSnapshot: req.body.billingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          shippingAddressSnapshot: req.body.shippingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          branchId: req.body.branchId,
          placeOfSupply: req.body.placeOfSupply || tax.placeOfSupply || customer.state,
          taxMode: req.body.taxMode || tax.taxMode,
          deliveryTerms: req.body.deliveryTerms,
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
      const { items, discount, date, validUntil, ...data } = req.body;
      let calculated: any;
      if (items) {
        calculated = await normalizeSalesItems(tx, items, { customerId: existing.customerId, currency: data.currency || existing.currency, priceListId: req.body.priceListId });
        await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      }
      const discountAmount = new Prisma.Decimal(discount ?? existing.discount);
      return tx.quotation.update({ where: { id: existing.id }, data: { ...data, ...(date ? { date: new Date(date) } : {}), ...(validUntil ? { validUntil: new Date(validUntil) } : {}), ...(calculated ? { subtotal: calculated.subtotal, taxAmount: calculated.taxAmount, discount: discountAmount, total: calculated.subtotal.plus(calculated.taxAmount).minus(discountAmount), items: { create: calculated.items } } : {}) }, include: { customer: true, items: { include: { product: true } } } });
    });
    return success(res, q, 'Quotation updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const updateQuotationStatus = async (req : Request , res : Response)=>{
  try{
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
    if(!validStatuses.includes(status)){
      return error(res , 'Invalid Quotation Status Value' , 400);  
    }

    const quotation = await prisma.quotation.update({
      where: { id },
      data: { status },
      include: { customer: { select: { name: true } } }
    });
    return success(res , quotation , 'Quotation Status Updated Successfully');
  }catch(err : any){
    return handlePrismaError(res , err);
  }
};

export const deleteQuotation = async (req: Request, res: Response) => {
  try {
    await prisma.quotation.delete({ where: { id: req.params.id } });
    return success(res, null, 'Quotation deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const convertQuotationToOrder = async (req: Request, res: Response) => {
  try {
    const order = await prisma.$transaction(async tx => {
      const q = await tx.quotation.findUnique({ where: { id: req.params.id }, include: { items: true } });
      if (!q) throw new Error('Quotation not found');
      if (q.status !== 'ACCEPTED') throw new Error('Only accepted quotations can be converted');
      const existing = await tx.salesOrder.findFirst({ where: { quotationId: q.id, status: { not: 'CANCELLED' } }, include: { items: true, customer: true } });
      if (existing) return existing;
      return tx.salesOrder.create({
      data: {
        orderNo: `DRAFT-SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`, customerId: q.customerId, quotationId: q.id,
        date: new Date(), subtotal: q.subtotal, taxAmount: q.taxAmount,
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
            uomId: i.uomId,
          })),
        },
      },
      include: { customer: true, items: { include: { product: true } } },
    });
    });
    return success(res, order, 'Quotation converted to sales order');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};
