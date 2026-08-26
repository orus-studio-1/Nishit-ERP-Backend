import { describe, expect, it } from 'vitest';
import { calculateInvoiceTotals } from './invoice';

describe('sales-order invoice line integrity', () => {
  it('preserves the exact sales-order item reference for partial billing', () => {
    const totals = calculateInvoiceTotals([
      { salesOrderItemId: 'line-a', productId: 'product-1', quantity: 2, unitPrice: 100, taxRate: 18 },
      { salesOrderItemId: 'line-b', productId: 'product-1', quantity: 1, unitPrice: 90, taxRate: 18 },
    ]);

    expect(totals.lines.map((line) => line.salesOrderItemId)).toEqual(['line-a', 'line-b']);
    expect(totals.lines.map((line) => line.quantity.toNumber())).toEqual([2, 1]);
  });
});
