import { describe, expect, it } from 'vitest';
import { calculateOpportunityItems, csvToObjects, normalizeEmail, normalizeLeadRow, normalizePhone, validateLead } from './shared';

describe('CRM normalization and import validation', () => {
  it('normalizes Unicode email casing and Indian mobile numbers', () => {
    expect(normalizeEmail('  SALES@Example.COM ')).toBe('sales@example.com');
    expect(normalizePhone('09876 543210', 'IN')).toBe('+919876543210');
    expect(normalizePhone('+91-98765-43210', 'India')).toBe('+919876543210');
  });

  it('parses quoted CSV rows and validates normalized leads', () => {
    const [row] = csvToObjects('firstName,lastName,email,company\n"Asha","Rao","ASHA@EXAMPLE.COM","Acme, India"');
    const lead = normalizeLeadRow(row.raw);
    expect(lead.email).toBe('asha@example.com');
    expect(lead.company).toBe('Acme, India');
    expect(validateLead(lead)).toBeNull();
  });

  it('calculates weighted opportunity line totals', () => {
    const result = calculateOpportunityItems([{ description: 'Service', quantity: 2, rate: 100, discount: 10, taxRate: 18 }]);
    expect(result.total).toBe(212.4);
    expect(result.lines[0].amount.toNumber()).toBe(212.4);
  });
});
