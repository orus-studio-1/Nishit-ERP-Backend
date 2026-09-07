import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { postStockLedger } from '../inventory/stockLedger.service';
import { ensureLedgerAccount, postToLedger, reverseLedgerForVoucher } from '../accounting/ledger.service';
import { currentCompanyId } from '../../utils/tenant';
import { allocateDocumentNo } from '../../utils/generate';
import { runThreeWayMatch } from './matching.service';

const D = Prisma.Decimal;

export function lineAmount(row: any) {
  const qty = new D(row.quantity || row.receivedQty || 0);
  const rate = new D(row.rate ?? row.unitPrice ?? 0);
  const discount = new D(row.discount || 0);
  const net = qty.mul(rate).mul(new D(1).minus(discount.div(100)));
  const tax = net.mul(new D(row.taxRate || 0)).div(100);
  return { net, tax, total: net.plus(tax) };
}

export function documentTotals(items: any[] = [], discount: any = 0, shippingAmount: any = 0, exchangeRate: any = 1) {
  const subtotal = items.reduce((sum, row) => sum.plus(lineAmount(row).net), new D(0));
  const taxAmount = items.reduce((sum, row) => sum.plus(lineAmount(row).tax), new D(0));
  const shipping = new D(shippingAmount || 0);
  const total = subtotal.plus(taxAmount).plus(shipping).minus(discount || 0);
  return { subtotal, taxAmount, shippingAmount: shipping, total, baseTotal: total.mul(exchangeRate || 1) };
}

export async function nextNo(model: string, field: string, prefix: string, tx: any = prisma) {
  const documentTypes: Record<string, string> = {
    materialRequest: 'MATERIAL_REQUEST', requestForQuotation: 'REQUEST_FOR_QUOTATION', supplierQuotation: 'SUPPLIER_QUOTATION',
    blanketPurchaseOrder: 'BLANKET_PURCHASE_ORDER', purchaseReceipt: 'PURCHASE_RECEIPT', qualityInspection: 'QUALITY_INSPECTION',
    landedCostVoucher: 'LANDED_COST_VOUCHER', supplierPayment: 'SUPPLIER_PAYMENT',
  };
  const documentType = documentTypes[model];
  if (!documentType) throw new Error(`No numbering series is configured for ${model}.${field}`);
  return allocateDocumentNo(documentType, prefix, 6, tx);
}

export function normalizeItems(items: any[] = []) {
  return items.filter((item) => item.productId && Number(item.quantity || item.receivedQty || 0) > 0);
}

export function materialRequestItems(items: any[] = []) {
  return normalizeItems(items).map((item) => ({
    productId: item.productId,
    warehouseId: item.warehouseId || undefined,
    quantity: item.quantity,
    uom: item.uom || undefined,
    stockUom: item.stockUom || undefined,
    conversionFactor: item.conversionFactor || 1,
    requiredBy: item.requiredBy ? new Date(item.requiredBy) : undefined,
    description: item.description || undefined,
  }));
}

export function rfqItems(items: any[] = []) {
  return materialRequestItems(items).map(({ warehouseId: _warehouseId, ...item }) => item);
}

export function purchaseOrderItems(items: any[] = []) {
  return normalizeItems(items).map((item) => ({
    productId: item.productId,
    description: item.description || undefined,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice ?? item.rate ?? 0),
    taxRate: Number(item.taxRate || 0),
    discount: Number(item.discount || 0),
    total: Number(lineAmount({ ...item, rate: item.unitPrice ?? item.rate }).total),
    uom: item.uom || undefined,
    stockUom: item.stockUom || undefined,
    conversionFactor: item.conversionFactor || 1,
    supplierItemCode: item.supplierItemCode || undefined,
    supplierItemName: item.supplierItemName || undefined,
    categoryCode: item.categoryCode || undefined,
    hsnCode: item.hsnCode || undefined,
    make: item.make || undefined,
    quantityTolerance: item.quantityTolerance || undefined,
    expectedDate: item.expectedDate || item.deliveryDate ? new Date(item.expectedDate || item.deliveryDate) : undefined,
  }));
}

export function supplierQuotationItems(items: any[] = []) {
  return normalizeItems(items).map((item) => ({
    productId: item.productId,
    supplierItemCode: item.supplierItemCode || undefined,
    description: item.description || undefined,
    quantity: item.quantity,
    uom: item.uom || undefined,
    stockUom: item.stockUom || undefined,
    conversionFactor: item.conversionFactor || 1,
    rate: item.rate ?? item.unitPrice ?? 0,
    taxRate: item.taxRate || 0,
    discount: item.discount || 0,
    amount: lineAmount({ ...item, rate: item.rate ?? item.unitPrice }).total,
    deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : undefined,
    categoryCode: item.categoryCode || undefined,
    hsnCode: item.hsnCode || undefined,
    make: item.make || undefined,
    quantityTolerance: item.quantityTolerance || undefined,
  }));
}

export function blanketOrderItems(items: any[] = []) {
  return normalizeItems(items).map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    rate: item.rate ?? item.unitPrice ?? 0,
    uom: item.uom || undefined,
    stockUom: item.stockUom || undefined,
    conversionFactor: item.conversionFactor || 1,
  }));
}

export function purchaseReceiptItems(items: any[] = []) {
  return normalizeItems(items.map((item) => ({ ...item, quantity: item.receivedQty || item.quantity }))).map((item) => ({
    purchaseOrderItemId: item.purchaseOrderItemId || undefined,
    productId: item.productId,
    warehouseId: item.warehouseId || undefined,
    description: item.description || undefined,
    receivedQty: item.receivedQty || item.quantity,
    acceptedQty: item.acceptedQty ?? item.receivedQty ?? item.quantity,
    rejectedQty: item.rejectedQty || 0,
    rate: item.rate ?? item.unitPrice ?? 0,
    valuationRate: item.valuationRate ?? item.rate ?? item.unitPrice ?? 0,
    uom: item.uom || undefined,
    stockUom: item.stockUom || undefined,
    conversionFactor: item.conversionFactor || 1,
    batchNo: item.batchNo || undefined,
    serialNo: item.serialNo || undefined,
    supplierBatchNo: item.supplierBatchNo || undefined,
    qualityStatus: item.qualityStatus || undefined,
  }));
}

export function purchaseInvoiceItems(items: any[] = []) {
  return purchaseOrderItems(items).map(({ supplierItemCode: _code, supplierItemName: _name, ...item }) => item);
}

export async function buyingSettings() {
  const existing = await (prisma as any).buyingSettings.findFirst();
  return existing || (prisma as any).buyingSettings.create({ data: {} });
}

export async function createPurchaseReceiptFromOrder(orderId: string, body: any = {}) {
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { supplier: true, items: { include: { product: true } } } });
    if (!order) throw new Error('Purchase order not found');
    if (!['SENT', 'CONFIRMED', 'RECEIVING'].includes(order.status)) throw new Error('Only an open confirmed purchase order can be received');
    const receiptNo = await nextNo('purchaseReceipt', 'receiptNo', 'PREC', tx);
    const requested = new Map((Array.isArray(body.items) ? body.items : []).map((line: any) => [String(line.purchaseOrderItemId || line.id), line]));
    const items = order.items.flatMap((item: any) => {
      // Rejected material has arrived physically, but the supplier still owes a
      // replacement.  Supplier fulfilment is therefore based on accepted stock.
      const open = new D(item.quantity).minus(item.acceptedQty || 0).minus(item.shortClosedQty || 0);
      const input: any = requested.size ? requested.get(item.id) : null;
      if (requested.size && !input) return [];
      const accepted = new D(input?.acceptedQty ?? input?.quantity ?? input?.receivedQty ?? open);
      const rejected = new D(input?.rejectedQty || 0);
      const received = accepted.plus(rejected);
      if (accepted.lt(0) || rejected.lt(0)) throw new Error(`${item.product.name}: quantities cannot be negative`);
      if (received.gt(open)) throw new Error(`${item.product.name}: received quantity ${received} exceeds remaining ${open}`);
      if (received.lte(0)) return [];
      const warehouseId = input?.warehouseId || body.warehouseId || item.product.defaultWarehouseId;
      if (!warehouseId) throw new Error(`${item.product.name}: receiving warehouse is required`);
      return [{ purchaseOrderItemId: item.id, productId: item.productId, warehouseId, description: item.description, receivedQty: received, acceptedQty: accepted, rejectedQty: rejected, rate: item.unitPrice, valuationRate: item.unitPrice, uom: item.uom, stockUom: item.stockUom, conversionFactor: item.conversionFactor || 1, supplierBatchNo: input?.supplierBatchNo, batchNo: input?.batchNo, serialNo: input?.serialNo }];
    });
    if (!items.length) throw new Error('All purchase order items are already received');
    const totals = documentTotals(items.map((item: any) => ({ quantity: item.acceptedQty, rate: item.rate })), 0, 0, order.exchangeRate || 1);
    return tx.purchaseReceipt.create({
      data: {
        receiptNo,
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        postingDate: body.postingDate ? new Date(body.postingDate) : new Date(),
        currency: order.currency,
        exchangeRate: order.exchangeRate || 1,
        acceptedQty: items.reduce((sum: any, item: any) => sum.plus(item.acceptedQty), new D(0)),
        rejectedQty: items.reduce((sum: any, item: any) => sum.plus(item.rejectedQty), new D(0)),
        rejectedWarehouseId: items.some((item: any) => new D(item.rejectedQty).gt(0)) ? (body.rejectedWarehouseId || body.warehouseId) : undefined,
        subtotal: totals.subtotal,
        costCenterId: order.costCenterId,
        projectId: order.projectId,
        notes: body.notes,
        items: { create: items },
      },
      include: purchaseReceiptInclude,
    });
  });
}

export async function submitPurchaseReceipt(receiptId: string) {
  return prisma.$transaction(async (tx: any) => {
    const receipt = await tx.purchaseReceipt.findUnique({ where: { id: receiptId }, include: { items: { include: { product: true } }, qualityInspections: true, purchaseOrder: { include: { items: true } } } });
    if (!receipt) throw new Error('Purchase receipt not found');
    if (receipt.status !== 'DRAFT') throw new Error('Only draft purchase receipts can be submitted');
    const settings = await tx.buyingSettings.findFirst({ where: { OR: [{ companyId: receipt.companyId }, { companyId: null }] }, orderBy: { companyId: 'desc' } });
    const inspectionRequired = receipt.items.some((item: any) => item.product.receiptInspectionRequired);
    if (settings?.requireInspectionForConfiguredItems && inspectionRequired && !receipt.inspectionCompleted) throw new Error('Incoming inspection must be completed before GRN submission');
    for (const item of receipt.items) {
      const accepted = new D(item.acceptedQty || item.receivedQty || 0).mul(item.conversionFactor || 1);
      if (accepted.gt(0)) {
        await postStockLedger(tx, {
          productId: item.productId,
          warehouseId: item.warehouseId,
          actualQty: accepted,
          rate: new D(item.valuationRate || item.rate || 0),
          voucherType: 'PURCHASE_RECEIPT',
          voucherId: receipt.id,
          voucherNo: receipt.receiptNo,
          postingDate: receipt.postingDate,
          remarks: `Purchase receipt ${receipt.receiptNo}`,
        });
      }
      const rejected = new D(item.rejectedQty || 0).mul(item.conversionFactor || 1);
      if (rejected.gt(0)) {
        if (!receipt.rejectedWarehouseId) throw new Error('Rejected warehouse is required for rejected quantities');
        await postStockLedger(tx, {
          productId: item.productId, warehouseId: receipt.rejectedWarehouseId, actualQty: rejected,
          rate: new D(item.valuationRate || item.rate || 0), voucherType: 'PURCHASE_RECEIPT', voucherId: receipt.id,
          voucherNo: receipt.receiptNo, postingDate: receipt.postingDate, remarks: `Rejected stock from ${receipt.receiptNo}`,
        });
      }
      if (item.purchaseOrderItemId) {
        await tx.purchaseOrderItem.update({ where: { id: item.purchaseOrderItemId }, data: { receivedQty: { increment: accepted.plus(rejected) }, acceptedQty: { increment: accepted }, rejectedQty: { increment: rejected } } });
      }
    }
    await refreshPurchaseOrderProgress(tx, receipt.purchaseOrderId);
    return tx.purchaseReceipt.update({ where: { id: receiptId }, data: { status: 'SUBMITTED', submittedAt: new Date() }, include: purchaseReceiptInclude });
  });
}

export async function submitPurchaseInvoice(invoiceId: string) {
  const candidate = await prisma.purchaseInvoice.findUnique({ where: { id: invoiceId } });
  if (!candidate) throw new Error('Purchase invoice not found');
  const matchSettings = await prisma.buyingSettings.findFirst({ where: { OR: [{ companyId: candidate.companyId }, { companyId: null }] }, orderBy: { companyId: 'desc' } });
  if (matchSettings?.requireThreeWayMatch && candidate.matchStatus !== 'APPROVED_EXCEPTION') {
    const match = await runThreeWayMatch(invoiceId);
    if (match.status !== 'MATCHED' && match.status !== 'APPROVED_EXCEPTION') {
      throw new Error(`Invoice posting blocked by three-way match: ${JSON.stringify(match.explanation)}`);
    }
  }
  return prisma.$transaction(async (tx: any) => {
    const existing = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId }, include: { items: true } });
    if (!existing) throw new Error('Purchase invoice not found');
    if (existing.workflowStatus === 'SUBMITTED' || existing.status === 'SENT') return existing;
    const expense = await ensureLedgerAccount(tx, '5100', 'Purchase Expense / Inventory Received', 'EXPENSE');
    const ap = await ensureLedgerAccount(tx, '2000', 'Accounts Payable', 'LIABILITY', { isDefaultPayable: true });
    const tax = await ensureLedgerAccount(tx, '1300', 'Input Tax Receivable', 'ASSET', { isDefaultTax: true });
    const lines: any[] = [{ accountId: expense.id, debit: existing.subtotal || 0, credit: 0, partyType: 'SUPPLIER', partyId: existing.supplierId, costCenterId: existing.costCenterId, remarks: `${existing.invoiceNo} purchase` }];
    if (Number(existing.taxAmount || 0) > 0) lines.push({ accountId: tax.id, debit: existing.taxAmount, credit: 0, partyType: 'SUPPLIER', partyId: existing.supplierId, costCenterId: existing.costCenterId, taxType: 'INPUT', remarks: `${existing.invoiceNo} input tax` });
    lines.push({ accountId: ap.id, debit: 0, credit: existing.total || 0, partyType: 'SUPPLIER', partyId: existing.supplierId, costCenterId: existing.costCenterId, remarks: `${existing.invoiceNo} payable` });
    await postToLedger(tx, { voucherType: 'PURCHASE_INVOICE', voucherId: existing.id, voucherNo: existing.invoiceNo, postingDate: existing.date, lines });
    await refreshPurchaseOrderProgress(tx, existing.purchaseOrderId);
    return tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { workflowStatus: 'SUBMITTED', status: 'SENT', submittedAt: new Date(), outstandingAmount: existing.total || 0 } });
  });
}

export async function refreshPurchaseOrderProgress(tx: any, purchaseOrderId?: string | null) {
  if (!purchaseOrderId) return;
  const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { items: true, invoices: true } });
  if (!po) return;
  const ordered = po.items.reduce((sum: any, item: any) => sum.plus(item.quantity || 0), new D(0));
  const received = po.items.reduce((sum: any, item: any) => sum.plus(item.acceptedQty || 0).plus(item.shortClosedQty || 0), new D(0));
  const billed = po.invoices.reduce((sum: any, inv: any) => sum.plus(inv.total || 0), new D(0));
  const total = new D(po.total || 0);
  const receivedPercent = ordered.gt(0) ? received.div(ordered).mul(100) : 0;
  const billedPercent = total.gt(0) ? billed.div(total).mul(100) : 0;
  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      receivedPercent,
      billedPercent,
      status: new D(receivedPercent).gte(100) ? 'RECEIVED' : new D(receivedPercent).gt(0) ? 'RECEIVING' : po.status,
    },
  });
}

export async function postSupplierPayment(paymentId: string) {
  return prisma.$transaction(async (tx: any) => {
    const payment = await tx.supplierPayment.findUnique({ where: { id: paymentId }, include: { purchaseInvoice: true, purchaseOrder: true } });
    if (!payment) throw new Error('Supplier payment not found');
    if (payment.status !== 'DRAFT') throw new Error('Only draft supplier payments can be submitted');
    if (!payment.supplierId) throw new Error('Supplier payment has no supplier');
    if (payment.purchaseInvoiceId && !payment.purchaseInvoice) throw new Error('The linked purchase invoice no longer exists or is not accessible');
    if (payment.purchaseOrderId && !payment.purchaseOrder) throw new Error('The linked purchase order no longer exists or is not accessible');
    const bank = await ensureLedgerAccount(tx, '1000', 'Cash / Bank', 'ASSET');
    const ap = await ensureLedgerAccount(tx, '2000', 'Accounts Payable', 'LIABILITY', { isDefaultPayable: true });
    await postToLedger(tx, {
      voucherType: 'SUPPLIER_PAYMENT',
      voucherId: payment.id,
      voucherNo: payment.paymentNo,
      postingDate: payment.date,
      lines: [
        { accountId: ap.id, debit: payment.amount, credit: 0, partyType: 'SUPPLIER', partyId: payment.supplierId, remarks: payment.type === 'ADVANCE' ? 'Supplier advance' : 'Supplier invoice payment' },
        { accountId: bank.id, debit: 0, credit: payment.amount, partyType: 'SUPPLIER', partyId: payment.supplierId, remarks: payment.reference },
      ],
    });
    if (payment.purchaseInvoiceId) {
      const invoice = payment.purchaseInvoice;
      if (invoice.supplierId !== payment.supplierId) throw new Error('Payment supplier does not match the linked purchase invoice supplier');
      const paid = new D(invoice.amountPaid || 0).plus(payment.amount);
      const outstanding = D.max(new D(invoice.total || 0).minus(paid), new D(0));
      await tx.purchaseInvoice.update({ where: { id: payment.purchaseInvoiceId }, data: { amountPaid: Number(paid.toString()), outstandingAmount: outstanding, status: outstanding.eq(0) ? 'PAID' : 'PARTIAL' } });
    }
    if (payment.purchaseOrderId && payment.type === 'ADVANCE') {
      await tx.purchaseOrder.update({ where: { id: payment.purchaseOrderId }, data: { advancePaid: { increment: payment.amount } } });
    }
    return tx.supplierPayment.update({ where: { id: payment.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), allocatedAmount: payment.purchaseInvoiceId || payment.purchaseOrderId ? payment.amount : 0, unallocatedAmount: payment.purchaseInvoiceId || payment.purchaseOrderId ? 0 : payment.amount } });
  });
}

export async function cancelVoucher(model: string, id: string, voucherType?: any) {
  return prisma.$transaction(async (tx: any) => {
    const doc = await tx[model].findUnique({ where: { id } });
    if (!doc) throw new Error('Document not found');
    if (voucherType) await reverseLedgerForVoucher(tx, voucherType, id, new Date());
    return tx[model].update({ where: { id }, data: { status: 'CANCELLED', workflowStatus: model === 'purchaseInvoice' ? 'CANCELLED' : undefined, cancelledAt: new Date() } });
  });
}

export const poInclude = { supplier: true, items: { include: { product: true } }, invoices: true, receipts: true, payments: true };
export const purchaseReceiptInclude = { supplier: true, purchaseOrder: true, items: { include: { product: true, warehouse: true } }, qualityInspections: true, landedCostVouchers: true };
export const purchaseInvoiceInclude = { supplier: true, purchaseOrder: true, purchaseReceipt: true, items: { include: { product: true } }, payments: true };
