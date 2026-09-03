import { Router } from 'express';
import {
  getQuotations, getQuotation, createQuotation, updateQuotation, deleteQuotation, convertQuotationToOrder,
  getSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrderStatus, deleteSalesOrder,
  updateQuotationStatus,updateSalesOrder
} from '../controllers/sales.controller';
import { getQuotationArtifact } from '../controllers/sales/quotations.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';
import {
  availableToPromise, convertEnquiry, createEnquiry, closeSalesCase, createProductionPlan, createSalesOrderMaterialRequest, updateSalesOrderPromises, updateSalesOrderPicking, shortCloseSalesOrderLines,
  createSalesCommunication, retrySalesCommunication, followUpEnquiry, listSalesCommunications, loseEnquiry, sendShippingNotification,
  fulfilmentDashboard, getCreditExposure, getEnquiry, getSalesCaseWorkspace, listEnquiries, listCommitmentAlerts, acknowledgeCommitmentAlert, getSalesAlertPolicy, updateSalesAlertPolicy,
  orderOperation, quotationOperation, salesReport, submitEnquiry,
  trackQuotationOpen, updateEnquiry, updateProductionPlan,
} from '../controllers/sales/completion.controller';

const router = Router();
const quotationOp = (operation: string) => (req: any, res: any) => { req.params.operation = operation; return quotationOperation(req, res); };
const orderOp = (operation: string) => (req: any, res: any) => { req.params.operation = operation; return orderOperation(req, res); };
router.get('/quotations/public/:token/open', trackQuotationOpen);
router.use(authenticate);
router.use(requireModuleAccess('sales'));

router.route('/quotations').get(getQuotations).post(createQuotation);
router.route('/quotations/:id').get(getQuotation).put(updateQuotation).delete(deleteQuotation);
router.get('/quotations/:id/artifact', getQuotationArtifact);
router.post('/quotations/:id/convert', convertQuotationToOrder);

router.route('/orders').get(getSalesOrders).post(createSalesOrder);
router.route('/orders/:id').get(getSalesOrder).delete(deleteSalesOrder);
router.put('/orders/:id/status', updateSalesOrderStatus);

router.put('/sales-orders/:id', updateSalesOrder);
router.route('/quotations/:id/status').patch(updateQuotationStatus);

router.route('/enquiries').get(listEnquiries).post(createEnquiry);
router.route('/enquiries/:id').get(getEnquiry).put(updateEnquiry);
router.get('/enquiries/:id/workspace', getSalesCaseWorkspace);
router.post('/enquiries/:id/submit', submitEnquiry);
router.post('/enquiries/:id/close', closeSalesCase);
router.post('/enquiries/:id/convert-to-quotation', convertEnquiry);
router.post('/enquiries/:id/follow-up', followUpEnquiry);
router.post('/enquiries/:id/lose', loseEnquiry);
router.route('/communications/:entityType/:entityId').get(listSalesCommunications).post(createSalesCommunication);
router.post('/communications/:id/retry', retrySalesCommunication);
for (const operation of ['submit', 'approve', 'revise', 'send', 'negotiate', 'accept', 'reject', 'expire']) router.post(`/quotations/:id/${operation}`, quotationOp(operation));
for (const operation of ['submit', 'cancel', 'amend', 'hold', 'resume', 'close', 'approve-credit', 'reserve-stock', 'release-stock']) router.post(`/orders/:id/${operation}`, orderOp(operation));
router.post('/orders/:id/production-plan', createProductionPlan);
router.post('/orders/:id/material-request', createSalesOrderMaterialRequest);
router.put('/orders/:id/promises', updateSalesOrderPromises);
router.put('/orders/:id/picking', updateSalesOrderPicking);
router.post('/orders/:id/short-close', shortCloseSalesOrderLines);
router.post('/orders/:id/shipping-notification', sendShippingNotification);
router.patch('/production-plans/:id', updateProductionPlan);
router.get('/credit-control/:customerId/exposure', getCreditExposure);
router.get('/availability/:productId', availableToPromise);
router.get('/fulfilment-dashboard', fulfilmentDashboard);
router.get('/commitment-alerts', listCommitmentAlerts);
router.post('/commitment-alerts/:id/acknowledge', acknowledgeCommitmentAlert);
router.route('/alert-policy').get(getSalesAlertPolicy).put(updateSalesAlertPolicy);
router.get('/reports/:type', salesReport);

export default router;
