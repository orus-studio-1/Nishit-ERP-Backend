import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { pickDefined } from '../../utils/payload';
import { AuthRequest } from '../../middleware/auth';
import { ensureOrganization, logCrmActivity } from './shared';

export const getContacts = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { search } = req.query as any;
    const where: any = { isActive: true };
    if (search) where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    const [items, total] = await Promise.all([
      prisma.contact.findMany({ where, include: { organization: true, lead: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.contact.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const getContact = async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        organization: true,
        lead: true,
        opportunities: { include: { customer: true, quotation: true, salesOrder: true }, orderBy: { updatedAt: 'desc' } },
        activities: {
          include: {
            user: { select: { firstName: true, lastName: true, email: true } },
            lead: { select: { id: true, title: true } },
            opportunity: { select: { id: true, title: true } },
            organization: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        customers: true,
      },
    });
    if (!contact) return error(res, 'Contact not found', 404);
    return success(res, contact);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createContact = async (req: AuthRequest, res: Response) => {
  try {
    const contact = await prisma.$transaction(async (tx) => {
      const lead = req.body.leadId ? await tx.lead.findUnique({ where: { id: req.body.leadId } }) : null;
      if (req.body.leadId && !lead) throw new Error('Lead not found');
      const source = { ...lead, ...req.body };
      const organization = source.organizationId ? null : await ensureOrganization(tx, source, req.user?.companyId, req.user?.id);
      const created = await tx.contact.create({
        data: {
          firstName: source.firstName,
          lastName: source.lastName,
          email: source.email,
          phone: source.phone,
          mobile: source.mobile,
          company: source.company,
          leadId: lead?.id || req.body.leadId || undefined,
          organizationId: source.organizationId || organization?.id,
          position: source.position,
          address: source.address,
          city: source.city,
          country: source.country,
          notes: source.notes,
        },
        include: { organization: true, lead: true },
      });
      if (lead) {
        await tx.lead.update({ where: { id: lead.id }, data: { status: lead.status === 'NEW' ? 'CONTACTED' : lead.status, lastContactedAt: new Date() } });
        await logCrmActivity(tx, req.user!.id, {
          type: 'CONVERSION',
          subject: 'Contact created from lead',
          description: `${created.firstName} ${created.lastName} linked to ${lead.title}`,
          leadId: lead.id,
          contactId: created.id,
          organizationId: created.organizationId,
        });
      }
      return created;
    });
    return success(res, contact, 'Contact created', 201);
  } catch (err: any) {
    if (err.message === 'Lead not found') return error(res, err.message, 404);
    return handlePrismaError(res, err);
  }
};

export const openLeadContact = async (req: AuthRequest, res: Response) => {
  try {
    const contact = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: req.params.id }, include: { contacts: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
      if (!lead) throw new Error('Lead not found');
      if (lead.contacts[0]) return lead.contacts[0];

      const organization = lead.organizationId ? null : await ensureOrganization(tx, lead, req.user?.companyId, req.user?.id);
      const created = await tx.contact.create({
        data: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          leadId: lead.id,
          organizationId: lead.organizationId || organization?.id,
          city: lead.city,
          country: lead.country,
          notes: lead.notes,
        },
      });
      await tx.lead.update({ where: { id: lead.id }, data: { status: lead.status === 'NEW' ? 'CONTACTED' : lead.status, lastContactedAt: new Date() } });
      await logCrmActivity(tx, req.user!.id, {
        type: 'NOTE',
        subject: 'Contact profile opened from lead',
        description: `Created the primary contact profile for ${lead.title}`,
        leadId: lead.id,
        contactId: created.id,
        organizationId: created.organizationId,
      });
      return created;
    });
    return success(res, contact, 'Lead contact ready');
  } catch (err: any) {
    if (err.message === 'Lead not found') return error(res, err.message, 404);
    return handlePrismaError(res, err);
  }
};

export const updateContact = async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: pickDefined(req.body, ['firstName', 'lastName', 'email', 'phone', 'mobile', 'jobTitle', 'department', 'address', 'city', 'state', 'country', 'zip', 'notes', 'organizationId', 'ownerId', 'isPrimary', 'isActive']) as any });
    return success(res, contact, 'Contact updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteContact = async (req: Request, res: Response) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
    return success(res, null, 'Contact deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
