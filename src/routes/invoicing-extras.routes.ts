import { Router } from 'express';
import {
  createCreditNote,
  createCreditNoteFromInvoice,
  createPrintFormat,
  createSubscription,
  createTaxTemplate,
  getCreditNote,
  getCreditNotes,
  getLedgerEntries,
  getOutstandingInvoices,
  getPrintFormats,
  getRevenueByCustomer,
  getRevenueByItem,
  getRevenueByPeriod,
  getSubscriptions,
  getTaxTemplates,
  getAuditLogs,
  updateCreditNoteStatus,
  updateTaxTemplate,
  runDueSubscriptions,
  updatePrintFormat,
  updateSubscription,
} from '../controllers/invoicingExtras.controller';
import { authenticate, authorize, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('invoicing'));

router.route('/tax-templates').get(getTaxTemplates).post(createTaxTemplate);
router.patch('/tax-templates/:id', updateTaxTemplate);

router.route('/credit-notes').get(getCreditNotes).post(createCreditNote);
router.post('/credit-notes/from-invoice/:invoiceId', createCreditNoteFromInvoice);
router.get('/credit-notes/:id', getCreditNote);
router.patch('/credit-notes/:id/status', updateCreditNoteStatus);

router.get('/ledger', getLedgerEntries);

router.route('/print-formats').get(getPrintFormats).post(createPrintFormat);
router.patch('/print-formats/:id', updatePrintFormat);

router.route('/subscriptions').get(getSubscriptions).post(createSubscription);
router.patch('/subscriptions/:id', updateSubscription);
router.post('/subscriptions/run-due', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), runDueSubscriptions);

router.get('/audit-logs', getAuditLogs);

router.get('/reports/outstanding', getOutstandingInvoices);
router.get('/reports/revenue-by-customer', getRevenueByCustomer);
router.get('/reports/revenue-by-item', getRevenueByItem);
router.get('/reports/revenue-by-period', getRevenueByPeriod);

export default router;
