import { RequestHandler, Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  calculateScheme,
  createScheme,
  createSlab,
  editSlab,
  getScheme,
  getSummary,
  listContributions,
  listRuns,
  listSchemes,
  removeSlab,
  setBillingType,
  updateScheme,
  updateSchemeStatus,
} from '../controllers/incentives/incentives.controller';

// The auth middleware is injectable so the real routing and permission checks can be exercised
// without a JWT (see src/scripts/poc/incentiveApiCheck.ts). Production always uses authenticate.
export function createIncentiveRouter(auth: RequestHandler = authenticate) {
  const router = Router();
  router.use(auth);

  router.get('/schemes', requirePermission('incentives', 'schemes', 'READ'), listSchemes);
  router.post('/schemes', requirePermission('incentives', 'schemes', 'CREATE'), createScheme);
  router.get('/schemes/:id', requirePermission('incentives', 'schemes', 'READ'), getScheme);
  router.put('/schemes/:id', requirePermission('incentives', 'schemes', 'WRITE'), updateScheme);
  router.patch('/schemes/:id/status', requirePermission('incentives', 'schemes', 'WRITE'), updateSchemeStatus);

  router.post('/schemes/:id/slabs', requirePermission('incentives', 'schemes', 'WRITE'), createSlab);
  router.put('/schemes/:id/slabs/:slabId', requirePermission('incentives', 'schemes', 'WRITE'), editSlab);
  router.delete('/schemes/:id/slabs/:slabId', requirePermission('incentives', 'schemes', 'DELETE'), removeSlab);

  router.get('/schemes/:id/summary', requirePermission('incentives', 'schemes', 'READ'), getSummary);
  router.get('/schemes/:id/contributions', requirePermission('incentives', 'contributions', 'READ'), listContributions);
  router.get('/schemes/:id/runs', requirePermission('incentives', 'calculations', 'READ'), listRuns);
  router.post('/schemes/:id/calculate', requirePermission('incentives', 'calculations', 'MANAGE'), calculateScheme);

  router.put('/invoices/:invoiceId/billing-type', requirePermission('incentives', 'invoices', 'WRITE'), setBillingType);

  return router;
}

export default createIncentiveRouter();
