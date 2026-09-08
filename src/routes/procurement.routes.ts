import { Router } from 'express';
import {
  addSupplierCommunication,
  compareSupplierQuotations,
  createBlanketPurchaseOrder,
  createLandedCostVoucher,
  createMaterialRequest,
  createMaterialRequestsFromReorder,
  createPaymentTerms,
  createPurchaseInvoice,
  createPurchaseOrder,
  createPurchaseOrderFromSupplierQuotation,
  createPurchaseReceipt,
  createPurchaseReceiptFromPurchaseOrder,
  createQualityInspection,
  createRfq,
  createRfqFromMaterialRequest,
  createSupplierItem,
  createSupplierPayment,
  createSupplierQuotation,
  deletePurchaseInvoice,
  deletePurchaseOrder,
  getBlanketPurchaseOrders,
  getBuyingSettings,
  getLandedCostVouchers,
  getMaterialRequests,
  getPaymentTerms,
  getProcurementDashboard,
  getProcurementTracker,
  getPurchaseInvoices,
  getPurchaseOrder,
  getPurchaseOrders,
  getPurchaseReceipts,
  getQualityInspections,
  getRfqs,
  getSupplierItems,
  getSupplierCommunications,
  getSupplierPayments,
  getSupplierQuotations,
  updateBuyingSettings,
  updateLandedCostVoucherStatus,
  updateMaterialRequestStatus,
  updatePurchaseInvoiceStatus,
  updatePurchaseOrderStatus,
  updatePurchaseReceiptStatus,
  updateRfqStatus,
  updateSupplierPaymentStatus,
} from '../controllers/procurement.controller';
import { authenticate, requireModuleAccess, requirePermission } from '../middleware/auth';
import {
  acknowledgeRfq,
  acknowledgePurchaseOrder,
  approveMatchException,
  calculateVendorRatings,
  comparison,
  completeInspection,
  createGateEntry,
  createGrnFromGate,
  createPurchaseReturn,
  generateSelectedPurchaseOrders,
  materialRequestSourcing,
  procurementReport,
  purchaseOrderOperation,
  reviseSupplierQuotation,
  rfqOperation,
  runMatch,
  selectRfqVendors,
  submitPurchaseReturn,
  validateGateEntry,
  recordPurchaseDispatch,
  followUpPurchaseDelay,
} from '../controllers/procurement/completion.controller';
import { getProcurementAuditTrail } from '../controllers/procurement/audit.controller';
import { addProcurementCaseCommunication, communicatePurchaseOrderDelay, createSupplierWorkspaceCommunication, getProcurementCase, getPurchaseOrderWorkspace, getSupplierCommunicationWorkspace, retrySupplierCommunication, submitProcurementCaseRfq, updatePurchaseOrderCommitment, updateSupplierQuotationLifecycle } from '../controllers/procurement/workspace.controller';

const router = Router();
router.post('/rfqs/vendor/:token/acknowledge', acknowledgeRfq);
router.post('/purchase-orders/vendor/:token/acknowledge', acknowledgePurchaseOrder);
router.use(authenticate);
router.get('/audit-trail', requirePermission('access', 'audit', 'READ'), getProcurementAuditTrail);
router.use(requireModuleAccess('procurement'));

router.get('/dashboard', getProcurementDashboard);
router.get('/tracker', getProcurementTracker);

router.route('/settings').get(getBuyingSettings).put(updateBuyingSettings).patch(updateBuyingSettings);
router.route('/payment-terms').get(getPaymentTerms).post(createPaymentTerms);
router.route('/supplier-items').get(getSupplierItems).post(createSupplierItem);
router.route('/communications').get(getSupplierCommunications).post(addSupplierCommunication);
router.get('/suppliers/:supplierId/communication-workspace', getSupplierCommunicationWorkspace);
router.post('/suppliers/:supplierId/communications', createSupplierWorkspaceCommunication);
router.post('/communications/:id/retry', retrySupplierCommunication);

router.route('/material-requests').get(getMaterialRequests).post(createMaterialRequest);
router.post('/material-requests/from-reorder', createMaterialRequestsFromReorder);
router.patch('/material-requests/:id/status', updateMaterialRequestStatus);
router.post('/material-requests/:id/rfq', createRfqFromMaterialRequest);
router.post('/material-requests/:id/:operation', materialRequestSourcing);

router.route('/rfqs').get(getRfqs).post(createRfq);
router.get('/rfqs/:id/workspace', getProcurementCase);
router.post('/rfqs/:id/communications', addProcurementCaseCommunication);
router.post('/rfqs/:id/submit', submitProcurementCaseRfq);
router.patch('/rfqs/:id/status', updateRfqStatus);
router.get('/rfqs/:rfqId/compare', compareSupplierQuotations);
router.get('/rfqs/:id/comparison', comparison);
router.post('/rfqs/:id/selections', selectRfqVendors);
router.post('/rfqs/:id/generate-purchase-orders', generateSelectedPurchaseOrders);
router.post('/rfqs/:id/:operation', rfqOperation);

router.route('/supplier-quotations').get(getSupplierQuotations).post(createSupplierQuotation);
router.post('/supplier-quotations/:id/lifecycle/:action', updateSupplierQuotationLifecycle);
router.post('/supplier-quotations/:id/purchase-order', createPurchaseOrderFromSupplierQuotation);
router.post('/supplier-quotations/:id/revise', reviseSupplierQuotation);

router.route('/blanket-purchase-orders').get(getBlanketPurchaseOrders).post(createBlanketPurchaseOrder);

router.route('/purchase-orders').get(getPurchaseOrders).post(createPurchaseOrder);
router.get('/purchase-orders/:id/workspace', getPurchaseOrderWorkspace);
router.patch('/purchase-orders/:id/commitment', updatePurchaseOrderCommitment);
router.post('/purchase-orders/:id/communicate', communicatePurchaseOrderDelay);
router.route('/purchase-orders/:id').get(getPurchaseOrder).delete(deletePurchaseOrder);
router.put('/purchase-orders/:id/status', updatePurchaseOrderStatus);
router.patch('/purchase-orders/:id/status', updatePurchaseOrderStatus);
router.post('/purchase-orders/:id/receipt', createPurchaseReceiptFromPurchaseOrder);
router.post('/purchase-orders/:id/dispatch', recordPurchaseDispatch);
router.post('/purchase-orders/:id/delay-follow-up', followUpPurchaseDelay);
router.post('/purchase-orders/:id/:operation', purchaseOrderOperation);

router.post('/gate-entries', createGateEntry);
router.post('/gate-entries/:id/validate', validateGateEntry);
router.post('/gate-entries/:id/create-grn', createGrnFromGate);

router.route('/purchase-receipts').get(getPurchaseReceipts).post(createPurchaseReceipt);
router.patch('/purchase-receipts/:id/status', updatePurchaseReceiptStatus);

router.route('/quality-inspections').get(getQualityInspections).post(createQualityInspection);
router.post('/quality-inspections/:id/complete', completeInspection);
router.post('/purchase-returns', createPurchaseReturn);
router.post('/purchase-returns/:id/submit', submitPurchaseReturn);

router.route('/landed-cost-vouchers').get(getLandedCostVouchers).post(createLandedCostVoucher);
router.patch('/landed-cost-vouchers/:id/status', updateLandedCostVoucherStatus);

router.route('/purchase-invoices').get(getPurchaseInvoices).post(createPurchaseInvoice);
router.put('/purchase-invoices/:id/status', updatePurchaseInvoiceStatus);
router.patch('/purchase-invoices/:id/status', updatePurchaseInvoiceStatus);
router.delete('/purchase-invoices/:id', deletePurchaseInvoice);
router.post('/purchase-invoices/:invoiceId/match', runMatch);
router.post('/three-way-matches/:id/approve-exception', approveMatchException);

router.route('/supplier-payments').get(getSupplierPayments).post(createSupplierPayment);
router.patch('/supplier-payments/:id/status', updateSupplierPaymentStatus);

router.post('/vendor-ratings/calculate', calculateVendorRatings);
router.get('/reports/:type', procurementReport);

export default router;
