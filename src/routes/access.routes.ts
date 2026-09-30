import { Router } from 'express';
import {
  bootstrapAccess,
  createAccessRole,
  getAccessCatalog,
  getAccessRoles,
  getAccessSummary,
  getAccessUsers,
  issueUserPassword,
  updateAccessRole,
  updateUserAccess,
} from '../controllers/access.controller';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/summary', requirePermission('access', 'permissions', 'READ'), getAccessSummary);
router.post('/bootstrap', requirePermission('access', 'permissions', 'MANAGE'), bootstrapAccess);
router.get('/permissions', requirePermission('access', 'permissions', 'READ'), getAccessCatalog);

router.route('/roles')
  .get(requirePermission('access', 'roles', 'READ'), getAccessRoles)
  .post(requirePermission('access', 'roles', 'CREATE'), createAccessRole);
router.put('/roles/:id', requirePermission('access', 'roles', 'WRITE'), updateAccessRole);

router.route('/users')
  .get(requirePermission('access', 'users', 'READ'), getAccessUsers);
router.put('/users/:id/access', requirePermission('access', 'users', 'WRITE'), updateUserAccess);
router.put('/users/:id/password', requirePermission('access', 'users', 'WRITE'), issueUserPassword);

export default router;
