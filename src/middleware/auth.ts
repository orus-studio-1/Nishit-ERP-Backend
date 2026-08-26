import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { error } from '../utils/response';
import { computeEffectiveAccess, firstPathSegment, getActionForRequest, hasPermission, EffectiveAccess } from '../utils/accessControl';
import { runWithTenant } from '../utils/tenant';
import prisma from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; tenantId?: string | null; companyId?: string | null; branchId?: string | null; twoFactorVerified?: boolean };
  context?: { tenantId?: string | null; companyId?: string | null; branchId?: string | null; userId: string; requestId: string };
  access?: EffectiveAccess;
  permissionGatePassed?: boolean;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    error(res, 'No token provided', 401);
    return;
  }
  let decoded: any;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
  } catch {
    error(res, 'Invalid or expired token', 401);
    return;
  }

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        companyId: true,
        isActive: true,
        tokenVersion: true,
        company: { select: { tenantId: true, branches: { where: { isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 } } },
      },
    });
    if (!currentUser || !currentUser.isActive) {
      error(res, 'Account is inactive or no longer exists', 401);
      return;
    }
    if (decoded.tokenVersion !== undefined && currentUser.tokenVersion !== undefined && decoded.tokenVersion !== currentUser.tokenVersion) {
      error(res, 'Session has been revoked. Please sign in again.', 401);
      return;
    }
    if (!currentUser.companyId) {
      error(res, 'Your account is not assigned to a company. Contact an administrator.', 403);
      return;
    }
    const companyId = currentUser.companyId;
    req.user = { id: currentUser.id, email: currentUser.email, role: currentUser.role, tenantId: currentUser.company?.tenantId, companyId, branchId: currentUser.company?.branches[0]?.id || null, twoFactorVerified: Boolean(decoded.twoFactorVerified) };
    req.context = { tenantId: req.user.tenantId, companyId, branchId: req.user.branchId, userId: currentUser.id, requestId: String(req.headers['x-request-id'] || crypto.randomUUID()) };
    req.access = await computeEffectiveAccess(decoded.id);
    if (!req.user.companyId && req.access.companyId) req.user.companyId = req.access.companyId;
    runWithTenant(req.context, () => next());
  } catch (err: any) {
    console.error('Unable to load authenticated session:', err);
    error(res, 'Unable to load your session. Please try again.', 500);
  }
};

export const authorize = (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.access?.isSuperAdmin) {
      next();
      return;
    }
    if (!req.user || !roles.includes(req.user.role)) {
      error(res, 'Insufficient permissions', 403);
      return;
    }
    next();
  };

export const requirePermission = (module: string, resource: string, action: any) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (hasPermission(req.access, module, resource, action)) {
      req.permissionGatePassed = true;
      next();
      return;
    }
    error(res, `Missing permission: ${module}:${resource}:${action}`.toLowerCase(), 403);
  };

export const requireModuleAccess = (module: string, resourceResolver?: (req: Request) => string) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const action = getActionForRequest(req.method, req.path);
    const segment = resourceResolver ? resourceResolver(req) : firstPathSegment(req.path);
    const aliases: Record<string, Record<string, string>> = {
      hr: { 'leave-types': 'leave', 'leave-requests': 'leave', 'leave-balances': 'leave', 'leave-allocations': 'leave', 'leave-policies': 'leave', 'leave-ledger': 'leave', 'salary-components': 'salary', 'salary-structures': 'salary', 'salary-slips': 'salary', 'salary-structure-assignments': 'salary', 'payroll-entries': 'payroll', 'shift-types': 'shifts', 'shift-assignments': 'shifts', 'shift-roster': 'shifts', 'shift-auto-attendance': 'shifts', 'lifecycle-events': 'lifecycle' },
      inventory: { reports: 'reports', 'uom-conversions': 'units' },
      accounting: { 'trial-balance': 'reports', 'fixed-assets': 'accounts', 'journal-templates': 'journal-entries', 'recurring-journals': 'journal-entries', 'period-closing-vouchers': 'period-closing' },
      invoicing: { customers: 'sales-invoices', products: 'sales-invoices', invoices: 'sales-invoices', 'audit-logs': 'audit-log' },
      sales: { orders: 'sales-orders' },
    };
    const resource = aliases[module]?.[segment] || segment;
    if (hasPermission(req.access, module, resource, action)) {
      req.permissionGatePassed = true;
      next();
      return;
    }
    error(res, `Access denied for ${action.toLowerCase()} on ${module}/${resource}`, 403);
  };
