// Incentive scheme endpoints. Thin: parsing and response shaping only. Validation and
// business rules live in services/incentives. Tenant scoping is applied by the Prisma
// tenant proxy (see services/incentives/incentiveScheme.service.ts).

import { Response } from 'express';
import prisma from '../../lib/prisma';
import { AuthRequest } from '../../middleware/auth';
import { success, paginated, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { normalizeManufacturer } from '../../services/incentives/incentiveCalculation';
import { setInvoiceBillingType } from '../../services/incentives/incentiveBillingType.service';
import { runIncentiveCalculation } from '../../services/incentives/incentiveCalculation.service';
import {
  IncentiveNotFoundError,
  IncentiveValidationError,
  SCHEME_STATUSES,
  addSlab,
  changeSchemeStatus,
  createIncentiveScheme,
  deleteSlab,
  getSchemeOrThrow,
  getSchemeSummary,
  updateIncentiveScheme,
  updateSlab,
} from '../../services/incentives/incentiveScheme.service';

function handleError(res: Response, err: any) {
  if (err instanceof IncentiveValidationError) return error(res, err.message, 400, err.details?.length ? err.details : undefined, 'VALIDATION_FAILED');
  if (err instanceof IncentiveNotFoundError) return error(res, err.message, 404, undefined, 'NOT_FOUND');
  return handlePrismaError(res, err);
}

function pageParams(req: AuthRequest) {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

export const listSchemes = async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const { status, manufacturer, search } = req.query as Record<string, string | undefined>;
    const where: any = {};
    if (status) where.status = status;
    if (manufacturer) where.manufacturerKey = normalizeManufacturer(manufacturer);
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }];
    if (status && !(SCHEME_STATUSES as readonly string[]).includes(status)) {
      return error(res, `status must be one of: ${SCHEME_STATUSES.join(', ')}`, 400, undefined, 'VALIDATION_FAILED');
    }

    const [items, total] = await Promise.all([
      prisma.incentiveScheme.findMany({ where, include: { _count: { select: { slabs: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.incentiveScheme.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err) {
    return handleError(res, err);
  }
};

export const createScheme = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await createIncentiveScheme(req.body ?? {}), 'Incentive scheme created', 201);
  } catch (err) {
    return handleError(res, err);
  }
};

export const getScheme = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await getSchemeOrThrow(req.params.id, true));
  } catch (err) {
    return handleError(res, err);
  }
};

export const updateScheme = async (req: AuthRequest, res: Response) => {
  try {
    const result = await updateIncentiveScheme(req.params.id, req.body ?? {});
    const message = result.recalculationRecommended
      ? 'Incentive scheme updated. Recalculate to apply the change to existing results.'
      : 'Incentive scheme updated';
    return success(res, result, message);
  } catch (err) {
    return handleError(res, err);
  }
};

export const updateSchemeStatus = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await changeSchemeStatus(req.params.id, req.body?.status), 'Incentive scheme status updated');
  } catch (err) {
    return handleError(res, err);
  }
};

export const createSlab = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await addSlab(req.params.id, req.body ?? {}), 'Slab added', 201);
  } catch (err) {
    return handleError(res, err);
  }
};

export const editSlab = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await updateSlab(req.params.id, req.params.slabId, req.body ?? {}), 'Slab updated');
  } catch (err) {
    return handleError(res, err);
  }
};

export const removeSlab = async (req: AuthRequest, res: Response) => {
  try {
    await deleteSlab(req.params.id, req.params.slabId);
    return success(res, null, 'Slab deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

/** Manual recalculation over the scheme's complete period. Not automatic: see the design notes. */
export const calculateScheme = async (req: AuthRequest, res: Response) => {
  try {
    await getSchemeOrThrow(req.params.id);
    const summary = await runIncentiveCalculation(req.params.id, { reason: 'MANUAL_RECALC', triggeredBy: req.user?.id });
    const { perInvoiceDetail, ...rest } = summary;
    const detail = req.query.detail === 'true' ? { perInvoiceDetail } : {};
    return success(res, { ...rest, ...detail }, 'Calculation completed');
  } catch (err: any) {
    // Guard failures (inactive scheme, invalid slabs) are input problems, not server errors.
    if (typeof err?.message === 'string' && err.message.startsWith('Cannot calculate scheme')) {
      return error(res, err.message, 400, undefined, 'CALCULATION_NOT_ALLOWED');
    }
    return handleError(res, err);
  }
};

export const getSummary = async (req: AuthRequest, res: Response) => {
  try {
    return success(res, await getSchemeSummary(req.params.id));
  } catch (err) {
    return handleError(res, err);
  }
};

export const listContributions = async (req: AuthRequest, res: Response) => {
  try {
    await getSchemeOrThrow(req.params.id);
    const { page, limit, skip } = pageParams(req);
    const status = (req.query.status as string | undefined) ?? 'ACTIVE';
    const where: any = { schemeId: req.params.id };
    if (status !== 'ALL') {
      if (!['ACTIVE', 'SUPERSEDED', 'REVERSED'].includes(status)) {
        return error(res, 'status must be one of: ACTIVE, SUPERSEDED, REVERSED, ALL', 400, undefined, 'VALIDATION_FAILED');
      }
      where.lifecycleStatus = status;
    }
    if (req.query.purchaseInvoiceId) where.purchaseInvoiceId = req.query.purchaseInvoiceId as string;

    const [items, total] = await Promise.all([
      prisma.incentiveContribution.findMany({
        where,
        include: {
          purchaseInvoice: { select: { id: true, invoiceNo: true, date: true, tradeType: true, supplierId: true } },
          lines: true,
        },
        orderBy: { calculatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.incentiveContribution.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err) {
    return handleError(res, err);
  }
};

export const listRuns = async (req: AuthRequest, res: Response) => {
  try {
    await getSchemeOrThrow(req.params.id);
    const { page, limit, skip } = pageParams(req);
    const where = { schemeId: req.params.id };
    const [items, total] = await Promise.all([
      prisma.incentiveCalculationRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit }),
      prisma.incentiveCalculationRun.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err) {
    return handleError(res, err);
  }
};

export const setBillingType = async (req: AuthRequest, res: Response) => {
  try {
    const result = await setInvoiceBillingType(req.params.invoiceId, req.body ?? {});
    const message = result.recalculationRecommended ? 'Billing type saved. Recalculate schemes to apply it to results.' : 'Billing type saved';
    return success(res, result, message);
  } catch (err) {
    return handleError(res, err);
  }
};
