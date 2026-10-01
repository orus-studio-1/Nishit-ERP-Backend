import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { generateOrderNo } from '../../utils/generate';
import { normalizeSalesItems } from './shared';
import { releaseSalesOrderReservations, reserveSalesOrderStock } from '../../services/inventory/reservation.service';
import { refreshSalesOrderProgress } from '../../services/sales/salesOrder.service';
import { determineSalesTax } from '../../services/sales/tax.service';
import { respondPaginated } from '../../utils/pagination';

export const getSalesOrders = async (req: Request, res: Response) => {
  try {
    const { status, customerId, search } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) where.orderNo = { contains: search, mode: 'insensitive' };

    return respondPaginated(res, prisma.salesOrder, req, { where, include: { customer: { select: { name: true, email: true } }, items: { include: { product: true } } } });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getSalesOrder = async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: { customer: true, quotation: true, items: { include: { product: true } }, invoices: true },
    });
    if (!order) return error(res, 'Sales order not found', 404);
    return success(res, order);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createSalesOrder = async (req: Request, res: Response) => {
  try {
    const { customerId, date, deliveryDate, items = [], notes, terms, currency, discount, customerPoNo, sourceWarehouseId } = req.body;
    if (!customerId) return error(res, 'customerId is required', 400);
    if (!items.length) return error(res, 'At least one sales order item is required', 400);

    const order = await prisma.$transaction(async (tx) => {
      const orderNo = `DRAFT-SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (customerPoNo) {
        const duplicatePo = await tx.salesOrder.findFirst({ where: { customerId, customerPoNo, status: { not: 'CANCELLED' } } });
        if (duplicatePo) throw new Error(`Customer PO ${customerPoNo} is already used on ${duplicatePo.orderNo}`);
      }
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error('Customer not found');
      const supplier = req.body.branchId ? await tx.branch.findUnique({ where: { id: req.body.branchId } }) : customer.companyId ? await tx.company.findUnique({ where: { id: customer.companyId } }) : null;
      const tax = determineSalesTax({ supplierGstin: supplier?.gstin, customerGstin: customer.taxId, customerCountry: customer.country, isSez: Boolean(req.body.isSez), isExport: Boolean(req.body.isExport) });
      const calculated = await normalizeSalesItems(tx, items, { customerId, currency: currency || customer.currency, priceListId: req.body.priceListId, customerGroup: customer.customerGroup || undefined, territory: req.body.territory || customer.territory || undefined, salesChannel: req.body.salesChannel || customer.salesChannel || undefined });
      const discountAmount = new Prisma.Decimal(discount || 0);
      const total = calculated.subtotal.plus(calculated.taxAmount).minus(discountAmount);
      return tx.salesOrder.create({
        data: {
          orderNo,
          customerId,
          customerPoNo,
          sourceWarehouseId,
          date: date ? new Date(date) : new Date(),
          deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
          subtotal: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          total,
          discount: discountAmount,
          currency: currency || customer.currency,
          notes,
          terms,
          branchId: req.body.branchId,
          territory: req.body.territory || customer.territory,
          salesChannel: req.body.salesChannel || customer.salesChannel,
          billingAddressSnapshot: req.body.billingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          shippingAddressSnapshot: req.body.shippingAddress || { address: customer.address, city: customer.city, state: customer.state, country: customer.country, zip: customer.zip, taxId: customer.taxId },
          placeOfSupply: req.body.placeOfSupply || tax.placeOfSupply || customer.state,
          taxMode: req.body.taxMode || tax.taxMode,
          deliveryTerms: req.body.deliveryTerms,
          transporterInfo: req.body.transporterInfo,
          eWayBillNo: req.body.eWayBillNo,
          // normalizeSalesItems is shared with Quotation creation, whose items support hsnCode/brand/
          // costRate/marginPercent/priceSource; SalesOrderItem has no such columns, so drop them here.
          items: { create: calculated.items.map(({ hsnCode: _hsnCode, brand: _brand, costRate: _costRate, marginPercent: _marginPercent, priceSource: _priceSource, ...item }: any, index: number) => ({ ...item, sourceWarehouseId, supplyMode: items[index]?.supplyMode || 'MAKE_TO_STOCK', backorderQty: 0 })) },
        },
        include: { customer: true, items: { include: { product: true } } },
      });
    });
    return success(res, order, 'Sales order created', 201);
  } catch (err: any) {
    if (!err.code && err.message) return error(res, err.message, 400);
    return handlePrismaError(res, err);
  }
};

//Update Sales Order
export const updateSalesOrder = async (req : Request , res: Response)=>{
  try{
    const { id } = req.params;
    const { items = [], notes, terms, currency, discount, deliveryDate, date, customerId, sourceWarehouseId } = req.body;

    const existingOrder = await prisma.salesOrder.findUnique({
      where: { id },
    });
    
    if(!existingOrder) return error(res, 'Sales Order not found' , 404);
    if(existingOrder.status !== 'DRAFT'){
      return error(res,'Only draft sales orders can be updates' , 400);
    }
    
    if (!items.length) return error(res, 'At least one sales order item is required', 400);
    const effectiveCustomerId = customerId || existingOrder.customerId;
    const updatedOrder = await prisma.$transaction(async (tx) =>{
      const customer = await tx.customer.findUnique({ where: { id: effectiveCustomerId } });
      if (!customer) throw new Error('Customer not found');
      const calculated = await normalizeSalesItems(tx, items, { customerId: effectiveCustomerId, currency: currency || existingOrder.currency, priceListId: req.body.priceListId, customerGroup: customer.customerGroup || undefined, territory: req.body.territory || customer.territory || undefined, salesChannel: req.body.salesChannel || customer.salesChannel || undefined });
      const discountAmount = new Prisma.Decimal(discount ?? existingOrder.discount);
      await tx.salesOrderItem.deleteMany({
        where: { salesOrderId: id },
      });

      const order = await tx.salesOrder.update({
        where: { id },
        data: {
          customerId: effectiveCustomerId,
          date: date ? new Date(date) : undefined,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
          sourceWarehouseId: sourceWarehouseId ?? existingOrder.sourceWarehouseId,
          subtotal: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          discount: discountAmount,
          total: calculated.subtotal.plus(calculated.taxAmount).minus(discountAmount),
          currency: currency || existingOrder.currency,
          notes,
          terms,
          items: {
            create: calculated.items.map(({ hsnCode: _hsnCode, brand: _brand, costRate: _costRate, marginPercent: _marginPercent, priceSource: _priceSource, ...item }: any, index: number) => ({ ...item, sourceWarehouseId: sourceWarehouseId ?? existingOrder.sourceWarehouseId, supplyMode: items[index]?.supplyMode || 'MAKE_TO_STOCK', backorderQty: 0 })),
          },
        },
        include: { customer: true, items: { include: { product: true } } },
      });

      return order;
    });

    return success(res, updatedOrder, 'Sales order updated successfully');
  }catch(err : any){
    if (!err.code && err.message) return error(res, err.message, 400);
    return handlePrismaError(res , err);
  }
}

export const updateSalesOrderStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['CONFIRMED', 'ON_HOLD', 'CANCELLED', 'CLOSED'];
    if (!allowedStatuses.includes(status)) return error(res, 'Order progress is updated from submitted deliveries and invoices; this status cannot be set manually', 400);
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('Sales order not found');
      if (status === 'CONFIRMED' && existing.status === 'DRAFT') {
        await reserveSalesOrderStock(tx, existing.id, req.body.warehouseId || existing.sourceWarehouseId);
      }
      if (status === 'CANCELLED') {
        await releaseSalesOrderReservations(tx, existing.id);
      }
      if (status === 'ON_HOLD') {
        return tx.salesOrder.update({ where: { id: req.params.id }, data: { status, holdReason: req.body.holdReason || 'On hold' } });
      }
      if (status === 'CLOSED') {
        if (!req.body.confirmClose || Number(existing.deliveredPercent) < 100 || Number(existing.billedPercent) < 100) {
          throw new Error('Only a fully delivered and billed order can be closed with explicit confirmation');
        }
        await releaseSalesOrderReservations(tx, existing.id);
        return tx.salesOrder.update({ where: { id: req.params.id }, data: { status } });
      }
      return tx.salesOrder.update({
        where: { id: req.params.id },
        data: { status },
        include: { customer: true, items: { include: { product: true } }, stockReservations: true },
      });
    });
    if (order?.id) await prisma.$transaction((tx) => refreshSalesOrderProgress(tx, order.id));
    return success(res, order, 'Order status updated');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const deleteSalesOrder = async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return error(res, 'Order not found', 404);
    if (order.status !== 'DRAFT') return error(res, 'Only draft orders can be deleted', 400);
    await prisma.salesOrder.delete({ where: { id: req.params.id } });
    return success(res, null, 'Sales order deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
