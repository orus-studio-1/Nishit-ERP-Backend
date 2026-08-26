import { Router } from 'express';
import { createProduct, deleteProduct, getProduct, getProducts, searchProducts, updateProduct } from '../controllers/inventory.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('inventory', () => 'products'));

router.get('/search', searchProducts);
router.route('/').get(getProducts).post(createProduct);
router.route('/:id').get(getProduct).patch(updateProduct).delete(deleteProduct);

export default router;
