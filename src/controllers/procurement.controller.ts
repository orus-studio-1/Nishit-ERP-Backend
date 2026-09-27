import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, paginated, error } from '../utils/response';
import { handlePrismaError } from '../utils/prismaError';
import { generatePONo, generatePurchaseInvoiceNo } from '../utils/generate';
import {
  buyingSettings, cancelVoucher, createPurchaseReceiptFromOrder, documentTotals, lineAmount,
  blanketOrderItems, materialRequestItems, nextNo, normalizeItems, poInclude, postSupplierPayment,
  purchaseInvoiceInclude, purchaseInvoiceItems, purchaseOrderItems, purchaseReceiptItems, rfqItems, supplierQuotationItems,
  purchaseReceiptInclude, refreshPurchaseOrderProgress, submitPurchaseInvoice, submitPurchaseReceipt,
} from '../services/procurement/procurement.service';

const D = Prisma.Decimal;

function page(req: Request) {
  return { page: parseInt(req.query.page as string) || 1, limit: parseInt(req.query.limit as string) || 20 };
}

async function list(res: Response, model: string, req: Request, where: any = {}, include?: any) {
  const p = page(req);
  const [items, total] = await Promise.all([
    (prisma as any)[model].findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.limit, take: p.limit }),
    (prisma as any)[model].count({ where }),
  ]);
  return paginated(res, items, total, p.page, p.limit);
}

export const getProcurementDashboard = async (_req: Request, res: Response) => {
  try {
    const [mrs, rfqs, quotes, pos, receipts, invoices, payments] = await Promise.all([
      (prisma as any).materialRequest.count({ where: { status: { not: 'CANCELLED' } } }),
      (prisma as any).requestForQuotation.count({ where: { status: { not: 'CANCELLED' } } }),
      (prisma as any).supplierQuotation.count({ where: { status: { not: 'CANCELLED' } } }),
      prisma.purchaseOrder.count({ where: { status: { not: 'CANCELLED' } } }),
      (prisma as any).purchaseReceipt.count({ where: { status: { not: 'CANCELLED' } } }),
      prisma.purchaseInvoice.count({ where: { status: { not: 'CANCELLED' } } }),
      (prisma as any).supplierPayment.count({ where: { status: { not: 'CANCELLED' } } }),
    ]);
    const outstanding = await prisma.purchaseInvoice.aggregate({ _sum: { outstandingAmount: true as any } as any, where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] as any } } as any });
    return success(res, { counts: { materialRequests: mrs, rfqs, supplierQuotations: quotes, purchaseOrders: pos, purchaseReceipts: receipts, purchaseInvoices: invoices, supplierPayments: payments }, outstandingPayable: (outstanding._sum as any).outstandingAmount || 0 });
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getBuyingSettings = async (_req: Request, res: Response) => {
  try { return success(res, await buyingSettings()); } catch (err: any) { return handlePrismaError(res, err); }
};

export const updateBuyingSettings = async (req: Request, res: Response) => {
  try {
    const current = await buyingSettings();
    const data = {
      defaultBuyingPriceListId: req.body.defaultBuyingPriceListId || null,
      requirePurchaseOrderForInvoice: Boolean(req.body.requirePurchaseOrderForInvoice),
      requirePurchaseReceiptForInvoice: Boolean(req.body.requirePurchaseReceiptForInvoice),
      defaultRfqTerms: req.body.defaultRfqTerms || null,
      overReceiptAllowancePercent: Number(req.body.overReceiptAllowancePercent || 0),
      overBillingAllowancePercent: Number(req.body.overBillingAllowancePercent || 0),
      autoCreateMaterialRequest: req.body.autoCreateMaterialRequest !== false,
      defaultCurrency: req.body.defaultCurrency || 'INR',
      rateTolerancePercent: Number(req.body.rateTolerancePercent || 0),
      quantityTolerancePercent: Number(req.body.quantityTolerancePercent || 0),
      taxTolerancePercent: Number(req.body.taxTolerancePercent || 0),
      requireThreeWayMatch: req.body.requireThreeWayMatch !== false,
      requireGateEntry: req.body.requireGateEntry !== false,
      requireInspectionForConfiguredItems: req.body.requireInspectionForConfiguredItems !== false,
      msmePaymentDays: Number(req.body.msmePaymentDays || 45),
    };
    return success(res, await (prisma as any).buyingSettings.update({ where: { id: current.id }, data }), 'Buying settings updated');
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getPaymentTerms = async (req: Request, res: Response) => list(res, 'paymentTermsTemplate', req, {}, { terms: { orderBy: { rowOrder: 'asc' } } });

export const createPaymentTerms = async (req: Request, res: Response) => {
  try {
    const terms = (req.body.terms || []).filter((term: any) => term.label && Number(term.percentage) > 0).map((term: any, index: number) => ({ label: term.label, percentage: Number(term.percentage), dueAfterDays: Number(term.dueAfterDays || 0), rowOrder: Number(term.rowOrder ?? index) }));
    if (!req.body.name || !terms.length) return error(res, 'Template name and at least one payment term are required', 400);
    const totalPercentage = terms.reduce((sum: number, term: any) => sum + term.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.001) return error(res, 'Payment term percentages must total 100', 400);
    const template = await (prisma as any).paymentTermsTemplate.create({ data: { name: String(req.body.name).trim(), description: req.body.description || undefined, isDefault: Boolean(req.body.isDefault), isActive: req.body.isActive !== false, terms: { create: terms } }, include: { terms: true } });
    return success(res, template, 'Payment terms template created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getSupplierItems = async (req: Request, res: Response) => list(res, 'supplierItem', req, req.query.supplierId ? { supplierId: req.query.supplierId } : {}, { supplier: true, product: true });

export const createSupplierItem = async (req: Request, res: Response) => {
  try {
    if (!req.body.supplierId || !req.body.productId || !req.body.supplierItemCode) return error(res, 'Supplier, item, and supplier item code are required', 400);
    const data = { supplierId: req.body.supplierId, productId: req.body.productId, supplierItemCode: req.body.supplierItemCode, supplierItemName: req.body.supplierItemName || undefined, leadTimeDays: Number(req.body.leadTimeDays || 0), minimumOrderQty: req.body.minimumOrderQty || 0 };
    return success(res, await (prisma as any).supplierItem.upsert({ where: { supplierId_productId: { supplierId: data.supplierId, productId: data.productId } }, update: data, create: data, include: { supplier: true, product: true } }), 'Supplier item mapping saved', 201);
  }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getMaterialRequests = async (req: Request, res: Response) => list(res, 'materialRequest', req, req.query.status ? { status: req.query.status } : {}, { items: { include: { product: true, warehouse: true } }, purchaseOrders: true, rfqs: true });

export const createMaterialRequest = async (req: Request, res: Response) => {
  try {
    const items = materialRequestItems(req.body.items);
    if (!items.length) return error(res, 'Add at least one material request item', 400);
    const requestNo = await nextNo('materialRequest', 'requestNo', 'MR');
    const doc = await (prisma as any).materialRequest.create({ data: {
      requestNo, type: req.body.type || 'PURCHASE', source: req.body.source || 'MANUAL',
      requiredBy: req.body.requiredBy ? new Date(req.body.requiredBy) : undefined,
      requestedById: (req as any).user?.id, costCenterId: req.body.costCenterId || undefined,
      projectId: req.body.projectId || undefined, notes: req.body.notes || req.body.terms || undefined,
      items: { create: items },
    }, include: { items: { include: { product: true, warehouse: true } } } });
    return success(res, doc, 'Material request created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const createMaterialRequestsFromReorder = async (_req: Request, res: Response) => {
  try {
    const lowStock = await prisma.stockLevel.findMany({ include: { product: true, warehouse: true } });
    const rows = lowStock.filter((row: any) => new D(row.quantity || 0).minus(row.reservedQty || 0).lte(row.product.reorderLevel || row.product.minStockLevel || 0) && new D(row.product.reorderQty || 0).gt(0));
    if (!rows.length) return success(res, [], 'No reorder material requests needed');
    const docs = [];
    for (const row of rows) {
      docs.push(await (prisma as any).materialRequest.create({ data: { requestNo: await nextNo('materialRequest', 'requestNo', 'MR'), source: 'REORDER', requiredBy: new Date(), notes: `Auto-created from reorder level for ${row.product.sku}`, items: { create: [{ productId: row.productId, warehouseId: row.warehouseId, quantity: row.product.reorderQty }] } }, include: { items: true } }));
    }
    return success(res, docs, 'Reorder material requests created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const updateMaterialRequestStatus = async (req: Request, res: Response) => {
  try { return success(res, await (prisma as any).materialRequest.update({ where: { id: req.params.id }, data: { status: req.body.status, submittedAt: req.body.status === 'SUBMITTED' ? new Date() : undefined, cancelledAt: req.body.status === 'CANCELLED' ? new Date() : undefined } }), 'Material request status updated'); }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getRfqs = async (req: Request, res: Response) => list(res, 'requestForQuotation', req, req.query.status ? { status: req.query.status } : {}, { materialRequest: true, items: { include: { product: true } }, suppliers: { include: { supplier: true } }, supplierQuotations: true });

export const createRfq = async (req: Request, res: Response) => {
  try {
    const { items = [], suppliers = [], ...body } = req.body;
    const cleanItems = rfqItems(items);
    if (!cleanItems.length) return error(res, 'Add at least one RFQ item', 400);
    const doc = await (prisma as any).requestForQuotation.create({ data: {
      rfqNo: await nextNo('requestForQuotation', 'rfqNo', 'RFQ'), materialRequestId: body.materialRequestId || undefined,
      transactionDate: body.transactionDate ? new Date(body.transactionDate) : new Date(), validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
      terms: body.terms || body.notes || undefined, message: body.message || undefined,
      items: { create: cleanItems }, suppliers: { create: suppliers.filter(Boolean).map((s: any) => ({ supplierId: s.supplierId || s, email: s.email })) },
    }, include: { items: true, suppliers: { include: { supplier: true } } } });
    return success(res, doc, 'RFQ created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const createRfqFromMaterialRequest = async (req: Request, res: Response) => {
  try {
    const mr = await (prisma as any).materialRequest.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!mr) return error(res, 'Material request not found', 404);
    req.body.items = mr.items.map((item: any) => ({ productId: item.productId, quantity: item.quantity, uom: item.uom, stockUom: item.stockUom, conversionFactor: item.conversionFactor, description: item.description, requiredBy: item.requiredBy }));
    req.body.materialRequestId = mr.id;
    return createRfq(req, res);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const updateRfqStatus = async (req: Request, res: Response) => {
  try { return success(res, await (prisma as any).requestForQuotation.update({ where: { id: req.params.id }, data: { status: req.body.status } }), 'RFQ status updated'); }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getSupplierQuotations = async (req: Request, res: Response) => list(res, 'supplierQuotation', req, req.query.rfqId ? { rfqId: req.query.rfqId } : {}, { rfq: true, supplier: true, items: { include: { product: true } }, purchaseOrders: true });

export const createSupplierQuotation = async (req: Request, res: Response) => {
  try {
    const items = supplierQuotationItems(req.body.items);
    if (!req.body.supplierId || !items.length) return error(res, 'Supplier and at least one quotation item are required', 400);
    const totals = documentTotals(items, req.body.discount, req.body.shippingAmount, req.body.exchangeRate || 1);
    const doc = await (prisma as any).supplierQuotation.create({ data: {
      quotationNo: await nextNo('supplierQuotation', 'quotationNo', 'SQ'), rfqId: req.body.rfqId || undefined,
      supplierId: req.body.supplierId, date: req.body.date ? new Date(req.body.date) : new Date(),
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : undefined, currency: req.body.currency || 'INR',
      exchangeRate: req.body.exchangeRate || 1, subtotal: totals.subtotal, taxAmount: totals.taxAmount,
      shippingAmount: totals.shippingAmount, discount: req.body.discount || 0, total: totals.total,
      terms: req.body.terms || undefined, notes: req.body.notes || undefined,
      vendorDocumentDetails: req.body.vendorDocumentDetails || undefined, items: { create: items },
    }, include: { supplier: true, items: { include: { product: true } } } });
    return success(res, doc, 'Supplier quotation created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const compareSupplierQuotations = async (req: Request, res: Response) => {
  try { return success(res, await (prisma as any).supplierQuotation.findMany({ where: { rfqId: req.params.rfqId }, include: { supplier: true, items: { include: { product: true } } }, orderBy: [{ total: 'asc' }, { validUntil: 'asc' }] })); }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const createPurchaseOrderFromSupplierQuotation = async (req: Request, res: Response) => {
  try {
    const sq = await (prisma as any).supplierQuotation.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!sq) return error(res, 'Supplier quotation not found', 404);
    const deliveryDates = sq.items.map((item: any) => item.deliveryDate).filter(Boolean);
    req.body = { supplierId: sq.supplierId, rfqId: sq.rfqId, supplierQuotationId: sq.id, date: new Date(), expectedDate: deliveryDates.length ? new Date(Math.max(...deliveryDates.map((date: Date) => date.getTime()))) : undefined, currency: sq.currency, exchangeRate: sq.exchangeRate, discount: sq.discount, shippingAmount: sq.shippingAmount, terms: sq.terms, notes: req.body.notes, vendorDocumentDetails: sq.vendorDocumentDetails, items: sq.items.map((item: any) => ({ productId: item.productId, quantity: Number(item.quantity), unitPrice: Number(item.rate), taxRate: Number(item.taxRate), discount: Number(item.discount), uom: item.uom, stockUom: item.stockUom, conversionFactor: item.conversionFactor, supplierItemCode: item.supplierItemCode, total: Number(item.amount), categoryCode: item.categoryCode, hsnCode: item.hsnCode, make: item.make, quantityTolerance: item.quantityTolerance, expectedDate: item.deliveryDate })) };
    return createPurchaseOrder(req, res);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getBlanketPurchaseOrders = async (req: Request, res: Response) => list(res, 'blanketPurchaseOrder', req, {}, { supplier: true, items: { include: { product: true } }, purchaseOrders: true });

export const createBlanketPurchaseOrder = async (req: Request, res: Response) => {
  try {
    const items = blanketOrderItems(req.body.items);
    if (!req.body.supplierId || !req.body.validFrom || !req.body.validTo || !items.length) return error(res, 'Supplier, validity dates, and at least one item are required', 400);
    if (new Date(req.body.validTo) < new Date(req.body.validFrom)) return error(res, 'Valid To cannot be before Valid From', 400);
    return success(res, await (prisma as any).blanketPurchaseOrder.create({ data: {
      agreementNo: await nextNo('blanketPurchaseOrder', 'agreementNo', 'BPO', prisma as any), supplierId: req.body.supplierId,
      validFrom: new Date(req.body.validFrom), validTo: new Date(req.body.validTo), currency: req.body.currency || 'INR',
      terms: req.body.terms || req.body.notes || undefined, items: { create: items },
    }, include: { supplier: true, items: { include: { product: true } } } }), 'Blanket purchase order created', 201);
  }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getPurchaseOrders = async (req: Request, res: Response) => {
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.supplierId) where.supplierId = req.query.supplierId;
  if (req.query.search) where.orderNo = { contains: req.query.search, mode: 'insensitive' };
  return list(res, 'purchaseOrder', req, where, poInclude);
};

export const getPurchaseOrder = async (req: Request, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: poInclude });
    if (!po) return error(res, 'Purchase order not found', 404);
    return success(res, po);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const createPurchaseOrder = async (req: Request, res: Response) => {
  try {
    const { supplierId, date, expectedDate, items, notes, terms, currency, discount, shippingAmount, exchangeRate, ...links } = req.body;
    const cleanItems = purchaseOrderItems(items);
    if (!supplierId || !cleanItems.length) return error(res, 'Supplier and at least one item are required', 400);
    const totals = documentTotals(cleanItems, discount, shippingAmount, exchangeRate || 1);
    const po = await prisma.purchaseOrder.create({
      data: {
        ...links, orderNo: await generatePONo(), supplierId, date: date ? new Date(date) : new Date(), expectedDate: expectedDate ? new Date(expectedDate) : undefined,
        subtotal: Number(totals.subtotal), taxAmount: Number(totals.taxAmount), shippingAmount: Number(totals.shippingAmount), total: Number(totals.total), baseTotal: totals.baseTotal,
        discount: discount || 0, currency: currency || 'INR', exchangeRate: exchangeRate || 1, notes, terms,
        items: { create: cleanItems },
      } as any,
      include: poInclude,
    });
    return success(res, po, 'Purchase order created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const updatePurchaseOrderStatus = async (req: Request, res: Response) => {
  try {
    const status = req.body.status;
    const data: any = { status, workflowStatus: status === 'CONFIRMED' ? 'SUBMITTED' : status === 'CANCELLED' ? 'CANCELLED' : 'DRAFT', submittedAt: status === 'CONFIRMED' ? new Date() : undefined, cancelledAt: status === 'CANCELLED' ? new Date() : undefined };
    return success(res, await prisma.purchaseOrder.update({ where: { id: req.params.id }, data, include: poInclude }), 'Purchase order status updated');
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const deletePurchaseOrder = async (req: Request, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return error(res, 'Purchase order not found', 404);
    if (po.status !== 'DRAFT') return error(res, 'Only draft orders can be deleted', 400);
    await prisma.purchaseOrder.delete({ where: { id: req.params.id } });
    return success(res, null, 'Purchase order deleted');
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getPurchaseReceipts = async (req: Request, res: Response) => list(res, 'purchaseReceipt', req, req.query.status ? { status: req.query.status } : {}, purchaseReceiptInclude);
export const createPurchaseReceipt = async (req: Request, res: Response) => {
  try {
    if (req.body.purchaseOrderId) return success(res, await createPurchaseReceiptFromOrder(req.body.purchaseOrderId, req.body), 'Purchase receipt created from PO', 201);
    const items = purchaseReceiptItems(req.body.items || []);
    if (!req.body.supplierId || !items.length) return error(res, 'Supplier and at least one receipt item are required', 400);
    const totals = documentTotals(items.map((item: any) => ({ quantity: item.receivedQty || item.quantity, rate: item.rate })));
    return success(res, await (prisma as any).purchaseReceipt.create({ data: {
      receiptNo: await nextNo('purchaseReceipt', 'receiptNo', 'PREC'), supplierId: req.body.supplierId,
      postingDate: req.body.postingDate ? new Date(req.body.postingDate) : new Date(), currency: req.body.currency || 'INR',
      exchangeRate: req.body.exchangeRate || 1, costCenterId: req.body.costCenterId || undefined,
      projectId: req.body.projectId || undefined, notes: req.body.notes || req.body.terms || undefined,
      acceptedQty: items.reduce((s, i) => s.plus(i.acceptedQty || i.receivedQty || 0), new D(0)),
      rejectedQty: items.reduce((s, i) => s.plus(i.rejectedQty || 0), new D(0)), subtotal: totals.subtotal, items: { create: items },
    }, include: purchaseReceiptInclude }), 'Purchase receipt created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};
export const createPurchaseReceiptFromPurchaseOrder = async (req: Request, res: Response) => {
  try { return success(res, await createPurchaseReceiptFromOrder(req.params.id, req.body), 'Purchase receipt created from PO', 201); }
  catch (err: any) { return error(res, err.message || 'Failed', 400); }
};
export const updatePurchaseReceiptStatus = async (req: Request, res: Response) => {
  try {
    if (req.body.status === 'SUBMITTED') return success(res, await submitPurchaseReceipt(req.params.id, { tenantId: (req as any).user?.tenantId, userId: (req as any).user?.id }), 'Purchase receipt submitted and supplier communication recorded');
    if (req.body.status === 'CANCELLED') return success(res, await cancelVoucher('purchaseReceipt', req.params.id), 'Purchase receipt cancelled');
    return success(res, await (prisma as any).purchaseReceipt.update({ where: { id: req.params.id }, data: { status: req.body.status }, include: purchaseReceiptInclude }), 'Purchase receipt status updated');
  } catch (err: any) { return error(res, err.message || 'Failed', 400); }
};

export const getQualityInspections = async (req: Request, res: Response) => list(res, 'qualityInspection', req, req.query.status ? { status: req.query.status } : {}, { purchaseReceipt: true, product: true });
export const createQualityInspection = async (req: Request, res: Response) => {
  try {
    if (!req.body.purchaseReceiptId && !req.body.productId) return error(res, 'Purchase receipt or product is required', 400);
    const inspectedQty = Number(req.body.inspectedQty || 0);
    const acceptedQty = Number(req.body.acceptedQty || 0);
    const rejectedQty = Number(req.body.rejectedQty || 0);
    if (acceptedQty + rejectedQty > inspectedQty) return error(res, 'Accepted and rejected quantities cannot exceed inspected quantity', 400);
    return success(res, await (prisma as any).qualityInspection.create({ data: {
      inspectionNo: await nextNo('qualityInspection', 'inspectionNo', 'QI'), purchaseReceiptId: req.body.purchaseReceiptId || undefined,
      productId: req.body.productId || undefined, inspectedQty, acceptedQty, rejectedQty,
      inspectedById: (req as any).user?.id, remarks: req.body.remarks || req.body.notes || req.body.terms || undefined,
    }, include: { purchaseReceipt: true, product: true } }), 'Quality inspection created', 201);
  }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getLandedCostVouchers = async (req: Request, res: Response) => list(res, 'landedCostVoucher', req, {}, { purchaseReceipt: true, charges: true, allocations: true });
export const createLandedCostVoucher = async (req: Request, res: Response) => {
  try {
    const charges = req.body.charges || [];
    const totalCharges = charges.reduce((sum: any, c: any) => sum.plus(c.amount || 0), new D(0));
    if (!req.body.purchaseReceiptId || !charges.length || totalCharges.lte(0)) return error(res, 'Purchase receipt and at least one positive landed charge are required', 400);
    const cleanCharges = charges.filter((charge: any) => Number(charge.amount) > 0).map((charge: any) => ({ type: charge.type || 'OTHER', description: charge.description || undefined, amount: charge.amount, accountId: charge.accountId || undefined }));
    const doc = await (prisma as any).landedCostVoucher.create({ data: {
      voucherNo: await nextNo('landedCostVoucher', 'voucherNo', 'LCV'), purchaseReceiptId: req.body.purchaseReceiptId,
      allocationBasis: req.body.allocationBasis || 'VALUE', postingDate: req.body.postingDate ? new Date(req.body.postingDate) : new Date(),
      notes: req.body.notes || req.body.terms || undefined, totalCharges, charges: { create: cleanCharges },
    }, include: { purchaseReceipt: { include: { items: true } }, charges: true, allocations: true } });
    return success(res, doc, 'Landed cost voucher created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};
export const updateLandedCostVoucherStatus = async (req: Request, res: Response) => {
  try {
    const doc = await (prisma as any).landedCostVoucher.findUnique({ where: { id: req.params.id }, include: { purchaseReceipt: { include: { items: true } }, charges: true } });
    if (!doc) return error(res, 'Landed cost voucher not found', 404);
    if (req.body.status !== 'SUBMITTED') return success(res, await (prisma as any).landedCostVoucher.update({ where: { id: req.params.id }, data: { status: req.body.status } }));
    const totalBase = doc.allocationBasis === 'QUANTITY' ? doc.purchaseReceipt.items.reduce((s: any, i: any) => s.plus(i.acceptedQty || i.receivedQty || 0), new D(0)) : doc.purchaseReceipt.items.reduce((s: any, i: any) => s.plus(new D(i.acceptedQty || i.receivedQty || 0).mul(i.rate || 0)), new D(0));
    await prisma.$transaction(async (tx: any) => {
      for (const item of doc.purchaseReceipt.items) {
        const basis = doc.allocationBasis === 'QUANTITY' ? new D(item.acceptedQty || item.receivedQty || 0) : new D(item.acceptedQty || item.receivedQty || 0).mul(item.rate || 0);
        const share = totalBase.gt(0) ? new D(doc.totalCharges).mul(basis).div(totalBase) : new D(0);
        await tx.landedCostAllocation.create({ data: { landedCostVoucherId: doc.id, purchaseReceiptItemId: item.id, amount: share } });
        await tx.purchaseReceiptItem.update({ where: { id: item.id }, data: { landedCostShare: { increment: share }, valuationRate: new D(item.valuationRate || item.rate || 0).plus(new D(item.acceptedQty || 1).gt(0) ? share.div(item.acceptedQty || 1) : 0) } });
      }
      await tx.purchaseReceipt.update({ where: { id: doc.purchaseReceiptId }, data: { landedCostAmount: { increment: doc.totalCharges } } });
      await tx.landedCostVoucher.update({ where: { id: doc.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    });
    return success(res, await (prisma as any).landedCostVoucher.findUnique({ where: { id: req.params.id }, include: { purchaseReceipt: true, charges: true, allocations: true } }), 'Landed cost submitted');
  } catch (err: any) { return handlePrismaError(res, err); }
};

export const getPurchaseInvoices = async (req: Request, res: Response) => list(res, 'purchaseInvoice', req, req.query.status ? { status: req.query.status } : {}, purchaseInvoiceInclude);
export const createPurchaseInvoice = async (req: Request, res: Response) => {
  try {
    const settings = await buyingSettings();
    if ((settings as any).requirePurchaseOrderForInvoice && !req.body.purchaseOrderId) return error(res, 'Purchase Order is required before Purchase Invoice', 400);
    if ((settings as any).requirePurchaseReceiptForInvoice && !req.body.purchaseReceiptId) return error(res, 'Purchase Receipt is required before Purchase Invoice', 400);
    const items = purchaseInvoiceItems(req.body.items);
    if (!req.body.supplierId || !items.length) return error(res, 'Supplier and at least one invoice item are required', 400);
    const supplier = await prisma.supplier.findUnique({ where: { id: req.body.supplierId } });
    if (!supplier) return error(res, 'Supplier not found', 404);
    if (req.body.supplierInvoiceNo) {
      const duplicate = await prisma.purchaseInvoice.findFirst({ where: { supplierId: supplier.id, supplierInvoiceNo: req.body.supplierInvoiceNo } });
      if (duplicate) return error(res, 'This vendor invoice number already exists for the supplier', 409);
    }
    const totals = documentTotals(items, req.body.discount, req.body.shippingAmount, req.body.exchangeRate || 1);
    const invoiceDate = req.body.date ? new Date(req.body.date) : new Date();
    const msmeDue = new Date(invoiceDate.getTime() + Number((settings as any).msmePaymentDays || 45) * 86400000);
    const requestedDue = req.body.dueDate ? new Date(req.body.dueDate) : undefined;
    const dueDate = supplier.msmeRegistered && (!requestedDue || requestedDue > msmeDue) ? msmeDue : requestedDue;
    const lowerRateValid = supplier.lowerDeductionRate != null && (!supplier.lowerDeductionValidUntil || supplier.lowerDeductionValidUntil >= invoiceDate);
    const tdsRate = lowerRateValid ? supplier.lowerDeductionRate! : supplier.panAvailable ? supplier.tdsRate || 0 : Math.max(Number(supplier.tdsRate || 0), 20);
    const thresholdMet = !supplier.tdsThreshold || totals.baseTotal.gte(supplier.tdsThreshold);
    const tdsAmount = thresholdMet ? totals.baseTotal.mul(tdsRate).div(100) : new D(0);
    const inv = await prisma.purchaseInvoice.create({ data: {
      invoiceNo: await generatePurchaseInvoiceNo(), supplierId: req.body.supplierId,
      supplierInvoiceNo: req.body.supplierInvoiceNo || undefined,
      purchaseOrderId: req.body.purchaseOrderId || undefined, purchaseReceiptId: req.body.purchaseReceiptId || undefined,
      date: invoiceDate, dueDate,
      subtotal: Number(totals.subtotal), taxAmount: Number(totals.taxAmount), shippingAmount: Number(totals.shippingAmount),
      discount: Number(req.body.discount || 0), total: Number(totals.total), baseTotal: totals.baseTotal,
      outstandingAmount: totals.total, currency: req.body.currency || 'INR', exchangeRate: req.body.exchangeRate || 1,
      costCenterId: req.body.costCenterId || undefined, projectId: req.body.projectId || undefined,
      tdsSection: supplier.tdsSection || undefined, tdsRate, tdsAmount,
      reverseCharge: req.body.reverseCharge ?? supplier.reverseChargeApplicable,
      itcEligibility: req.body.itcEligibility || supplier.defaultItcEligibility,
      blockedItcReason: req.body.blockedItcReason || undefined,
      importPurchase: req.body.importPurchase ?? supplier.isImportSupplier,
      billOfEntryNo: req.body.billOfEntryNo || undefined,
      billOfEntryDate: req.body.billOfEntryDate ? new Date(req.body.billOfEntryDate) : undefined,
      customsDuty: req.body.customsDuty || 0, freightAmount: req.body.freightAmount || req.body.shippingAmount || 0,
      notes: req.body.notes || req.body.terms || undefined, items: { create: items },
    } as any, include: purchaseInvoiceInclude });
    return success(res, inv, 'Purchase invoice created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};
export const updatePurchaseInvoiceStatus = async (req: Request, res: Response) => {
  try {
    if (req.body.status === 'SENT' || req.body.status === 'SUBMITTED') return success(res, await submitPurchaseInvoice(req.params.id), 'Purchase invoice submitted');
    if (req.body.status === 'CANCELLED') return success(res, await cancelVoucher('purchaseInvoice', req.params.id, 'PURCHASE_INVOICE'), 'Purchase invoice cancelled');
    return success(res, await prisma.purchaseInvoice.update({ where: { id: req.params.id }, data: { status: req.body.status, amountPaid: req.body.amountPaid || undefined } }), 'Purchase invoice updated');
  } catch (err: any) { return error(res, err.message || 'Failed', 400); }
};
export const deletePurchaseInvoice = async (req: Request, res: Response) => {
  try { await prisma.purchaseInvoice.delete({ where: { id: req.params.id } }); return success(res, null, 'Purchase invoice deleted'); }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getSupplierPayments = async (req: Request, res: Response) => list(res, 'supplierPayment', req, req.query.supplierId ? { supplierId: req.query.supplierId } : {}, { supplier: true, purchaseOrder: true, purchaseInvoice: true });
export const createSupplierPayment = async (req: Request, res: Response) => {
  try {
    const amount = new D(req.body.amount || 0);
    if (!req.body.supplierId || amount.lte(0)) return error(res, 'Supplier and a positive payment amount are required', 400);
    if (req.body.type === 'INVOICE_PAYMENT' && !req.body.purchaseInvoiceId) return error(res, 'Select a purchase invoice or change the payment type to Advance', 400);
    if (req.body.purchaseInvoiceId) {
      const invoice = await prisma.purchaseInvoice.findFirst({ where: { id: req.body.purchaseInvoiceId } });
      if (!invoice) return error(res, 'The selected purchase invoice does not exist', 400);
      if (invoice.supplierId !== req.body.supplierId) return error(res, 'The selected invoice belongs to a different supplier', 400);
      if (['PAID', 'CANCELLED'].includes(invoice.status)) return error(res, `Cannot pay an invoice with status ${invoice.status}`, 400);
      if (amount.gt(invoice.outstandingAmount || invoice.total)) return error(res, 'Payment amount cannot exceed the invoice outstanding amount', 400);
    }
    const doc = await (prisma as any).supplierPayment.create({ data: {
      paymentNo: await nextNo('supplierPayment', 'paymentNo', 'SPAY'), supplierId: req.body.supplierId,
      purchaseOrderId: req.body.purchaseOrderId || undefined, purchaseInvoiceId: req.body.purchaseInvoiceId || undefined,
      type: req.body.type || 'INVOICE_PAYMENT', date: req.body.date ? new Date(req.body.date) : new Date(), amount,
      unallocatedAmount: amount, currency: req.body.currency || 'INR', exchangeRate: req.body.exchangeRate || 1,
      method: req.body.method || 'BANK_TRANSFER', reference: req.body.reference || undefined,
      notes: req.body.notes || req.body.terms || undefined,
    }, include: { supplier: true, purchaseOrder: true, purchaseInvoice: true } });
    return success(res, doc, 'Supplier payment created', 201);
  } catch (err: any) { return handlePrismaError(res, err); }
};
export const updateSupplierPaymentStatus = async (req: Request, res: Response) => {
  try {
    if (req.body.status === 'SUBMITTED') return success(res, await postSupplierPayment(req.params.id), 'Supplier payment submitted');
    if (req.body.status === 'CANCELLED') return success(res, await cancelVoucher('supplierPayment', req.params.id, 'SUPPLIER_PAYMENT'), 'Supplier payment cancelled');
    return success(res, await (prisma as any).supplierPayment.update({ where: { id: req.params.id }, data: { status: req.body.status } }), 'Supplier payment updated');
  } catch (err: any) { return error(res, err.message || 'Failed', 400); }
};

export const addSupplierCommunication = async (req: Request, res: Response) => {
  try {
    if (!req.body.message) return error(res, 'Communication message is required', 400);
    return success(res, await (prisma as any).supplierCommunicationLog.create({ data: {
      supplierId: req.body.supplierId || undefined, rfqId: req.body.rfqId || undefined,
      supplierQuotationId: req.body.supplierQuotationId || undefined, channel: req.body.channel || 'EMAIL',
      subject: req.body.subject || undefined, message: req.body.message, direction: req.body.direction || 'OUTBOUND',
      sentAt: req.body.sentAt ? new Date(req.body.sentAt) : new Date(), createdById: (req as any).user?.id,
    } }), 'Communication logged', 201);
  }
  catch (err: any) { return handlePrismaError(res, err); }
};

export const getSupplierCommunications = async (req: Request, res: Response) => {
  try {
    const p = page(req);
    const where = req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {};
    const [items, total] = await Promise.all([
      (prisma as any).supplierCommunicationLog.findMany({ where, orderBy: { sentAt: 'desc' }, skip: (p.page - 1) * p.limit, take: p.limit }),
      (prisma as any).supplierCommunicationLog.count({ where }),
    ]);
    return paginated(res, items, total, p.page, p.limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getProcurementTracker = async (req: Request, res: Response) => {
  try {
    const supplierId = req.query.supplierId as string | undefined;
    const orders = await prisma.purchaseOrder.findMany({ where: supplierId ? { supplierId } : {}, include: poInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return success(res, orders.map((po: any) => ({
      id: po.id,
      supplier: po.supplier?.name,
      orderNo: po.orderNo,
      status: po.status,
      date: po.date,
      expectedDate: po.expectedDate,
      materialRequest: po.materialRequestId,
      rfq: po.rfqId,
      supplierQuotation: po.supplierQuotationId,
      receivedPercent: po.receivedPercent,
      billedPercent: po.billedPercent,
      total: po.total,
      advancePaid: po.advancePaid,
      receipts: po.receipts?.length || 0,
      invoices: po.invoices?.length || 0,
      payments: po.payments?.length || 0,
      items: po.items?.map((item: any) => ({
        product: item.product?.name,
        sku: item.product?.sku,
        ordered: Number(item.quantity),
        received: Number(item.acceptedQty || 0),
        pending: Math.max(0, Number(item.quantity) - Number(item.acceptedQty || 0) - Number(item.shortClosedQty || 0)),
        uom: item.uom,
      })) || [],
    })));
  } catch (err: any) { return handlePrismaError(res, err); }
};
