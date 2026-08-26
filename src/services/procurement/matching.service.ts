import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

const D = Prisma.Decimal;
const percent = (difference: Prisma.Decimal, base: Prisma.Decimal) => base.abs().gt(0) ? difference.abs().div(base.abs()).mul(100) : difference.eq(0) ? new D(0) : new D(100);

export async function runThreeWayMatch(invoiceId: string, tx: any = prisma) {
  const invoice = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId }, include: { items: true, purchaseOrder: { include: { items: true } }, purchaseReceipt: { include: { items: true } } } });
  if (!invoice) throw new Error('Purchase invoice not found');
  if (!invoice.purchaseOrder || !invoice.purchaseReceipt) throw new Error('Three-way match requires both purchase order and GRN');
  const settings = await tx.buyingSettings.findFirst({ where: { OR: [{ companyId: invoice.companyId }, { companyId: null }] }, orderBy: { companyId: 'desc' } }) || { rateTolerancePercent: 0, quantityTolerancePercent: 0, taxTolerancePercent: 0 };
  const rateTolerance = new D(settings.rateTolerancePercent || 0), quantityTolerance = new D(settings.quantityTolerancePercent || 0), taxTolerance = new D(settings.taxTolerancePercent || 0);
  const lines = invoice.items.map((line: any) => {
    const po = invoice.purchaseOrder.items.find((item: any) => item.productId === line.productId);
    const receipts = invoice.purchaseReceipt.items.filter((item: any) => item.productId === line.productId);
    const poQty = new D(po?.quantity || 0), poRate = new D(po?.unitPrice || 0), grnAcceptedQty = receipts.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.acceptedQty || 0), new D(0));
    const invoiceQty = new D(line.quantity || 0), invoiceRate = new D(line.unitPrice || 0), poTaxRate = new D(po?.taxRate || 0), invoiceTaxRate = new D(line.taxRate || 0);
    const quantityVariance = invoiceQty.minus(grnAcceptedQty), rateVariance = invoiceRate.minus(poRate), taxVariance = invoiceTaxRate.minus(poTaxRate);
    const problems: string[] = [];
    if (!po) problems.push('Item is not on purchase order');
    if (percent(quantityVariance, grnAcceptedQty).gt(quantityTolerance)) problems.push(`Quantity variance ${quantityVariance}`);
    if (percent(rateVariance, poRate).gt(rateTolerance)) problems.push(`Rate variance ${rateVariance}`);
    if (taxVariance.abs().gt(taxTolerance)) problems.push(`Tax variance ${taxVariance}%`);
    return { productId: line.productId, poQty, poRate, grnAcceptedQty, invoiceQty, invoiceRate, poTaxRate, invoiceTaxRate, quantityVariance, rateVariance, taxVariance, matched: problems.length === 0, explanation: problems.join('; ') || 'Matched within tolerance' };
  });
  const freightVariance = new D(invoice.freightAmount || invoice.shippingAmount || 0).minus(invoice.purchaseOrder.shippingAmount || 0);
  const status = lines.every((line: any) => line.matched) ? 'MATCHED' : 'EXCEPTION';
  const explanation = { status, freightVariance: freightVariance.toString(), exceptions: lines.filter((line: any) => !line.matched).map((line: any) => ({ productId: line.productId, explanation: line.explanation })) };
  const match = await tx.procurementThreeWayMatch.upsert({ where: { purchaseInvoiceId: invoice.id }, update: { purchaseOrderId: invoice.purchaseOrder.id, purchaseReceiptId: invoice.purchaseReceipt.id, status, rateTolerance, quantityTolerance, taxTolerance, freightVariance, explanation, lines: { deleteMany: {}, create: lines } }, create: { matchNo: `MATCH-${Date.now()}`, companyId: invoice.companyId, purchaseInvoiceId: invoice.id, purchaseOrderId: invoice.purchaseOrder.id, purchaseReceiptId: invoice.purchaseReceipt.id, status, rateTolerance, quantityTolerance, taxTolerance, freightVariance, explanation, lines: { create: lines } }, include: { lines: true } });
  await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { matchId: match.id, matchStatus: status, postingBlocked: status !== 'MATCHED' } });
  return match;
}
