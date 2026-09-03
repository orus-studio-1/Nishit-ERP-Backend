import { Router } from 'express';
import {
  createDeliveryNote,
  createDeliveryNoteFromSalesOrder,
  createAndDispatchFromSalesOrder,
  getDeliveryNote,
  getDeliveryNotes,
  getDeliveryWorkspace,
  updateDeliveryNoteStatus,
  updateShipmentStatus,
} from '../controllers/deliveryNotes.controller';
import { authenticate, authorize, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('invoicing', () => 'delivery-notes'));

router.post('/from-sales-order/:salesOrderId', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), createDeliveryNoteFromSalesOrder);
router.post('/from-sales-order/:salesOrderId/dispatch', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_REP'), createAndDispatchFromSalesOrder);
router.route('/').get(getDeliveryNotes).post(authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), createDeliveryNote);
router.get('/:id/workspace', getDeliveryWorkspace);
router.route('/:id').get(getDeliveryNote);
router.patch('/:id/status', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER'), updateDeliveryNoteStatus);
router.patch('/:id/shipment', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_REP'), updateShipmentStatus);

export default router;
