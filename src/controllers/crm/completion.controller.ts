import crypto from 'crypto';
import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AuthRequest } from '../../middleware/auth';
import { error, success } from '../../utils/response';
import { enqueueJob } from '../../services/platform/job.service';
import { findDuplicateLead, leadInclude, normalizeLeadRow, resolveLeadAssignee, titleFromLead, validateLead } from './shared';

const companyId = (req: AuthRequest) => req.user?.companyId || '';
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const text = (value: any) => String(value || '').trim();
const encryptCredentials = (value: any) => { const iv = crypto.randomBytes(12); const key = crypto.createHash('sha256').update(process.env.JWT_SECRET!).digest(); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.'); };

async function leadEvent(tx: any, req: AuthRequest, leadId: string, type: string, subject: string, data?: any) {
  return tx.crmLeadEvent.create({ data: { companyId: companyId(req), leadId, type, actorId: req.user?.id, subject, data } });
}

export const checkDuplicateLead = async (req: AuthRequest, res: Response) => {
  const normalized = normalizeLeadRow(req.body);
  const matches = await prisma.lead.findMany({
    where: { companyId: companyId(req), mergedIntoId: null, OR: [
      ...(normalized.email ? [{ normalizedEmail: normalized.email }] : []),
      ...(normalized.phone ? [{ normalizedPhone: normalized.phone.replace(/\D/g, '') }] : []),
    ] },
    select: { id: true, title: true, firstName: true, lastName: true, company: true, email: true, phone: true, status: true, assignedToId: true },
    take: 10,
  });
  return success(res, { duplicate: matches.length > 0, normalized: { email: normalized.email, phone: normalized.phone?.replace(/\D/g, '') }, suggestions: matches });
};

export const mergeLeads = async (req: AuthRequest, res: Response) => {
  const sourceIds = [...new Set((req.body.sourceLeadIds || []).map(String))].filter((id) => id !== req.params.id);
  if (!sourceIds.length) return error(res, 'Provide sourceLeadIds to merge', 400);
  const merged = await prisma.$transaction(async (tx: any) => {
    const target = await tx.lead.findFirst({ where: { id: req.params.id, companyId: companyId(req), mergedIntoId: null } });
    const sources = await tx.lead.findMany({ where: { id: { in: sourceIds }, companyId: companyId(req), mergedIntoId: null } });
    if (!target || sources.length !== sourceIds.length) throw new Error('LEAD_NOT_FOUND');
    const targetOpportunity = await tx.opportunity.findFirst({ where: { leadId: target.id } });
    const sourceOpportunities = await tx.opportunity.findMany({ where: { leadId: { in: sourceIds } }, orderBy: { createdAt: 'asc' } });
    if (!targetOpportunity && sourceOpportunities[0]) await tx.opportunity.update({ where: { id: sourceOpportunities[0].id }, data: { leadId: target.id } });
    if (sourceOpportunities.length > (targetOpportunity ? 0 : 1)) await tx.opportunity.updateMany({ where: { id: { in: sourceOpportunities.slice(targetOpportunity ? 0 : 1).map((row: any) => row.id) } }, data: { leadId: null } });
    await tx.activity.updateMany({ where: { leadId: { in: sourceIds } }, data: { leadId: target.id } });
    await tx.contact.updateMany({ where: { leadId: { in: sourceIds } }, data: { leadId: target.id } });
    await tx.crmCommunication.updateMany({ where: { leadId: { in: sourceIds } }, data: { leadId: target.id } });
    await tx.crmLeadEvent.updateMany({ where: { leadId: { in: sourceIds } }, data: { leadId: target.id } });
    await tx.attachment.updateMany({ where: { companyId: companyId(req), entityType: 'LEAD', entityId: { in: sourceIds } }, data: { entityId: target.id } });
    await tx.lead.updateMany({ where: { id: { in: sourceIds } }, data: { mergedIntoId: target.id, status: 'UNQUALIFIED' } });
    await leadEvent(tx, req, target.id, 'MERGE', 'Leads merged', { sourceLeadIds: sourceIds });
    return tx.lead.findUnique({ where: { id: target.id }, include: leadInclude });
  });
  return success(res, merged, 'Leads merged');
};

async function assignMany(req: AuthRequest, leadIds: string[], assigneeId: string) {
  const assignee = await prisma.user.findFirst({ where: { id: assigneeId, companyId: companyId(req), isActive: true } });
  if (!assignee) throw new Error('ASSIGNEE_NOT_FOUND');
  return prisma.$transaction(async (tx: any) => {
    const leads = await tx.lead.findMany({ where: { id: { in: leadIds }, companyId: companyId(req), mergedIntoId: null } });
    if (leads.length !== leadIds.length) throw new Error('LEAD_NOT_FOUND');
    await tx.lead.updateMany({ where: { id: { in: leadIds } }, data: { assignedToId: assigneeId } });
    for (const lead of leads) await leadEvent(tx, req, lead.id, 'ASSIGNMENT', 'Lead assigned', { from: lead.assignedToId, to: assigneeId });
    return { updated: leads.length, assigneeId };
  });
}

export const assignLead = async (req: AuthRequest, res: Response) => {
  try { return success(res, await assignMany(req, [req.params.id], req.body.assignedToId), 'Lead assigned'); }
  catch (e: any) { return error(res, e.message === 'ASSIGNEE_NOT_FOUND' ? 'Assignee not found' : 'Lead not found', 404); }
};
export const bulkAssignLeads = async (req: AuthRequest, res: Response) => {
  try { return success(res, await assignMany(req, req.body.leadIds || [], req.body.assignedToId), 'Leads assigned'); }
  catch (e: any) { return error(res, e.message === 'ASSIGNEE_NOT_FOUND' ? 'Assignee not found' : 'One or more leads were not found', 404); }
};

export const getLeadTimeline = async (req: AuthRequest, res: Response) => {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.id, companyId: companyId(req) }, select: { id: true } });
  if (!lead) return error(res, 'Lead not found', 404);
  const [activities, communications, events, documents] = await Promise.all([
    prisma.activity.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' } }),
    prisma.crmCommunication.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' } }),
    prisma.crmLeadEvent.findMany({ where: { leadId: lead.id }, orderBy: { occurredAt: 'desc' } }),
    prisma.attachment.findMany({ where: { companyId: companyId(req), entityType: 'LEAD', entityId: lead.id, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
  ]);
  const timeline = [
    ...activities.map((item) => ({ kind: 'ACTIVITY', at: item.createdAt, item })),
    ...communications.map((item) => ({ kind: item.channel, at: item.createdAt, item })),
    ...events.map((item) => ({ kind: item.type, at: item.occurredAt, item })),
    ...documents.map((item) => ({ kind: 'DOCUMENT', at: item.createdAt, item })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return success(res, timeline);
};

export const createScopeRule = async (req: AuthRequest, res: Response) => success(res, await prisma.crmScopeRule.upsert({
  where: { companyId_userId_entity: { companyId: companyId(req), userId: req.body.userId, entity: req.body.entity || 'LEAD' } },
  update: { scope: req.body.scope, branchId: req.body.branchId, isActive: req.body.isActive ?? true },
  create: { companyId: companyId(req), userId: req.body.userId, entity: req.body.entity || 'LEAD', scope: req.body.scope || 'OWN', branchId: req.body.branchId },
}), 'Scope rule saved', 201);
export const listScopeRules = async (req: AuthRequest, res: Response) => success(res, await prisma.crmScopeRule.findMany({ where: { companyId: companyId(req) }, orderBy: [{ entity: 'asc' }, { userId: 'asc' }] }));
export const deleteScopeRule = async (req: AuthRequest, res: Response) => { const row = await prisma.crmScopeRule.deleteMany({ where: { id: req.params.id, companyId: companyId(req) } }); return row.count ? success(res, null, 'Scope rule deleted') : error(res, 'Scope rule not found', 404); };
export const getCrmConfiguration = async (req: AuthRequest, res: Response) => { const company = companyId(req); const [users, branches, queue] = await Promise.all([prisma.user.findMany({ where: { companyId: company, isActive: true }, select: { id: true, firstName: true, lastName: true, email: true, role: true } }), prisma.branch.findMany({ where: { companyId: company, isActive: true }, select: { id: true, code: true, name: true } }), prisma.platformSetting.findFirst({ where: { companyId: company, namespace: 'crm', key: 'defaultQueueUserId' }, orderBy: { updatedAt: 'desc' } })]); return success(res, { users, branches, defaultQueueUserId: typeof queue?.value === 'string' ? queue.value : null }); };
export const updateDefaultQueue = async (req: AuthRequest, res: Response) => { const user = await prisma.user.findFirst({ where: { id: req.body.userId, companyId: companyId(req), isActive: true } }); if (!user) return error(res, 'Select an active company user', 422); const existing = await prisma.platformSetting.findFirst({ where: { companyId: companyId(req), namespace: 'crm', key: 'defaultQueueUserId' } }); const row = existing ? await prisma.platformSetting.update({ where: { id: existing.id }, data: { value: user.id, updatedBy: req.user!.id } }) : await prisma.platformSetting.create({ data: { tenantId: req.user!.tenantId!, companyId: companyId(req), namespace: 'crm', key: 'defaultQueueUserId', value: user.id, valueType: 'string', updatedBy: req.user!.id } }); return success(res, row, 'Default queue updated'); };

export const listLostReasons = async (req: AuthRequest, res: Response) => success(res, await prisma.crmLostReason.findMany({ where: { companyId: companyId(req), isActive: req.query.all === 'true' ? undefined : true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
export const createLostReason = async (req: AuthRequest, res: Response) => success(res, await prisma.crmLostReason.create({ data: { companyId: companyId(req), name: text(req.body.name), category: req.body.category, appliesTo: req.body.appliesTo || 'BOTH', sortOrder: Number(req.body.sortOrder || 100) } }), 'Loss reason created', 201);
export const updateLostReason = async (req: AuthRequest, res: Response) => { const row = await prisma.crmLostReason.updateMany({ where: { id: req.params.id, companyId: companyId(req) }, data: { name: req.body.name, category: req.body.category, appliesTo: req.body.appliesTo, sortOrder: req.body.sortOrder, isActive: req.body.isActive } }); return row.count ? success(res, null, 'Loss reason updated') : error(res, 'Loss reason not found', 404); };

async function moveOpportunity(req: AuthRequest, stage: any, requiredLoss = false) {
  return prisma.$transaction(async (tx: any) => {
    const row = await tx.opportunity.findFirst({ where: { id: req.params.id, companyId: companyId(req) } });
    if (!row) throw new Error('OPPORTUNITY_NOT_FOUND');
    let loss: any = null;
    if (requiredLoss) {
      loss = await tx.crmLostReason.findFirst({ where: { id: req.body.lostReasonId, companyId: companyId(req), isActive: true, appliesTo: { in: ['OPPORTUNITY', 'BOTH'] } } });
      if (!loss) throw new Error('LOSS_REASON_REQUIRED');
    }
    const probabilities: any = { PROSPECTING: 10, QUALIFICATION: 25, PROPOSAL: 50, NEGOTIATION: 75, CLOSED_WON: 100, CLOSED_LOST: 0 };
    const probability = Number(req.body.probability ?? probabilities[stage] ?? row.probability);
    const updated = await tx.opportunity.update({ where: { id: row.id }, data: { stage, probability, forecastCategory: req.body.forecastCategory || (stage === 'CLOSED_WON' ? 'COMMIT' : stage === 'CLOSED_LOST' ? 'OMITTED' : row.forecastCategory), expectedClose: req.body.expectedClose ? new Date(req.body.expectedClose) : undefined, competitor: req.body.competitor, lostReasonId: loss?.id, lostReason: loss?.name, wonAt: stage === 'CLOSED_WON' ? new Date() : undefined, lostAt: stage === 'CLOSED_LOST' ? new Date() : undefined, erpSyncStatus: stage === 'CLOSED_WON' ? 'QUEUED' : undefined } });
    await tx.opportunityStageHistory.create({ data: { companyId: companyId(req), opportunityId: row.id, fromStage: row.stage, toStage: stage, probability, changedById: req.user!.id, reason: req.body.reason || loss?.name } });
    return { ...updated, weightedValue: Number(updated.value) * probability / 100 };
  });
}
export const moveOpportunityStage = async (req: AuthRequest, res: Response) => { try { return success(res, await moveOpportunity(req, req.body.stage), 'Opportunity stage moved'); } catch (e: any) { return error(res, 'Opportunity not found', 404); } };
export const winOpportunity = async (req: AuthRequest, res: Response) => { try { return success(res, await moveOpportunity(req, 'CLOSED_WON'), 'Opportunity won'); } catch { return error(res, 'Opportunity not found', 404); } };
export const loseOpportunity = async (req: AuthRequest, res: Response) => { try { return success(res, await moveOpportunity(req, 'CLOSED_LOST', true), 'Opportunity lost'); } catch (e: any) { return error(res, e.message === 'LOSS_REASON_REQUIRED' ? 'A valid loss reason is required' : 'Opportunity not found', e.message === 'LOSS_REASON_REQUIRED' ? 422 : 404); } };
export const opportunityHistory = async (req: AuthRequest, res: Response) => success(res, await prisma.opportunityStageHistory.findMany({ where: { opportunityId: req.params.id, companyId: companyId(req) }, orderBy: { changedAt: 'desc' } }));

const activityWhere = (req: AuthRequest, extra: any = {}) => ({ companyId: companyId(req), userId: req.user!.id, ...extra });
export const myDay = async (req: AuthRequest, res: Response) => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return success(res, await prisma.activity.findMany({ where: activityWhere(req, { status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueDate: { lt: end } }), orderBy: { dueDate: 'asc' } })); };
export const overdueActivities = async (req: AuthRequest, res: Response) => success(res, await prisma.activity.findMany({ where: activityWhere(req, { status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueDate: { lt: new Date() } }), orderBy: { dueDate: 'asc' } }));
export const activityCalendar = async (req: AuthRequest, res: Response) => success(res, await prisma.activity.findMany({ where: activityWhere(req, { dueDate: { gte: new Date(String(req.query.from)), lte: new Date(String(req.query.to)) } }), orderBy: { dueDate: 'asc' } }));
export const addActivityAttendees = async (req: AuthRequest, res: Response) => { const activity = await prisma.activity.findFirst({ where: { id: req.params.id, companyId: companyId(req) } }); if (!activity) return error(res, 'Activity not found', 404); await prisma.activityAttendee.createMany({ data: (req.body.attendees || []).map((a: any) => ({ activityId: activity.id, userId: a.userId, name: a.name, email: a.email?.toLowerCase() })), skipDuplicates: true }); return success(res, await prisma.activityAttendee.findMany({ where: { activityId: activity.id } }), 'Attendees saved'); };
export const createDailyDigest = async (req: AuthRequest, res: Response) => success(res, await enqueueJob('CRM_DAILY_DIGEST', { companyId: companyId(req), userId: req.user!.id }, { tenantId: req.user?.tenantId }), 'Digest queued', 202);

export const listEmailTemplates = async (req: AuthRequest, res: Response) => success(res, await prisma.crmEmailTemplate.findMany({ where: { companyId: companyId(req), isActive: true }, orderBy: { name: 'asc' } }));
export const createEmailTemplate = async (req: AuthRequest, res: Response) => success(res, await prisma.crmEmailTemplate.create({ data: { companyId: companyId(req), name: text(req.body.name), subject: text(req.body.subject), bodyHtml: text(req.body.bodyHtml), bodyText: req.body.bodyText, createdById: req.user!.id } }), 'Template created', 201);
export const deleteEmailTemplate = async (req: AuthRequest, res: Response) => { const row = await prisma.crmEmailTemplate.updateMany({ where: { id: req.params.id, companyId: companyId(req) }, data: { isActive: false } }); return row.count ? success(res, null, 'Template disabled') : error(res, 'Template not found', 404); };
export const sendCommunication = async (req: AuthRequest, res: Response) => { const channel = req.body.channel || 'EMAIL'; const row = await prisma.crmCommunication.create({ data: { companyId: companyId(req), leadId: req.body.leadId, contactId: req.body.contactId, opportunityId: req.body.opportunityId, channel, direction: 'OUTBOUND', provider: req.body.provider || (channel === 'WHATSAPP' ? 'META' : 'SMTP'), threadId: req.body.threadId || crypto.randomUUID(), fromAddress: req.body.from, toAddress: text(req.body.to), subject: req.body.subject, body: req.body.body, sentById: req.user!.id, metadata: req.body.metadata } }); await enqueueJob(`CRM_SEND_${channel}`, { communicationId: row.id }, { tenantId: req.user?.tenantId }); return success(res, row, 'Communication queued', 202); };
export const communicationThread = async (req: AuthRequest, res: Response) => success(res, await prisma.crmCommunication.findMany({ where: { companyId: companyId(req), ...(req.query.threadId ? { threadId: String(req.query.threadId) } : {}), ...(req.query.leadId ? { leadId: String(req.query.leadId) } : {}) }, orderBy: { createdAt: 'asc' } }));
export const syncMailbox = async (req: AuthRequest, res: Response) => success(res, await enqueueJob('CRM_SYNC_MAILBOX', { companyId: companyId(req), provider: req.body.provider || 'IMAP', userId: req.user!.id }, { tenantId: req.user?.tenantId }), 'Mailbox synchronization queued', 202);
export const listIntegrationAccounts = async (req: AuthRequest, res: Response) => success(res, await prisma.crmIntegrationAccount.findMany({ where: { companyId: companyId(req) }, select: { id: true, provider: true, account: true, status: true, lastSyncedAt: true, expiresAt: true, createdAt: true } }));
export const connectIntegrationAccount = async (req: AuthRequest, res: Response) => { const provider = text(req.body.provider).toUpperCase(); if (!['GMAIL', 'OUTLOOK', 'IMAP', 'WHATSAPP'].includes(provider)) return error(res, 'Unsupported integration provider', 400); const row = await prisma.crmIntegrationAccount.upsert({ where: { companyId_provider_account: { companyId: companyId(req), provider, account: text(req.body.account) } }, update: { credentialsEncrypted: encryptCredentials(req.body.credentials), status: 'ACTIVE', expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined }, create: { companyId: companyId(req), userId: req.user!.id, provider, account: text(req.body.account), credentialsEncrypted: encryptCredentials(req.body.credentials), expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined } }); return success(res, { id: row.id, provider: row.provider, account: row.account, status: row.status }, 'Integration connected', 201); };
export const disconnectIntegrationAccount = async (req: AuthRequest, res: Response) => { const row = await prisma.crmIntegrationAccount.updateMany({ where: { id: req.params.id, companyId: companyId(req) }, data: { status: 'REVOKED', credentialsEncrypted: '' } }); return row.count ? success(res, null, 'Integration disconnected') : error(res, 'Integration not found', 404); };

export const createCaptureToken = async (req: AuthRequest, res: Response) => { const raw = crypto.randomBytes(32).toString('base64url'); const row = await prisma.crmCaptureToken.create({ data: { companyId: companyId(req), name: text(req.body.name), tokenHash: sha256(raw), source: req.body.source || 'WEBSITE', expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined, createdById: req.user!.id } }); return success(res, { ...row, token: raw }, 'Capture token created; copy it now', 201); };
export const listCaptureTokens = async (req: AuthRequest, res: Response) => success(res, await prisma.crmCaptureToken.findMany({ where: { companyId: companyId(req) }, select: { id: true, name: true, source: true, isActive: true, expiresAt: true, lastUsedAt: true, createdAt: true } }));
export const revokeCaptureToken = async (req: AuthRequest, res: Response) => { const row = await prisma.crmCaptureToken.updateMany({ where: { id: req.params.id, companyId: companyId(req) }, data: { isActive: false } }); return row.count ? success(res, null, 'Capture token revoked') : error(res, 'Capture token not found', 404); };

export const captureLead = async (req: Request, res: Response) => {
  const rawToken = text(req.headers['x-capture-token'] || req.query.token);
  const token = await prisma.crmCaptureToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!token || !token.isActive || (token.expiresAt && token.expiresAt < new Date())) return error(res, 'Invalid capture token', 401);
  const normalized = normalizeLeadRow({ ...req.body, source: token.source });
  const invalid = validateLead(normalized); if (invalid) return error(res, invalid, 400);
  const duplicate = await findDuplicateLead(prisma, { ...normalized, companyId: token.companyId }); if (duplicate) return success(res, { duplicate: true, leadId: duplicate.id }, 'Lead already captured');
  const assignedToId = await resolveLeadAssignee(prisma, normalized, token.companyId, null);
  const lead = await prisma.lead.create({ data: { ...normalized, normalizedEmail: normalized.email, normalizedPhone: normalized.phone?.replace(/\D/g, ''), title: titleFromLead(normalized), companyId: token.companyId, createdById: token.createdById, assignedToId } });
  await prisma.crmCaptureToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return success(res, lead, 'Lead captured', 201);
};

export const inboundCommunicationWebhook = async (req: Request, res: Response) => {
  const rawToken = text(req.headers['x-capture-token'] || req.query.token);
  const token = await prisma.crmCaptureToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!token?.isActive) return error(res, 'Invalid webhook token', 401);
  const externalId = text(req.body.externalId || req.body.messages?.[0]?.id);
  const row = await prisma.crmCommunication.upsert({ where: { provider_externalId: { provider: req.body.provider || 'META', externalId } }, update: { status: req.body.status || 'RECEIVED', deliveredAt: req.body.deliveredAt ? new Date(req.body.deliveredAt) : undefined, readAt: req.body.readAt ? new Date(req.body.readAt) : undefined, metadata: req.body }, create: { companyId: token.companyId, leadId: req.body.leadId, contactId: req.body.contactId, channel: req.body.channel || 'WHATSAPP', direction: 'INBOUND', provider: req.body.provider || 'META', externalId, threadId: req.body.threadId || req.body.from, fromAddress: req.body.from, toAddress: req.body.to || 'company', body: req.body.body || req.body.text, status: req.body.status || 'RECEIVED', metadata: req.body } });
  return success(res, row, 'Webhook accepted');
};

export const requestLeadExport = async (req: AuthRequest, res: Response) => { const row = await prisma.crmExportJob.create({ data: { companyId: companyId(req), requestedById: req.user!.id, entity: 'LEAD', filters: req.body.filters || {} } }); await enqueueJob('CRM_EXPORT_LEADS', { exportJobId: row.id }, { tenantId: req.user?.tenantId }); return success(res, row, 'Export queued', 202); };
export const getExport = async (req: AuthRequest, res: Response) => { const row = await prisma.crmExportJob.findFirst({ where: { id: req.params.id, companyId: companyId(req) } }); return row ? success(res, row) : error(res, 'Export not found', 404); };

export const crmReport = async (req: AuthRequest, res: Response) => {
  const company = companyId(req); const aliases: any = { 'conversion-funnel': 'funnel', 'source-campaign': 'sources', 'lead-ageing': 'ageing', 'weighted-pipeline': 'forecast', 'lost-reasons': 'losses', 'activity-performance': 'activities', 'sales-rep-leaderboard': 'leaderboard' }; const type = aliases[req.params.type] || req.params.type;
  const [leads, opportunities, activities] = await Promise.all([prisma.lead.findMany({ where: { companyId: company, mergedIntoId: null } }), prisma.opportunity.findMany({ where: { companyId: company } }), prisma.activity.findMany({ where: { companyId: company } })]);
  const countBy = (rows: any[], key: string) => Object.entries(rows.reduce((a: any, r: any) => { const k = r[key] || 'UNSPECIFIED'; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([name, count]) => ({ name, count }));
  const reports: any = {
    summary: { leads: leads.length, qualified: leads.filter((x) => ['QUALIFIED', 'CONVERTED'].includes(x.status)).length, openPipeline: opportunities.filter((x) => !x.stage.startsWith('CLOSED')).reduce((s, x) => s + x.value, 0), wonValue: opportunities.filter((x) => x.stage === 'CLOSED_WON').reduce((s, x) => s + x.value, 0), overdueActivities: activities.filter((x) => x.dueDate && x.dueDate < new Date() && !['COMPLETED', 'CANCELLED'].includes(x.status)).length },
    funnel: countBy(leads, 'status'), sources: countBy(leads, 'source'), campaigns: countBy(leads, 'campaign'), ageing: leads.map((x) => ({ id: x.id, title: x.title, ageDays: Math.floor((Date.now() - x.createdAt.getTime()) / 86400000), status: x.status })),
    forecast: opportunities.map((x) => ({ id: x.id, title: x.title, stage: x.stage, value: x.value, probability: x.probability, weightedValue: x.value * x.probability / 100, expectedClose: x.expectedClose, forecastCategory: x.forecastCategory })),
    losses: countBy([...leads.filter((x) => x.lostReason), ...opportunities.filter((x) => x.lostReason)], 'lostReason'),
    activities: countBy(activities, 'outcome'), leaderboard: Object.values(opportunities.reduce((a: any, x: any) => { const k = x.ownerId || 'UNASSIGNED'; a[k] ||= { userId: k, opportunities: 0, won: 0, value: 0 }; a[k].opportunities++; if (x.stage === 'CLOSED_WON') { a[k].won++; a[k].value += x.value; } return a; }, {})),
  };
  return reports[type] ? success(res, reports[type]) : error(res, 'Unknown CRM report', 404);
};
