import { Prisma } from '@prisma/client';

export const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(4);
export const quantity = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6);
export const rate = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6);
export const businessDate = (value: unknown) => {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('BUSINESS_DATE_INVALID');
  return raw;
};
export const gstinIsValid = (value: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(value || '').toUpperCase());
export const sanitizeFields = (fields: string[], allowed: string[]) => fields.filter((field) => allowed.includes(field));
