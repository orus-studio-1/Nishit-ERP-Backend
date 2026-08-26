import { Router } from 'express';
import { convertQuotationToOrder } from '../controllers/sales.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('sales', () => 'sales-orders'));

router.post('/from-quotation/:id', convertQuotationToOrder);

export default router;
