import { Request, Response } from 'express';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { error, paginated, success } from '../utils/response';
import { enqueueJob } from '../services/platform/job.service';
import { amendLifecycle, cancelLifecycle, createLifecycle, submitLifecycle } from '../services/platform/documentLifecycle.service';

const s3 = new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } : undefined });
const bucket = process.env.S3_BUCKET || '';
const maxUploadBytes = Number(process.env.S3_MAX_UPLOAD_BYTES) || 26_214_400; // 25 MB default
const auth = (req: Request) => req as AuthRequest;
const tenant = (req: Request) => auth(req).user!.tenantId!;

export const getTenant = async (req: Request, res: Response) => success(res, await prisma.tenant.findUnique({ where: { id: tenant(req) }, include: { companies: { include: { branches: true, gstRegistrations: true } } } }));
export const updateTenant = async (req: Request, res: Response) => { const { name, dataRegion, baseCurrency, timezone } = req.body; return success(res, await prisma.tenant.update({ where: { id: tenant(req) }, data: { name, dataRegion, baseCurrency, timezone } }), 'Tenant updated'); };
export const createBranch = async (req: Request, res: Response) => { const company = await prisma.company.findFirst({ where: { id: req.params.companyId, tenantId: tenant(req) } }); if (!company) return error(res, 'Company not found', 404, undefined, 'COMPANY_NOT_FOUND'); return success(res, await prisma.branch.create({ data: { tenantId: tenant(req), companyId: company.id, code: req.body.code, name: req.body.name, gstin: req.body.gstin, address: req.body.address, isManufacturing: Boolean(req.body.isManufacturing) } }), 'Branch created', 201); };
export const createGstin = async (req: Request, res: Response) => { const company = await prisma.company.findFirst({ where: { id: req.params.companyId, tenantId: tenant(req) } }); if (!company) return error(res, 'Company not found', 404, undefined, 'COMPANY_NOT_FOUND'); return success(res, await prisma.companyGstin.create({ data: { tenantId: tenant(req), companyId: company.id, stateCode: req.body.stateCode, gstin: req.body.gstin, legalName: req.body.legalName, address: req.body.address, isDefault: Boolean(req.body.isDefault) } }), 'GST registration created', 201); };

const quotationImage = (value: unknown, label: string) => {
  if (value == null || value === '') return null;
  const image = String(value);
  if (!/^data:image\/(png|jpe?g);base64,/i.test(image)) throw new Error(`${label} must be a PNG or JPEG image`);
  if (image.length > 2_800_000) throw new Error(`${label} must be smaller than 2 MB`);
  return image;
};

export const updateQuotationProfile = async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findFirst({ where: { id: req.params.companyId, tenantId: tenant(req) } });
    if (!company) return error(res, 'Company not found', 404, undefined, 'COMPANY_NOT_FOUND');
    const current = (company.quotationDefaults as Record<string, unknown> | null) || {};
    const profile = {
      ...current,
      bankDetails: String(req.body.bankDetails ?? current.bankDetails ?? ''),
      deliveryTerms: String(req.body.deliveryTerms ?? current.deliveryTerms ?? ''),
      deliveryChargesNote: String(req.body.deliveryChargesNote ?? current.deliveryChargesNote ?? ''),
      terms: String(req.body.terms ?? current.terms ?? ''),
      signature: req.body.signature === undefined ? String(current.signature || '') || null : quotationImage(req.body.signature, 'Signature'),
    };
    const updated = await prisma.company.update({ where: { id: company.id }, data: {
      name: String(req.body.name || company.name).trim(),
      legalName: req.body.legalName === undefined ? company.legalName : String(req.body.legalName || '').trim() || null,
      gstin: req.body.gstin === undefined ? company.gstin : String(req.body.gstin || '').trim().toUpperCase() || null,
      address: req.body.address === undefined ? company.address : String(req.body.address || '').trim() || null,
      city: req.body.city === undefined ? company.city : String(req.body.city || '').trim() || null,
      state: req.body.state === undefined ? company.state : String(req.body.state || '').trim() || null,
      country: req.body.country === undefined ? company.country : String(req.body.country || '').trim() || null,
      zip: req.body.zip === undefined ? company.zip : String(req.body.zip || '').trim() || null,
      logo: req.body.logo === undefined ? company.logo : quotationImage(req.body.logo, 'Logo'),
      currency: 'INR', quotationDefaults: profile,
    } });
    return success(res, updated, 'Quotation company profile saved');
  } catch (e: any) { return error(res, e.message || 'Could not save quotation company profile', 400); }
};

export const registerLifecycle = async (req: Request, res: Response) => success(res, await createLifecycle(req.body.entityType, req.body.entityId, undefined, req.body.branchId), 'Lifecycle registered', 201);
export const submitDocument = async (req: Request, res: Response) => { try { return success(res, await submitLifecycle(req.params.id, (req as any).expectedVersion, req.body), 'Document submitted'); } catch (e: any) { return lifecycleError(res, e); } };
export const cancelDocument = async (req: Request, res: Response) => { try { return success(res, await cancelLifecycle(req.params.id, (req as any).expectedVersion, req.body.reason), 'Document cancelled'); } catch (e: any) { return lifecycleError(res, e); } };
export const amendDocument = async (req: Request, res: Response) => { try { return success(res, await amendLifecycle(req.params.id, (req as any).expectedVersion), 'Amendment draft created', 201); } catch (e: any) { return lifecycleError(res, e); } };
function lifecycleError(res: Response, e: any) { const code = String(e.message || 'DOCUMENT_OPERATION_FAILED'); return error(res, code.replace(/_/g, ' ').toLowerCase(), code === 'STALE_VERSION' ? 409 : 400, undefined, code); }

export const presignAttachment = async (req: Request, res: Response) => {
  if (!bucket) return error(res, 'Object storage is not configured', 503, undefined, 'STORAGE_NOT_CONFIGURED');
  const id = crypto.randomUUID();
  const key = `${tenant(req)}/${req.body.entityType}/${req.body.entityId}/${id}/${String(req.body.fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const attachment = await prisma.attachment.create({ data: { id, tenantId: tenant(req), companyId: auth(req).user!.companyId, entityType: req.body.entityType, entityId: req.body.entityId, fileName: req.body.fileName, mimeType: req.body.mimeType, sizeBytes: BigInt(req.body.sizeBytes), storageKey: key, checksum: req.body.checksum, version: req.body.version || 1, supersedesId: req.body.supersedesId, uploadedBy: auth(req).user!.id, isPrivate: req.body.isPrivate !== false } });
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 0, maxUploadBytes],
      ['eq', '$Content-Type', attachment.mimeType],
    ],
    Fields: {
      'Content-Type': attachment.mimeType,
      ...(attachment.checksum ? { 'x-amz-checksum-sha256': attachment.checksum } : {}),
      'x-amz-meta-attachmentid': attachment.id,
      'x-amz-meta-tenantid': tenant(req),
    },
    Expires: 900,
  });
  return success(res, { url, fields, storageKey: key, attachmentId: attachment.id, expiresIn: 900 }, 'Upload URL issued', 201);
};
export const completeAttachment = async (req: Request, res: Response) => { const row = await prisma.attachment.findFirst({ where: { id: req.params.id, tenantId: tenant(req), status: 'PENDING_UPLOAD' } }); if (!row) return error(res, 'Attachment not found', 404, undefined, 'ATTACHMENT_NOT_FOUND'); try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey })); } catch { return error(res, 'Uploaded object was not found', 409, undefined, 'UPLOAD_INCOMPLETE'); } await prisma.attachment.update({ where: { id: row.id }, data: { status: 'SCANNING' } }); await enqueueJob('ATTACHMENT_SCAN', { attachmentId: row.id }, { tenantId: tenant(req) }); return success(res, { ...row, status: 'SCANNING' }, 'Upload confirmed; antivirus scan queued'); };
export const listAttachments = async (req: Request, res: Response) => success(res, await prisma.attachment.findMany({ where: { tenantId: tenant(req), entityType: String(req.query.entityType), entityId: String(req.query.entityId), deletedAt: null }, orderBy: [{ fileName: 'asc' }, { version: 'desc' }] }));
export const downloadAttachment = async (req: Request, res: Response) => { const row = await prisma.attachment.findFirst({ where: { id: req.params.id, tenantId: tenant(req), status: 'AVAILABLE', deletedAt: null } }); if (!row) return error(res, 'Attachment is unavailable', 404, undefined, 'ATTACHMENT_UNAVAILABLE'); return res.redirect(302, await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: row.storageKey, ResponseContentDisposition: `attachment; filename="${row.fileName.replace(/"/g, '')}"` }), { expiresIn: 300 })); };
export const deleteAttachment = async (req: Request, res: Response) => { const result = await prisma.attachment.updateMany({ where: { id: req.params.id, tenantId: tenant(req), deletedAt: null }, data: { status: 'DELETED', deletedAt: new Date() } }); return result.count ? success(res, null, 'Attachment deleted') : error(res, 'Attachment not found', 404, undefined, 'ATTACHMENT_NOT_FOUND'); };

export const listApprovalRules = async (req: Request, res: Response) => success(res, await prisma.approvalRule.findMany({ where: { tenantId: tenant(req) }, orderBy: [{ documentType: 'asc' }, { priority: 'asc' }] }));
export const createApprovalRule = async (req: Request, res: Response) => success(res, await prisma.approvalRule.create({ data: { tenantId: tenant(req), companyId: auth(req).user!.companyId, documentType: req.body.documentType, name: req.body.name, priority: req.body.priority || 100, conditions: req.body.conditions || {}, steps: req.body.steps || [] } }), 'Approval rule created', 201);
export const updateApprovalRule = async (req: Request, res: Response) => { const result = await prisma.approvalRule.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data: { name: req.body.name, priority: req.body.priority, conditions: req.body.conditions, steps: req.body.steps, isActive: req.body.isActive } }); return result.count ? success(res, null, 'Approval rule updated') : error(res, 'Rule not found', 404, undefined, 'APPROVAL_RULE_NOT_FOUND'); };
export const deleteApprovalRule = async (req: Request, res: Response) => { const result = await prisma.approvalRule.updateMany({ where: { id: req.params.id, tenantId: tenant(req) }, data: { isActive: false } }); return result.count ? success(res, null, 'Approval rule disabled') : error(res, 'Rule not found', 404, undefined, 'APPROVAL_RULE_NOT_FOUND'); };
export const requestApproval = async (req: Request, res: Response) => { const rule = await prisma.approvalRule.findFirst({ where: { tenantId: tenant(req), documentType: req.body.documentType, isActive: true }, orderBy: { priority: 'asc' } }); if (!rule) return error(res, 'No matching approval rule', 422, undefined, 'APPROVAL_RULE_NOT_FOUND'); const steps = Array.isArray(rule.steps) ? rule.steps as any[] : []; const instance = await prisma.approvalInstance.create({ data: { tenantId: tenant(req), companyId: auth(req).user!.companyId, documentType: req.body.documentType, documentId: req.body.documentId, requestedBy: auth(req).user!.id, ruleId: rule.id, actions: { create: steps.map((step: any, index) => ({ tenantId: tenant(req), sequence: step.sequence || index + 1, approverType: step.approverType || 'USER', approverId: step.approverId, dueAt: step.dueHours ? new Date(Date.now() + step.dueHours * 3600000) : undefined })) } }, include: { actions: true } }); return success(res, instance, 'Approval requested', 201); };
export const pendingApprovals = async (req: Request, res: Response) => success(res, await prisma.approvalAction.findMany({ where: { tenantId: tenant(req), status: 'PENDING', OR: [{ approverId: auth(req).user!.id }, { approverId: { in: auth(req).access?.roles.map((r) => r.id) || [] } }] }, include: { instance: true }, orderBy: { createdAt: 'asc' } }));
async function actApproval(req: Request, res: Response, status: 'APPROVED' | 'REJECTED') { if (!auth(req).user!.twoFactorVerified) return error(res, 'Two-factor verification is required', 403, undefined, 'TWO_FACTOR_REQUIRED'); const action = await prisma.approvalAction.findFirst({ where: { id: req.params.id, tenantId: tenant(req), status: 'PENDING' }, include: { instance: { include: { actions: true } } } }); if (!action) return error(res, 'Approval not found', 404, undefined, 'APPROVAL_NOT_FOUND'); await prisma.approvalAction.update({ where: { id: action.id }, data: { status, actedBy: auth(req).user!.id, actedAt: new Date(), comment: req.body.comment } }); if (status === 'REJECTED') await prisma.approvalInstance.update({ where: { id: action.instanceId }, data: { status: 'REJECTED', completedAt: new Date() } }); else if (!action.instance.actions.some((a) => a.id !== action.id && a.status === 'PENDING')) await prisma.approvalInstance.update({ where: { id: action.instanceId }, data: { status: 'APPROVED', completedAt: new Date() } }); return success(res, null, `Approval ${status.toLowerCase()}`); }
export const approve = (req: Request, res: Response) => actApproval(req, res, 'APPROVED');
export const reject = (req: Request, res: Response) => actApproval(req, res, 'REJECTED');
export const delegate = async (req: Request, res: Response) => { const result = await prisma.approvalAction.updateMany({ where: { id: req.params.id, tenantId: tenant(req), status: 'PENDING' }, data: { approverId: req.body.userId, delegatedTo: req.body.userId, status: 'DELEGATED', comment: req.body.comment } }); return result.count ? success(res, null, 'Approval delegated') : error(res, 'Approval not found', 404, undefined, 'APPROVAL_NOT_FOUND'); };

export const getSettings = async (req: Request, res: Response) => { const rows = await prisma.platformSetting.findMany({ where: { tenantId: tenant(req), namespace: String(req.query.namespace || 'general') } }); const effective: any = {}; for (const scope of ['tenant', 'company', 'branch', 'user']) for (const row of rows.filter((r) => scope === 'tenant' ? !r.companyId : scope === 'company' ? r.companyId === auth(req).user!.companyId && !r.branchId : scope === 'branch' ? r.branchId === auth(req).user!.branchId && !r.userId : r.userId === auth(req).user!.id)) effective[row.key] = row.value; return success(res, { effective, rows }); };
export const putSetting = async (req: Request, res: Response) => { const scope = req.body.scope || 'tenant'; const ids = { companyId: ['company', 'branch', 'user'].includes(scope) ? auth(req).user!.companyId : null, branchId: ['branch', 'user'].includes(scope) ? auth(req).user!.branchId : null, userId: scope === 'user' ? auth(req).user!.id : null }; const row = await prisma.platformSetting.upsert({ where: { tenantId_companyId_branchId_userId_namespace_key: { tenantId: tenant(req), ...ids, namespace: req.body.namespace, key: req.body.key } }, update: { value: req.body.value, valueType: req.body.valueType || typeof req.body.value, version: { increment: 1 }, updatedBy: auth(req).user!.id }, create: { tenantId: tenant(req), ...ids, namespace: req.body.namespace, key: req.body.key, value: req.body.value, valueType: req.body.valueType || typeof req.body.value, updatedBy: auth(req).user!.id } }); return success(res, row, 'Setting saved'); };

export const listJobs = async (req: Request, res: Response) => { const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(200, Number(req.query.limit) || 25); const where = { tenantId: tenant(req), ...(req.query.status ? { status: String(req.query.status) } : {}) }; const [items, total] = await Promise.all([prisma.backgroundJob.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }), prisma.backgroundJob.count({ where })]); return paginated(res, items, total, page, limit); };
export const listAudit = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const companyId = auth(req).user!.companyId;
  const moduleName = String(req.query.module || '').trim().toUpperCase();
  const action = String(req.query.action || '').trim().toUpperCase();
  const userId = String(req.query.userId || '').trim();
  const entityId = String(req.query.entityId || '').trim();
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(`${String(req.query.to).slice(0, 10)}T23:59:59.999Z`) : undefined;
  const where: any = {
    tenantId: tenant(req),
    companyId,
    ...(moduleName ? { OR: [{ entityType: { startsWith: `${moduleName}:` } }, { entityType: moduleName.toLowerCase() }] } : {}),
    ...(action ? { action } : {}),
    ...(userId ? { userId } : {}),
    ...(entityId ? { entityId } : {}),
    ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
  };
  const [items, total, users] = await Promise.all([
    prisma.platformAuditLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.platformAuditLog.count({ where }),
    prisma.user.findMany({ where: { companyId: companyId || undefined }, select: { id: true, firstName: true, lastName: true, email: true, role: true, employee: { select: { employeeId: true } } }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
  ]);
  const actors = new Map(users.map(user => [user.id, user]));
  return success(res, { items: items.map(item => ({ ...item, actor: item.userId ? actors.get(item.userId) || null : null })), total, page, limit, totalPages: Math.ceil(total / limit), users });
};
