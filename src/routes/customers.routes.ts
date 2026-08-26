import { Router } from 'express';
import { getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, getCustomerInvoices, getCustomerOutstanding } from '../controllers/customers.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('customers', () => 'customers'));

router.route('/').get(getCustomers).post(createCustomer);
router.get('/:id/invoices', getCustomerInvoices);
router.get('/:id/outstanding', getCustomerOutstanding);
router.route('/:id').get(getCustomer).put(updateCustomer).delete(deleteCustomer);

export default router;
