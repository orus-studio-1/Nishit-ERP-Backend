import { Router } from 'express';
import {
  createInvoice as createSalesInvoice,
  createInvoiceFromSalesOrder,
  createInvoiceFromDeliveryNote,
  createPayment,
  deleteInvoice as deleteSalesInvoice,
  deletePayment,
  getAgingReport,
  getInvoice as getSalesInvoice,
  getInvoices as getSalesInvoices,
  getPayment,
  getPayments,
  getInvoicePdf,
  amendInvoice,
  updateInvoice as updateSalesInvoice,
  updateInvoiceStatus,
} from '../controllers/invoices.controller';
import { getCustomerInvoices, getCustomerOutstanding as getCustomerOutstandingSummary } from '../controllers/customers.controller';
import { searchProducts } from '../controllers/inventory.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('invoicing'));

router.route('/sales-invoices').get(getSalesInvoices).post(createSalesInvoice);
router.route('/sales-invoices/:id').get(getSalesInvoice).patch(updateSalesInvoice).delete(deleteSalesInvoice);
router.put('/sales-invoices/:id/status', updateInvoiceStatus);
router.patch('/sales-invoices/:id/status', updateInvoiceStatus);
router.post('/sales-invoices/:id/amend', amendInvoice);
router.get('/sales-invoices/:id/pdf', getInvoicePdf);
router.post('/invoices/from-sales-order/:salesOrderId', createInvoiceFromSalesOrder);
router.post('/invoices/from-delivery-note/:deliveryNoteId', createInvoiceFromDeliveryNote);
router.patch('/invoices/:id', updateSalesInvoice);

router.route('/payments').get(getPayments).post(createPayment);
router.get('/payments/:id', getPayment);
router.delete('/payments/:id', deletePayment);

router.route('/customers/:id/invoices').get(getCustomerInvoices);
router.route('/customers/:id/outstanding').get(getCustomerOutstandingSummary);
router.route('/products/search').get(searchProducts);

// Registering Aging Report Endpoint (Keep it above /invoices/:id)
router.get('/invoices/aging-report', getAgingReport);

export default router;
