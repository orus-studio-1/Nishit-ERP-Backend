import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { AuthRequest } from './auth';
import { error } from '../utils/response';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export async function idempotency(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method !== 'POST' || req.path.startsWith('/auth/')) return next();
  const key = String(req.headers['idempotency-key'] || '');
  if (!key) return error(res, 'Idempotency-Key header is required', 400, [{ field: 'Idempotency-Key', message: 'Required for document and money POST requests' }], 'IDEMPOTENCY_KEY_REQUIRED');
  const tenantId = req.user?.tenantId;
  if (!tenantId) return error(res, 'Tenant context is required', 403, undefined, 'TENANT_REQUIRED');
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ method: req.method, path: req.originalUrl, body: req.body })).digest('hex');
  const existing = await prisma.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (existing) {
    if (existing.requestHash !== requestHash) return error(res, 'Idempotency key was used with a different request', 409, undefined, 'IDEMPOTENCY_CONFLICT');
    if (existing.state === 'COMPLETED') return res.status(200).json(existing.responseBody);
    return error(res, 'An identical request is already processing', 409, undefined, 'IDEMPOTENCY_IN_PROGRESS');
  }
  await prisma.idempotencyRecord.create({ data: { tenantId, key, requestHash, method: req.method, path: req.originalUrl, expiresAt: new Date(Date.now() + 86400000) } });
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    const completed = res.statusCode < 500;
    prisma.idempotencyRecord.update({ where: { tenantId_key: { tenantId, key } }, data: { state: completed ? 'COMPLETED' : 'FAILED', statusCode: res.statusCode, responseBody: body, completedAt: new Date() } }).catch(() => null);
    return originalJson(body);
  }) as any;
  next();
}

export function optimisticConcurrency(req: Request, res: Response, next: NextFunction) {
  if (!['PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const value = req.headers['if-match'] ?? req.body?.version;
  if (value == null) return error(res, 'If-Match header or version field is required', 428, [{ field: 'version', message: 'Required for mutable resources' }], 'VERSION_REQUIRED');
  const parsed = Number(String(value).replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(parsed) || parsed < 1) return error(res, 'Version must be a positive integer', 400, undefined, 'VERSION_INVALID');
  (req as any).expectedVersion = parsed;
  next();
}

export function mutationAudit(req: AuthRequest, res: Response, next: NextFunction) {
  if (!mutationMethods.has(req.method)) return next();
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (req.user && res.statusCode < 500) prisma.platformAuditLog.create({ data: { tenantId: req.user.tenantId || undefined, companyId: req.user.companyId, branchId: req.user.branchId || undefined, userId: req.user.id, entityType: req.path.split('/').filter(Boolean)[0] || 'request', entityId: req.params?.id, action: `${req.method} ${req.path}`, after: body?.data ?? body, ip: req.ip, userAgent: req.get('user-agent'), requestId: req.context?.requestId } }).catch(() => null);
    return originalJson(body);
  }) as any;
  next();
}

