// Lets a user provide or change the billing type of a purchase invoice, and optionally of individual lines.
// Billing type is classification only: it does not touch accounting, so it can be set on any invoice,
// including one already submitted. A line without its own billing type uses the invoice's.
// This never recalculates anything. Any submitted invoice can change scheme results, so the response flags
// recalculationRecommended for those.

import prisma from '../../lib/prisma';
import { IncentiveNotFoundError, IncentiveValidationError, TRADE_TYPES, type TradeType } from './incentiveScheme.service';

export interface BillingTypeInput {
  /** Invoice billing type. null clears it. Omit to leave unchanged. */
  tradeType?: string | null;
  /** Per-line billing types. null clears the line override (the line then follows the invoice). */
  items?: Array<{ itemId: string; tradeType: string | null }>;
}

function parseType(value: unknown, field: string): TradeType | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !(TRADE_TYPES as readonly string[]).includes(value)) {
    throw new IncentiveValidationError(`${field} must be null or one of: ${TRADE_TYPES.join(', ')}`);
  }
  return value as TradeType;
}

export async function setInvoiceBillingType(invoiceId: string, body: BillingTypeInput) {
  const hasHeader = body.tradeType !== undefined;
  const lineChanges = body.items ?? [];
  if (!hasHeader && lineChanges.length === 0) throw new IncentiveValidationError('Provide tradeType and/or items');
  if (!Array.isArray(lineChanges)) throw new IncentiveValidationError('items must be a list');

  const headerType = hasHeader ? parseType(body.tradeType, 'tradeType') : undefined;
  const parsedLines = lineChanges.map((line, i) => {
    if (!line || typeof line.itemId !== 'string' || !line.itemId) throw new IncentiveValidationError(`items[${i}].itemId is required`);
    return { itemId: line.itemId, tradeType: parseType(line.tradeType, `items[${i}].tradeType`) };
  });

  // Tenant scoped: an invoice from another company is simply not found.
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id: invoiceId }, select: { id: true, items: { select: { id: true } } } });
  if (!invoice) throw new IncentiveNotFoundError('Purchase invoice not found');
  const ownItems = new Set(invoice.items.map((i) => i.id));
  const foreign = parsedLines.filter((l) => !ownItems.has(l.itemId)).map((l) => l.itemId);
  if (foreign.length) throw new IncentiveValidationError(`Item(s) do not belong to this invoice: ${foreign.join(', ')}`);

  await prisma.$transaction(async (tx: any) => {
    if (hasHeader) await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { tradeType: headerType } });
    for (const line of parsedLines) await tx.purchaseInvoiceItem.update({ where: { id: line.itemId }, data: { tradeType: line.tradeType } });
  });

  const updated = await prisma.purchaseInvoice.findFirst({
    where: { id: invoiceId },
    select: { id: true, invoiceNo: true, workflowStatus: true, tradeType: true, items: { select: { id: true, tradeType: true } } },
  });
  return { invoice: updated, recalculationRecommended: updated?.workflowStatus === 'SUBMITTED' };
}
