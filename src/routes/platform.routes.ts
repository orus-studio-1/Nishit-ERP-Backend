import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { idempotency, optimisticConcurrency } from '../middleware/platform';
import * as platform from '../controllers/platform.controller';

const router = Router();
router.use(authenticate);
router.use(idempotency);

router.route('/tenant').get(platform.getTenant).patch(platform.updateTenant);
router.post('/companies/:companyId/branches', platform.createBranch);
router.post('/companies/:companyId/gstins', platform.createGstin);
router.put('/companies/:companyId/quotation-profile', platform.updateQuotationProfile);

router.post('/documents', platform.registerLifecycle);
router.post('/documents/:id/submit', optimisticConcurrency, platform.submitDocument);
router.post('/documents/:id/cancel', optimisticConcurrency, platform.cancelDocument);
router.post('/documents/:id/amend', optimisticConcurrency, platform.amendDocument);

router.post('/attachments/presign', platform.presignAttachment);
router.post('/attachments/:id/complete', platform.completeAttachment);
router.get('/attachments', platform.listAttachments);
router.get('/attachments/:id/download', platform.downloadAttachment);
router.delete('/attachments/:id', optimisticConcurrency, platform.deleteAttachment);

router.get('/approvals/pending', platform.pendingApprovals);
router.post('/approvals/request', platform.requestApproval);
router.post('/approvals/:id/approve', platform.approve);
router.post('/approvals/:id/reject', platform.reject);
router.post('/approvals/:id/delegate', platform.delegate);
router.route('/approvals/rules').get(platform.listApprovalRules).post(platform.createApprovalRule);
router.patch('/approvals/rules/:id', platform.updateApprovalRule);
router.delete('/approvals/rules/:id', platform.deleteApprovalRule);

router.get('/settings', platform.getSettings);
router.put('/settings', platform.putSetting);
router.get('/jobs', platform.listJobs);
router.get('/audit', requirePermission('access', 'audit', 'READ'), platform.listAudit);

export default router;
