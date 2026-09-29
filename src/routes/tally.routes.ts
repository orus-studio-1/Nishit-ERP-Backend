import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { triggerManualSync } from '../controllers/tally.controller';
import {
  getConnectionStatus,
  saveCompany,
  createSyncJob,
  listSyncJobs,
  getSyncJob
} from '../controllers/tallyDashboard.controller';

const router = Router();

// Frontend UI Routes for Tally Integration Settings
router.get('/connection-status', authenticate, getConnectionStatus);
router.put('/connection/company', authenticate, saveCompany);
router.post('/sync', authenticate, createSyncJob); // Overrides the old triggerManualSync
router.get('/sync', authenticate, listSyncJobs);
router.get('/sync/:id', authenticate, getSyncJob);

export default router;
