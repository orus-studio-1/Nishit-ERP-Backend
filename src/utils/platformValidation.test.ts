import { describe, expect, it } from 'vitest';
import { businessDate, gstinIsValid, money, quantity, rate } from './platformValidation';

describe('platform scalar conventions', () => {
  it('uses declared decimal scales without floating point arithmetic', () => {
    expect(money('1.23456').toString()).toBe('1.2346');
    expect(quantity('1.2345678').toString()).toBe('1.234568');
    expect(rate('18.1234567').toString()).toBe('18.123457');
  });
  it('accepts only timezone-free business dates', () => {
    expect(businessDate('2026-03-31')).toBe('2026-03-31');
    expect(() => businessDate('2026-03-31T00:00:00Z')).toThrow('BUSINESS_DATE_INVALID');
  });
  it('validates GSTIN shape', () => {
    expect(gstinIsValid('27AAPFU0939F1ZV')).toBe(true);
    expect(gstinIsValid('invalid')).toBe(false);
  });
});
