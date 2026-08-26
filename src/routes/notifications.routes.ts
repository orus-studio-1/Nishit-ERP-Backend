import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notifications.controller';

const router = Router();
router.use(authenticate);
router.get('/', listNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

export default router;
