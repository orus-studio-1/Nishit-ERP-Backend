import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { cacheBackend, cacheEpoch, cacheGet, cacheSet, invalidateApiCache } from '../services/platform/cache.service';

const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const excluded = ['/api/auth', '/api/v1/auth', '/health', '/api/platform', '/api/v1/platform'];
const ttlFor = (path: string) => path.includes('/settings') || path.includes('/warehouses') || path.includes('/categories') || path.includes('/units') ? 300 : path.includes('/reports') ? 120 : path.includes('/dashboard') || path.includes('/fulfilment') || path.includes('/stock') || path.includes('/delivery') ? 15 : 45;

export async function apiResponseCache(req: Request, res: Response, next: NextFunction) {
  if (process.env.CACHE_ENABLED === 'false' || excluded.some(prefix => req.path.startsWith(prefix))) { res.setHeader('X-Cache', 'BYPASS'); return next(); }
  if (mutations.has(req.method)) {
    res.on('finish', () => { if (res.statusCode >= 200 && res.statusCode < 400) void invalidateApiCache(); });
    return next();
  }
  if (req.method !== 'GET' || req.headers.authorization?.startsWith('Basic ')) return next();
  const authReq = req as any;
  const identity = crypto.createHash('sha256').update(`${authReq.user?.id || 'anonymous'}:${authReq.user?.companyId || ''}:${authReq.user?.role || ''}`).digest('hex').slice(0, 24);
  const epoch = await cacheEpoch();
  const key = `nishit:api:${epoch}:${identity}:${crypto.createHash('sha256').update(req.originalUrl).digest('hex')}`;
  const cached = await cacheGet(key);
  if (cached) { res.setHeader('X-Cache', 'HIT'); res.setHeader('X-Cache-Backend', cacheBackend()); return res.type('application/json').send(cached); }
  res.setHeader('X-Cache', 'MISS'); res.setHeader('X-Cache-Backend', cacheBackend());
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode >= 200 && res.statusCode < 300) void cacheSet(key, JSON.stringify(body), ttlFor(req.path));
    return originalJson(body);
  }) as any;
  next();
}
