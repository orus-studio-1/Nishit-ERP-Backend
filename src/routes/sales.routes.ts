import { Router } from 'express';
import {
  getQuotations, getQuotation, createQuotation, updateQuotation, deleteQuotation, convertQuotationToOrder,
  getSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrderStatus, deleteSalesOrder,
  updateQuotationStatus,updateSalesOrder
} from '../controllers/sales.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';
import {
  availableToPromise, convertEnquiry, createEnquiry, createProductionPlan,
  createSalesCommunication, followUpEnquiry, listSalesCommunications, loseEnquiry, sendShippingNotification,
  fulfilmentDashboard, getCreditExposure, getEnquiry, listEnquiries,
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
router.post('/quotations/:id/convert', convertQuotationToOrder);

router.route('/orders').get(getSalesOrders).post(createSalesOrder);
router.route('/orders/:id').get(getSalesOrder).delete(deleteSalesOrder);
router.put('/orders/:id/status', updateSalesOrderStatus);

router.put('/sales-orders/:id', updateSalesOrder);
router.route('/quotations/:id/status').patch(updateQuotationStatus);

router.route('/enquiries').get(listEnquiries).post(createEnquiry);
router.route('/enquiries/:id').get(getEnquiry).put(updateEnquiry);
router.post('/enquiries/:id/submit', submitEnquiry);
router.post('/enquiries/:id/convert-to-quotation', convertEnquiry);
router.post('/enquiries/:id/follow-up', followUpEnquiry);
router.post('/enquiries/:id/lose', loseEnquiry);
router.route('/communications/:entityType/:entityId').get(listSalesCommunications).post(createSalesCommunication);
for (const operation of ['submit', 'revise', 'send', 'accept', 'reject', 'expire']) router.post(`/quotations/:id/${operation}`, quotationOp(operation));
for (const operation of ['submit', 'cancel', 'amend', 'hold', 'resume', 'close', 'approve-credit', 'reserve-stock', 'release-stock']) router.post(`/orders/:id/${operation}`, orderOp(operation));
router.post('/orders/:id/production-plan', createProductionPlan);
router.post('/orders/:id/shipping-notification', sendShippingNotification);
router.patch('/production-plans/:id', updateProductionPlan);
router.get('/credit-control/:customerId/exposure', getCreditExposure);
router.get('/availability/:productId', availableToPromise);
router.get('/fulfilment-dashboard', fulfilmentDashboard);
router.get('/reports/:type', salesReport);

export default router;
