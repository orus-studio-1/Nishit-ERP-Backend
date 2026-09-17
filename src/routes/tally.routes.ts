import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { triggerManualSync } from '../controllers/tally.controller';

const router = Router();

// Only allow Admins to trigger manual Tally sync via the API
router.post('/sync', authenticate, authorize('ADMIN'), triggerManualSync);

export default router;
