import { Response } from 'express';

export const success = (res: Response, data: any, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const paginated = (res: Response, items: any[], total: number, page: number, limit: number) =>
  res.status(200).json({
    success: true,
    data: { items, total, page, limit, totalPages: Math.ceil(total / limit) },
  });

export const error = (res: Response, message = 'An error occurred', status = 400, errors?: any, code = 'REQUEST_FAILED') =>
  res.status(status).json({ success: false, message, code, ...(errors ? { errors } : {}) });
