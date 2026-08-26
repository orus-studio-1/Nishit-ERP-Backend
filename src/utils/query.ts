import { Request } from 'express';

export function standardQuery(req: Request, searchFields: string[] = []) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const sortRaw = String(req.query.sort || '-createdAt');
  const descending = sortRaw.startsWith('-');
  const sort = sortRaw.replace(/^-/, '');
  const q = String(req.query.q || '').trim();
  const and: any[] = [];
  if (q && searchFields.length) and.push({ OR: searchFields.map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) });
  if (req.query.status) and.push({ status: req.query.status });
  if (req.query.from || req.query.to) and.push({ createdAt: { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}) } });
  const include = String(req.query.include || '').split(',').filter(Boolean).reduce((out, key) => ({ ...out, [key]: true }), {});
  const select = String(req.query.fields || '').split(',').filter(Boolean).reduce((out, key) => ({ ...out, [key]: true }), {});
  return { page, limit, skip: (page - 1) * limit, take: limit, where: and.length ? { AND: and } : {}, orderBy: { [sort]: descending ? 'desc' : 'asc' }, ...(Object.keys(include).length ? { include } : {}), ...(Object.keys(select).length ? { select } : {}) };
}
