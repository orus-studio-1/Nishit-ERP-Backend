import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('dashboard', () => 'dashboard'));

router.get('/stats', getDashboardStats);

export default router;
