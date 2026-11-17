import { Router } from 'express';
import { getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier } from '../controllers/suppliers.controller';
import { importSuppliers, previewSupplierImport } from '../controllers/supplierImport.controller';
import { authenticate, requireModuleAccess, requirePermission } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('suppliers', () => 'suppliers'));

router.route('/').get(getSuppliers).post(createSupplier);
// CSV import also needs the Suppliers "Import" permission (the module gate above checks Create).
router.post('/import/preview', requirePermission('suppliers', 'suppliers', 'IMPORT'), previewSupplierImport);
router.post('/import', requirePermission('suppliers', 'suppliers', 'IMPORT'), importSuppliers);
router.route('/:id').get(getSupplier).put(updateSupplier).delete(deleteSupplier);

export default router;
