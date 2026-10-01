import { Request, Response } from 'express';
import { paginated } from './response';

/** Parses ?page=&limit= off a request the same way every list endpoint in this codebase does:
 * defaults to page 1 / `defaultLimit` per page (20 unless overridden), clamped to [1, 200]. */
export function pageParams(req: Request, defaultLimit = 20) {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || defaultLimit, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

interface PrismaListDelegate<T> {
  findMany: (args: any) => Promise<T[]>;
  count: (args: any) => Promise<number>;
}

/** Runs the findMany+count pair every list endpoint repeats, with the same skip/take math, and
 * returns { items, total, page, limit } ready to pass into `paginated()`. `where` is the only
 * thing that usually differs per endpoint; `include`/`orderBy` are optional. */
export async function paginateQuery<T>(
  model: PrismaListDelegate<T>,
  req: Request,
  options: { where?: any; include?: any; orderBy?: any; defaultLimit?: number } = {},
) {
  const { page, limit, skip } = pageParams(req, options.defaultLimit);
  const { where = {}, include, orderBy = { createdAt: 'desc' } } = options;
  const [items, total] = await Promise.all([
    model.findMany({ where, include, orderBy, skip, take: limit }),
    model.count({ where }),
  ]);
  return { items, total, page, limit };
}

/** Same as paginateQuery, but writes the paginated() response directly — for the common case
 * where the handler has nothing else to do with the result. */
export async function respondPaginated<T>(
  res: Response,
  model: PrismaListDelegate<T>,
  req: Request,
  options: { where?: any; include?: any; orderBy?: any; defaultLimit?: number } = {},
) {
  const { items, total, page, limit } = await paginateQuery(model, req, options);
  return paginated(res, items, total, page, limit);
}
