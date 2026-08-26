import { describe, expect, it } from 'vitest';
import { determineSalesTax, gstStateCode } from './tax.service';

describe('sales GST determination', () => {
  it('extracts only valid GST state codes', () => {
    expect(gstStateCode('27ABCDE1234F1Z5')).toBe('27');
    expect(gstStateCode('invalid')).toBeNull();
  });

  it('uses split GST for intrastate supply', () => {
    expect(determineSalesTax({ supplierGstin: '27ABCDE1234F1Z5', customerGstin: '27AAAAA0000A1Z5' }).taxMode).toBe('CGST_SGST');
  });

  it('uses IGST for interstate supply', () => {
    expect(determineSalesTax({ supplierGstin: '27ABCDE1234F1Z5', customerGstin: '29AAAAA0000A1Z5' }).taxMode).toBe('IGST');
  });

  it('handles export and SEZ before state comparison', () => {
    expect(determineSalesTax({ customerCountry: 'United States' }).taxMode).toBe('EXPORT');
    expect(determineSalesTax({ isSez: true, customerGstin: '29AAAAA0000A1Z5' }).taxMode).toBe('SEZ');
  });
});
