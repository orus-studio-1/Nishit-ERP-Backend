import { Prisma } from '@prisma/client';

export type QuotationCompanySnapshot = {
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  logo?: string | null;
  signature?: string | null;
  bankDetails?: string;
};

export function quotationDefaults(company: any) {
  const defaults = (company?.quotationDefaults as Record<string, any> | null) || {};
  return {
    companySnapshot: company ? {
      name: company.name,
      legalName: company.legalName,
      gstin: company.gstin,
      address: company.address,
      city: company.city,
      state: company.state,
      country: company.country,
      zip: company.zip,
      logo: company.logo,
      signature: defaults.signature || null,
      bankDetails: defaults.bankDetails || '',
    } satisfies QuotationCompanySnapshot : undefined,
    terms: String(defaults.terms || ''),
    deliveryTerms: String(defaults.deliveryTerms || ''),
    deliveryChargesNote: String(defaults.deliveryChargesNote || ''),
  };
}

export const quotationGrandTotal = (subtotal: Prisma.Decimal, tax: Prisma.Decimal, discount: Prisma.Decimal, deliveryCharges: Prisma.Decimal) => subtotal.plus(tax).minus(discount).plus(deliveryCharges);
