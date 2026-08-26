export type SalesTaxMode = 'CGST_SGST' | 'IGST' | 'EXPORT' | 'SEZ' | 'NONE';

export function gstStateCode(gstin?: string | null) {
  const value = String(gstin || '').trim().toUpperCase();
  return /^\d{2}[A-Z0-9]{13}$/.test(value) ? value.slice(0, 2) : null;
}

export function determineSalesTax(input: { supplierGstin?: string | null; customerGstin?: string | null; customerCountry?: string | null; isSez?: boolean; isExport?: boolean }) {
  if (input.isSez) return { taxMode: 'SEZ' as SalesTaxMode, placeOfSupply: gstStateCode(input.customerGstin) };
  if (input.isExport || (input.customerCountry && !['INDIA', 'IN'].includes(input.customerCountry.trim().toUpperCase()))) return { taxMode: 'EXPORT' as SalesTaxMode, placeOfSupply: null };
  const supplierState = gstStateCode(input.supplierGstin);
  const customerState = gstStateCode(input.customerGstin);
  if (!supplierState || !customerState) return { taxMode: 'NONE' as SalesTaxMode, placeOfSupply: customerState };
  return { taxMode: supplierState === customerState ? 'CGST_SGST' as SalesTaxMode : 'IGST' as SalesTaxMode, placeOfSupply: customerState };
}
