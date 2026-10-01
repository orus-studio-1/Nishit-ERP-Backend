import { Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { AuthRequest } from '../../middleware/auth';
import { paginateQuery } from '../../utils/pagination';

const include = {
  assignTo: { select: { id: true, firstName: true, lastName: true, email: true } },
};

const validSources = new Set(['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'EMAIL', 'PHONE', 'ADVERTISEMENT', 'CSV_IMPORT', 'OTHER']);

function companyWhere(req: AuthRequest) {
  return req.user?.companyId ? { companyId: req.user.companyId } : {};
}

function cleanText(value: any) {
  const text = String(value || '').trim();
  return text || null;
}

function optionalNumber(value: any) {
  if (value === '' || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function buildRuleData(req: AuthRequest) {
  const minValue = optionalNumber(req.body.minValue);
  const maxValue = optionalNumber(req.body.maxValue);
  const priority = Number(req.body.priority ?? 100);
  const source = cleanText(req.body.source);

  if (!cleanText(req.body.name)) return { error: 'Rule name is required' };
  if (!cleanText(req.body.assignToId)) return { error: 'Assignee is required' };
  if (!Number.isInteger(priority) || priority < 1) return { error: 'Priority must be a positive whole number' };
  if (Number.isNaN(minValue) || Number.isNaN(maxValue)) return { error: 'Lead value range must be numeric' };
  if (minValue !== null && maxValue !== null && minValue > maxValue) return { error: 'Minimum value cannot be greater than maximum value' };
  if (source && !validSources.has(source)) return { error: 'Invalid lead source' };

  return {
    data: {
      companyId: req.user?.companyId,
      name: cleanText(req.body.name)!,
      isActive: req.body.isActive ?? true,
      priority,
      source: source as any,
      city: cleanText(req.body.city),
      country: cleanText(req.body.country),
      territory: cleanText(req.body.territory),
      productId: cleanText(req.body.productId),
      branchId: cleanText(req.body.branchId),
      minValue,
      maxValue,
      assignToId: cleanText(req.body.assignToId)!,
    },
  };
}

async function ensureAssignee(assignToId: string, companyId?: string | null) {
  return prisma.user.findFirst({
    where: {
      id: assignToId,
      isActive: true,
      ...(companyId ? { companyId } : {}),
    },
    select: { id: true },
  });
}

function leadWhereForRule(rule: any, companyId?: string | null) {
  const where: any = { ...(companyId ? { createdBy: { companyId } } : {}) };
  if (rule.source) where.source = rule.source;
  if (rule.city) where.city = { equals: rule.city, mode: 'insensitive' };
  if (rule.country) where.country = { equals: rule.country, mode: 'insensitive' };
  if (rule.territory) where.territory = { equals: rule.territory, mode: 'insensitive' };
  if (rule.branchId) where.branchId = rule.branchId;
  if (rule.productId) where.productInterest = rule.productId;
  if (rule.minValue !== null || rule.maxValue !== null) {
    where.value = {};
    if (rule.minValue !== null) where.value.gte = rule.minValue;
    if (rule.maxValue !== null) where.value.lte = rule.maxValue;
  }
  return where;
}

async function withImpact(items: any[], companyId?: string | null) {
  return Promise.all(items.map(async (rule) => {
    const [matchedLeadCount, routedLeadCount] = await Promise.all([
      prisma.lead.count({ where: leadWhereForRule(rule, companyId) }),
      prisma.lead.count({ where: { assignedToId: rule.assignToId, ...(companyId ? { createdBy: { companyId } } : {}) } }),
    ]);
    return { ...rule, matchedLeadCount, routedLeadCount };
  }));
}

function normalizedMatch(value?: string | null, expected?: string | null) {
  if (!expected) return true;
  return String(value || '').trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function matchesRule(rule: any, sample: any) {
  const value = sample.value === undefined || sample.value === null || sample.value === '' ? null : Number(sample.value);
  if (rule.source && rule.source !== sample.source) return false;
  if (!normalizedMatch(sample.city, rule.city)) return false;
  if (!normalizedMatch(sample.country, rule.country)) return false;
  if (!normalizedMatch(sample.territory, rule.territory)) return false;
  if (rule.branchId && rule.branchId !== sample.branchId) return false;
  if (rule.productId && rule.productId !== sample.productId && rule.productId !== sample.productInterest) return false;
  if (rule.minValue !== null && (value === null || value < Number(rule.minValue))) return false;
  if (rule.maxValue !== null && (value === null || value > Number(rule.maxValue))) return false;
  return true;
}

export const getAssignmentRules = async (req: AuthRequest, res: Response) => {
  try {
    const where = companyWhere(req);
    const { items, total, page, limit } = await paginateQuery(prisma.crmAssignmentRule, req, {
      where,
      include,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      defaultLimit: 50,
    });
    return paginated(res, await withImpact(items, req.user?.companyId), total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createAssignmentRule = async (req: AuthRequest, res: Response) => {
  try {
    const payload = buildRuleData(req);
    if ('error' in payload) return error(res, payload.error, 400);
    const assignee = await ensureAssignee(payload.data.assignToId, req.user?.companyId);
    if (!assignee) return error(res, 'Select an active user from this company as assignee', 400);

    const rule = await prisma.crmAssignmentRule.create({ data: payload.data, include });
    const [ruleWithImpact] = await withImpact([rule], req.user?.companyId);
    return success(res, ruleWithImpact, 'Assignment rule created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateAssignmentRule = async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.crmAssignmentRule.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
    if (!existing) return error(res, 'Assignment rule not found', 404);
    const payload = buildRuleData(req);
    if ('error' in payload) return error(res, payload.error, 400);
    const assignee = await ensureAssignee(payload.data.assignToId, req.user?.companyId);
    if (!assignee) return error(res, 'Select an active user from this company as assignee', 400);

    const rule = await prisma.crmAssignmentRule.update({
      where: { id: req.params.id },
      data: payload.data,
      include,
    });
    const [ruleWithImpact] = await withImpact([rule], req.user?.companyId);
    return success(res, ruleWithImpact, 'Assignment rule updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const deleteAssignmentRule = async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.crmAssignmentRule.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
    if (!existing) return error(res, 'Assignment rule not found', 404);
    await prisma.crmAssignmentRule.delete({ where: { id: req.params.id } });
    return success(res, null, 'Assignment rule deleted');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const testAssignmentRule = async (req: AuthRequest, res: Response) => {
  try {
    const value = optionalNumber(req.body.value);
    if (Number.isNaN(value)) return error(res, 'Lead value must be numeric', 400);
    const source = cleanText(req.body.source);
    if (source && !validSources.has(source)) return error(res, 'Invalid lead source', 400);

    const rules = await prisma.crmAssignmentRule.findMany({
      where: { ...companyWhere(req), isActive: true },
      include,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const sample = {
      source,
      city: cleanText(req.body.city),
      country: cleanText(req.body.country),
      territory: cleanText(req.body.territory),
      branchId: cleanText(req.body.branchId),
      productId: cleanText(req.body.productId),
      value,
    };
    const matchedRule = rules.find((rule) => matchesRule(rule, sample)) || null;
    return success(res, {
      matched: Boolean(matchedRule),
      rule: matchedRule,
      assignTo: matchedRule?.assignTo || null,
      evaluatedRules: rules.length,
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
