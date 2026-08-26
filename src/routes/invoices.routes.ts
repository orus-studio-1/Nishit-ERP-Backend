import { Router } from 'express';
import {
  amendInvoice,
  createInvoice,
  createInvoiceFromDeliveryNote,
  createInvoiceFromSalesOrder,
  deleteInvoice,
  getAgingReport,
  getInvoice,
  getInvoiceFilterOptions,
  getInvoicePdf,
  getInvoices,
  updateInvoice,
  updateInvoiceStatus,
} from '../controllers/invoices.controller';
import { authenticate, authorize, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('invoicing', (req) => req.path.includes('aging-report') ? 'reports' : 'sales-invoices'));

router.get('/aging-report', getAgingReport);
router.get('/filter-options', getInvoiceFilterOptions);
router.post('/from-sales-order/:salesOrderId', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), createInvoiceFromSalesOrder);
router.post('/from-delivery-note/:deliveryNoteId', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), createInvoiceFromDeliveryNote);
router.route('/').get(getInvoices).post(authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), createInvoice);
router.route('/:id').get(getInvoice).patch(authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_REP'), updateInvoice).delete(authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), deleteInvoice);
router.patch('/:id/status', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), updateInvoiceStatus);
router.post('/:id/amend', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), amendInvoice);
router.get('/:id/pdf', getInvoicePdf);

export default router;
