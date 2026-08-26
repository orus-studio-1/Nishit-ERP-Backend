import { Response } from 'express';
import { error } from './response';

export function handlePrismaError(res: Response, err: any) {
  const code = err?.code;
  console.error('Prisma/API error:', {
    code,
    message: err?.message,
    meta: err?.meta,
  });

  if (code === 'P2002') {
    const targets = Array.isArray(err?.meta?.target) ? err.meta.target : [];
    const field = targets.find((target: string) => target !== 'companyId') || targets[0] || 'field';
    return error(res, `A record with this ${field} already exists.`, 400);
  }
  if (code === 'P2003') {
    return error(res, 'Related record not found. Check that referenced items exist.', 400);
  }
  if (code === 'P2025') {
    return error(res, 'Record not found.', 404);
  }
  if (code === 'P2014') {
    return error(res, 'This action would violate a required relationship.', 400);
  }
  if (code === 'P2011') {
    return error(res, 'A required field is missing.', 400);
  }
  if (err?.name === 'PrismaClientValidationError') {
    return error(res, 'The request contains an unsupported or missing field. Refresh the page and check the required values.', 400);
  }
  if (code === 'P2021') {
    return error(res, 'Database table is missing. Run Prisma db push/migrate and restart the backend.', 400, process.env.NODE_ENV === 'production' ? undefined : err?.meta);
  }
  if (code === 'P2022') {
    return error(res, 'Database column is missing. Run Prisma db push/migrate and restart the backend.', 400, process.env.NODE_ENV === 'production' ? undefined : err?.meta);
  }
  if (code === 'P2028') {
    return error(res, 'Database transaction timed out. Restart the backend so the updated Prisma transaction settings are active.', 400, process.env.NODE_ENV === 'production' ? undefined : err?.meta);
  }
  if (code?.startsWith('P')) {
    return error(res, 'Database error. Please check your input and try again.', 400, process.env.NODE_ENV === 'production' ? undefined : { code, meta: err?.meta });
  }

  return error(res, 'Something went wrong. Please try again.', 500);
}
