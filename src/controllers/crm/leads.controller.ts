import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';
import {
  csvToObjects,
  ensureOrganization,
  findDuplicateLead,
  leadInclude,
  logCrmActivity,
  normalizeLeadRow,
  resolveLeadAssignee,
  titleFromLead,
  validateLead,
} from './shared';
import { generateCustomerNo } from '../../utils/generate';
import { crmScopeWhere } from './scope';
import { respondPaginated } from '../../utils/pagination';

// Keep request-only controls (for example allowDuplicate) and ownership fields
// out of Prisma writes. This also prevents a newly added UI field from making
// lead creation fail with an "unknown argument" validation error.
const LEAD_WRITE_FIELDS = [
  'title', 'firstName', 'lastName', 'email', 'phone', 'company', 'city', 'country',
  'source', 'status', 'priority', 'value', 'score', 'tags', 'lostReason',
  'lostReasonId', 'territory', 'productInterest', 'campaign', 'notes', 'assignedToId',
] as const;

function leadWriteData(source: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const field of LEAD_WRITE_FIELDS) {
    if (source[field] !== undefined) data[field] = source[field];
  }
  return data;
}

async function ensureCustomerForLead(tx: any, lead: any, contact: any) {
  let customer = contact?.id ? await tx.customer.findFirst({ where: { contactId: contact.id } }) : null;
  if (!customer && lead.email) customer = await tx.customer.findFirst({ where: { email: { equals: lead.email, mode: 'insensitive' } } });
  if (customer) {
    if (!customer.contactId && contact?.id) {
      customer = await tx.customer.update({ where: { id: customer.id }, data: { contactId: contact.id } });
    }
    return customer;
  }

  const personName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return tx.customer.create({
    data: {
      customerNo: await generateCustomerNo(),
      name: lead.company?.trim() || personName || lead.title,
      email: lead.email || null,
      phone: lead.phone || null,
      contactId: contact?.id || null,
      city: lead.city || null,
      country: lead.country || null,
      notes: lead.notes || null,
      currency: 'INR',
    },
  });
}

export const getLeads = async (req: Request, res: Response) => {
  try {
    const { status, source, assignedToId, search, mine } = req.query as any;
    const where: any = await crmScopeWhere(req as AuthRequest, 'LEAD');
    if (status) where.status = status;
    if (source) where.source = source;
    if (assignedToId) where.assignedToId = assignedToId;
    if (mine === 'true' && (req as AuthRequest).user?.id) where.assignedToId = (req as AuthRequest).user!.id;
    if (search) where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    return respondPaginated(res, prisma.lead, req, {
      where,
      include: {
        organization: true,
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLead = async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...(await crmScopeWhere(req as AuthRequest, 'LEAD')) },
      include: {
        ...leadInclude,
      },
    });
    if (!lead) return error(res, 'Lead not found', 404);
    return success(res, lead);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createLead = async (req: AuthRequest, res: Response) => {
  try {
    const normalized = normalizeLeadRow(req.body);
    const validation = validateLead(normalized);
    if (validation) return error(res, validation, 400);

    const lead = await prisma.$transaction(async (tx) => {
      const duplicate = await findDuplicateLead(tx, normalized);
      if (duplicate && !req.body.allowDuplicate) throw new Error(`Duplicate lead exists for ${duplicate.email || duplicate.phone}`);
      const organization = await ensureOrganization(tx, normalized, req.user?.companyId, req.user!.id);
      const assignedToId = req.body.assignedToId || await resolveLeadAssignee(tx, normalized, req.user?.companyId, req.user!.id);
      const created = await tx.lead.create({
        data: {
          ...leadWriteData({ ...req.body, ...normalized }),
          companyId: req.user?.companyId,
          branchId: req.user?.branchId,
          normalizedEmail: normalized.email,
          normalizedPhone: normalized.phone?.replace(/\D/g, '') || null,
          title: titleFromLead({ ...req.body, ...normalized }),
          organizationId: organization?.id,
          createdById: req.user!.id,
          assignedToId,
        } as any,
        include: leadInclude,
      });
      await logCrmActivity(tx, req.user!.id, {
        type: 'NOTE',
        subject: 'Lead created',
        description: `Created lead ${created.title}`,
        leadId: created.id,
      });
      return created;
    });
    return success(res, lead, 'Lead created', 201);
  } catch (err: any) {
    if (err.message?.startsWith('Duplicate lead')) return error(res, err.message, 409);
    return handlePrismaError(res, err);
  }
};

export const updateLead = async (req: AuthRequest, res: Response) => {
  if (req.body.status === 'CONVERTED') return convertLead(req, res);
  try {
    const lead = await prisma.$transaction(async (tx) => {
      const existing = await tx.lead.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req, 'LEAD')) } });
      if (!existing) throw new Error('Lead not found');
      const organization = req.body.company ? await ensureOrganization(tx, req.body, req.user?.companyId, req.user?.id) : null;
      const data: any = leadWriteData(req.body);
      if (req.body.email !== undefined || req.body.phone !== undefined) {
        const normalized = normalizeLeadRow({ ...existing, ...req.body });
        data.email = normalized.email;
        data.phone = normalized.phone;
        data.normalizedEmail = normalized.email;
        data.normalizedPhone = normalized.phone?.replace(/\D/g, '') || null;
      }
      if (organization) data.organizationId = organization.id;
      if (req.body.status === 'QUALIFIED' && existing.status !== 'QUALIFIED') data.qualifiedAt = new Date();
      if (req.body.status === 'CONTACTED' && existing.status !== 'CONTACTED') data.lastContactedAt = new Date();
      const updated = await tx.lead.update({ where: { id: req.params.id }, data, include: leadInclude });
      if (req.body.status && req.body.status !== existing.status) {
        await logCrmActivity(tx, req.user!.id, {
          type: 'STATUS_CHANGE',
          subject: `Lead status changed to ${req.body.status}`,
          description: `${existing.status} → ${req.body.status}`,
          leadId: updated.id,
          metadata: { before: existing.status, after: req.body.status },
        });
      }
      return updated;
    });
    return success(res, lead, 'Lead updated');
  } catch (err: any) {
    if (err.message === 'Lead not found') return error(res, err.message, 404);
    return handlePrismaError(res, err);
  }
};

export const deleteLead = async (req: Request, res: Response) => {
  try {
    const deleted = await prisma.lead.deleteMany({ where: { id: req.params.id, ...(await crmScopeWhere(req as AuthRequest, 'LEAD')) } });
    if (!deleted.count) return error(res, 'Lead not found', 404);
    return success(res, null, 'Lead deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

async function createOpportunityFromLead(tx: any, req: AuthRequest, lead: any, body: any) {
  const contact = lead.contacts[0] || await tx.contact.create({
    data: {
      leadId: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      city: lead.city,
      country: lead.country,
      organizationId: lead.organizationId,
      notes: lead.notes,
    },
  });
  const customer = await ensureCustomerForLead(tx, lead, contact);
  const created = await tx.opportunity.create({
    data: {
      companyId: req.user?.companyId,
      branchId: req.user?.branchId,
      ownerId: lead.assignedToId || req.user!.id,
      title: body.title || `${lead.firstName} ${lead.lastName} - ${lead.company || 'Opportunity'}`,
      leadId: lead.id,
      contactId: contact.id,
      organizationId: lead.organizationId,
      customerId: customer.id,
      value: Number(body.value ?? lead.value ?? 0),
      currency: body.currency || 'INR',
      stage: 'QUALIFICATION',
      probability: Number(body.probability ?? 25),
      expectedClose: body.expectedClose ? new Date(body.expectedClose) : undefined,
      notes: body.notes || lead.notes,
    },
  });
  return { contact, customer, opportunity: created };
}

export const convertLead = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const opportunity = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req, 'LEAD')) }, include: { contacts: true, opportunity: true } });
      if (!lead) throw new Error('Lead not found');
      if (lead.status === 'CONVERTED') throw new Error('Lead is already converted');
      if (lead.opportunity) throw new Error('Lead already has an opportunity; use Qualify to complete its conversion');
      const { customer, opportunity: created } = await createOpportunityFromLead(tx, req, lead, body);
      await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED' } });
      await logCrmActivity(tx, req.user!.id, {
        type: 'CONVERSION',
        subject: 'Lead converted to customer and opportunity',
        description: `Created or linked customer ${customer.name} and opportunity ${created.title}`,
        leadId: lead.id,
        opportunityId: created.id,
      });
      return tx.opportunity.findUnique({ where: { id: created.id }, include: { contact: true, lead: true, organization: true, customer: true } });
    });
    return success(res, opportunity, 'Lead converted to opportunity');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const qualifyLead = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const opportunity = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req, 'LEAD')) }, include: { opportunity: true, contacts: true } });
      if (!lead) throw new Error('Lead not found');
      if (lead.opportunity) return tx.opportunity.findUnique({ where: { id: lead.opportunity.id }, include: { contact: true, lead: true, organization: true } });

      const { contact, customer, opportunity: created } = await createOpportunityFromLead(tx, req, lead, body);
      await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED', qualifiedAt: new Date() } });
      await logCrmActivity(tx, req.user!.id, {
        type: 'CONVERSION',
        subject: 'Lead qualified into customer and opportunity',
        description: `Created or linked customer ${customer.name}, contact, and opportunity ${created.title}`,
        leadId: lead.id,
        contactId: contact.id,
        opportunityId: created.id,
      });
      return tx.opportunity.findUnique({ where: { id: created.id }, include: { contact: true, lead: true, organization: true, customer: true } });
    });
    return success(res, opportunity, 'Lead qualified and converted');
  } catch (err: any) {
    if (err.message) return error(res, err.message, err.message.includes('not found') ? 404 : 400);
    return handlePrismaError(res, err);
  }
};

export const markLeadLost = async (req: AuthRequest, res: Response) => {
  try {
    const lead = await prisma.$transaction(async (tx) => {
      const existing = await tx.lead.findFirst({ where: { id: req.params.id, ...(await crmScopeWhere(req, 'LEAD')) } });
      if (!existing) throw new Error('Lead not found');
      const suppliedReason = typeof req.body.lostReason === 'string' ? req.body.lostReason.trim() : '';
      const lossReason = req.body.lostReasonId
        ? await tx.crmLostReason.findFirst({ where: { id: req.body.lostReasonId, companyId: req.user?.companyId, isActive: true, appliesTo: { in: ['LEAD', 'BOTH'] } } })
        : null;
      // The lead screen intentionally supports an operator-entered explanation as
      // well as an administrator-maintained reason. Do not try to interpret free
      // text as a CrmLostReason id.
      if (req.body.lostReasonId && !lossReason) throw new Error('A valid loss reason is required');
      if (!lossReason && !suppliedReason) throw new Error('A loss reason is required');
      const updated = await tx.lead.update({
        where: { id: existing.id },
        data: { status: 'UNQUALIFIED', lostReasonId: lossReason?.id || null, lostReason: lossReason?.name || suppliedReason },
        include: leadInclude,
      });
      await logCrmActivity(tx, req.user!.id, {
        type: 'STATUS_CHANGE',
        subject: 'Lead marked lost',
        description: updated.lostReason,
        leadId: existing.id,
        metadata: { before: existing.status, after: 'UNQUALIFIED' },
      });
      return updated;
    });
    return success(res, lead, 'Lead marked lost');
  } catch (err: any) {
    if (err.message === 'Lead not found') return error(res, err.message, 404);
    if (['A valid loss reason is required', 'A loss reason is required'].includes(err.message)) return error(res, err.message, 422);
    return handlePrismaError(res, err);
  }
};

export const previewLeadImport = async (req: AuthRequest, res: Response) => {
  try {
    const csvText = req.body.csvText || req.body.content || '';
    if (!csvText.trim()) return error(res, 'CSV content is required', 400);
    const rows = csvToObjects(csvText).slice(0, 100);
    const preview = [];
    for (const row of rows) {
      const normalized = normalizeLeadRow(row.raw);
      const validation = validateLead(normalized);
      const duplicate = validation ? null : await findDuplicateLead(prisma, normalized);
      preview.push({ rowNo: row.rowNo, raw: row.raw, normalized, status: validation ? 'FAILED' : duplicate ? 'DUPLICATE' : 'READY', error: validation, duplicate });
    }
    return success(res, { rows: preview, totalRows: csvToObjects(csvText).length }, 'CSV preview generated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const importLeads = async (req: AuthRequest, res: Response) => {
  try {
    const csvText = req.body.csvText || req.body.content || '';
    const fileName = req.body.fileName || 'leads.csv';
    const duplicateMode = req.body.duplicateMode || 'skip';
    if (!csvText.trim()) return error(res, 'CSV content is required', 400);
    const parsed = csvToObjects(csvText);

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.leadImportBatch.create({
        data: { fileName, status: 'PROCESSING', totalRows: parsed.length, importedById: req.user!.id, companyId: req.user?.companyId },
      });
      const counts = { createdRows: 0, skippedRows: 0, failedRows: 0, duplicateRows: 0 };

      for (const row of parsed) {
        const normalized = normalizeLeadRow(row.raw);
        const validation = validateLead(normalized);
        if (validation) {
          counts.failedRows += 1;
          await tx.leadImportRow.create({ data: { batchId: batch.id, rowNo: row.rowNo, rawData: row.raw, normalizedData: normalized, status: 'FAILED', error: validation } });
          continue;
        }
        const duplicate = await findDuplicateLead(tx, normalized);
        if (duplicate && duplicateMode !== 'create') {
          counts.duplicateRows += 1;
          await tx.leadImportRow.create({ data: { batchId: batch.id, rowNo: row.rowNo, rawData: row.raw, normalizedData: normalized, status: 'DUPLICATE', duplicateLeadId: duplicate.id, error: 'Duplicate lead' } });
          continue;
        }
        const organization = await ensureOrganization(tx, normalized, req.user?.companyId, req.user!.id);
        const assignedToId = req.body.assignedToId || await resolveLeadAssignee(tx, normalized, req.user?.companyId, req.user!.id);
        const lead = await tx.lead.create({
          data: {
            ...normalized,
            companyId: req.user?.companyId,
            branchId: req.user?.branchId,
            normalizedEmail: normalized.email,
            normalizedPhone: normalized.phone?.replace(/\D/g, '') || null,
            title: titleFromLead(normalized),
            organizationId: organization?.id,
            createdById: req.user!.id,
            assignedToId,
            importBatchId: batch.id,
            importRowNo: row.rowNo,
          },
        });
        counts.createdRows += 1;
        await tx.leadImportRow.create({ data: { batchId: batch.id, rowNo: row.rowNo, rawData: row.raw, normalizedData: normalized, status: 'CREATED', leadId: lead.id } });
      }
      await tx.leadImportBatch.update({ where: { id: batch.id }, data: { ...counts, status: 'COMPLETED', completedAt: new Date() } });
      await logCrmActivity(tx, req.user!.id, {
        type: 'IMPORT',
        subject: 'Lead CSV imported',
        description: `${counts.createdRows} leads created from ${fileName}`,
        metadata: counts,
      });
      return tx.leadImportBatch.findUnique({ where: { id: batch.id }, include: { rows: { take: 200, orderBy: { rowNo: 'asc' } } } });
    }, { timeout: 60000 });
    return success(res, result, 'Lead import completed', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLeadImports = async (req: Request, res: Response) => {
  try {
    const imports = await prisma.leadImportBatch.findMany({
      where: { companyId: (req as AuthRequest).user?.companyId || '__missing_company__' },
      include: { importedBy: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return success(res, imports);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getLeadImport = async (req: Request, res: Response) => {
  try {
    const batch = await prisma.leadImportBatch.findFirst({
      where: { id: req.params.id, companyId: (req as AuthRequest).user?.companyId || '__missing_company__' },
      include: { rows: { orderBy: { rowNo: 'asc' } }, importedBy: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!batch) return error(res, 'Import batch not found', 404);
    return success(res, batch);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
