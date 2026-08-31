import { Prisma } from '@prisma/client';

export const leadInclude = {
  organization: true,
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  activities: {
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  contacts: { include: { organization: true }, orderBy: { createdAt: 'desc' as const } },
  opportunity: { include: { contact: true, organization: true, customer: true, quotation: true, salesOrder: true } },
};

export const opportunityInclude = {
  organization: true,
  contact: true,
  lead: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
  customer: { select: { id: true, customerNo: true, name: true } },
  quotation: { select: { id: true, quotationNo: true, status: true, total: true } },
  salesOrder: { select: { id: true, orderNo: true, status: true, total: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, salePrice: true, taxRate: true } } } },
  activities: {
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
};

export function normalizeEmail(email?: string | null) {
  return String(email || '').normalize('NFKC').trim().toLowerCase() || null;
}

export function normalizePhone(phone?: string | null, country?: string | null) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const code = String(country || '').trim().toUpperCase();
  if ((code === 'IN' || code === 'IND' || code === 'INDIA') && digits.length === 10) digits = `91${digits}`;
  if ((code === 'IN' || code === 'IND' || code === 'INDIA') && digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  return digits ? `+${digits}` : null;
}

export function titleFromLead(row: any) {
  return row.title || [row.firstName, row.lastName, row.company].filter(Boolean).join(' - ') || 'Untitled lead';
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function csvToObjects(text: string) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  return rows.map((values, index) => {
    const raw: any = {};
    headers.forEach((header, i) => { raw[header] = values[i] || ''; });
    return { rowNo: index + 2, raw };
  });
}

export function normalizeLeadRow(raw: any) {
  const firstName = raw.firstName || raw.firstname || raw.first || raw.name?.split(' ')?.[0] || '';
  const lastName = raw.lastName || raw.lastname || raw.last || raw.name?.split(' ')?.slice(1).join(' ') || '';
  const email = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone || raw.mobile, raw.country);
  return {
    title: raw.title || [firstName, lastName, raw.company].filter(Boolean).join(' - '),
    firstName,
    lastName,
    email,
    phone,
    company: raw.company || raw.organization || '',
    city: raw.city || '',
    country: raw.country || '',
    source: raw.source || 'CSV_IMPORT',
    status: raw.status || 'NEW',
    priority: raw.priority || 'MEDIUM',
    value: raw.value ? Number(raw.value) : undefined,
    notes: raw.notes || raw.note || '',
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
      : raw.tags ? String(raw.tags).split(/[|;,]/).map((t) => t.trim()).filter(Boolean) : [],
  };
}

export function validateLead(row: any) {
  if (!row.firstName && !row.lastName && !row.company) return 'Provide a name or company';
  if (!row.email && !row.phone) return 'Provide email or phone';
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return 'Invalid email';
  return null;
}

export async function findDuplicateLead(tx: any, row: any) {
  const OR = [];
  if (row.email) OR.push({ normalizedEmail: normalizeEmail(row.email) });
  if (row.phone) OR.push({ normalizedPhone: String(row.phone).replace(/\D/g, '') });
  if (!OR.length) return null;
  return tx.lead.findFirst({ where: { OR, mergedIntoId: null, ...(row.companyId ? { companyId: row.companyId } : {}) }, select: { id: true, title: true, email: true, phone: true } });
}

export async function ensureOrganization(tx: any, row: any, companyId?: string | null, ownerId?: string | null) {
  const name = String(row.company || row.organizationName || '').trim();
  if (!name) return null;
  const existing = await tx.crmOrganization.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, companyId: companyId || undefined } });
  if (existing) return existing;
  return tx.crmOrganization.create({ data: { name, companyId, ownerId, email: row.email, phone: row.phone, city: row.city, country: row.country } });
}

function normalizedMatch(value?: string | null, expected?: string | null) {
  if (!expected) return true;
  return String(value || '').trim().toLowerCase() === String(expected).trim().toLowerCase();
}

export async function resolveLeadAssignee(tx: any, row: any, companyId?: string | null, fallbackUserId?: string | null) {
  const rules = await tx.crmAssignmentRule.findMany({
    where: {
      isActive: true,
      OR: [{ companyId: companyId || undefined }, { companyId: null }],
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  const value = row.value === undefined || row.value === null || row.value === '' ? null : Number(row.value);
  const match = rules.find((rule: any) => {
    if (rule.source && rule.source !== row.source) return false;
    if (!normalizedMatch(row.city, rule.city)) return false;
    if (!normalizedMatch(row.country, rule.country)) return false;
    if (!normalizedMatch(row.territory, rule.territory)) return false;
    if (rule.branchId && rule.branchId !== row.branchId) return false;
    if (rule.productId && rule.productId !== row.productId && rule.productId !== row.productInterest) return false;
    if (rule.minValue !== null && value !== null && value < Number(rule.minValue)) return false;
    if (rule.minValue !== null && value === null) return false;
    if (rule.maxValue !== null && value !== null && value > Number(rule.maxValue)) return false;
    if (rule.maxValue !== null && value === null) return false;
    return true;
  });
  if (match?.assignToId) return match.assignToId;
  const queue = companyId ? await tx.platformSetting.findFirst({ where: { companyId, namespace: 'crm', key: 'defaultQueueUserId' }, orderBy: { updatedAt: 'desc' } }) : null;
  return (typeof queue?.value === 'string' ? queue.value : null) || fallbackUserId || null;
}

export async function logCrmActivity(tx: any, userId: string, data: any) {
  return tx.activity.create({
    data: {
      type: data.type,
      subject: data.subject,
      description: data.description,
      status: data.status || 'COMPLETED',
      completedAt: data.completedAt || new Date(),
      metadata: data.metadata,
      organizationId: data.organizationId,
      leadId: data.leadId,
      contactId: data.contactId,
      opportunityId: data.opportunityId,
      userId,
    },
  });
}

export function calculateOpportunityItems(items: any[] = []) {
  let total = new Prisma.Decimal(0);
  const lines = items.map((item) => {
    const quantity = new Prisma.Decimal(item.quantity || 1);
    const rate = new Prisma.Decimal(item.rate || item.unitPrice || 0);
    const discount = new Prisma.Decimal(item.discount || 0);
    const taxRate = new Prisma.Decimal(item.taxRate || 0);
    const net = quantity.mul(rate).mul(new Prisma.Decimal(1).minus(discount.div(100)));
    const amount = net.plus(net.mul(taxRate.div(100)));
    total = total.plus(amount);
    return {
      productId: item.productId || undefined,
      itemCode: item.itemCode || undefined,
      description: item.description || item.name || 'Opportunity item',
      quantity,
      rate,
      discount,
      taxRate,
      amount,
    };
  });
  return { lines, total: Number(total.toFixed(2)) };
}
