import { Router } from 'express';
import { agentAuthenticate } from '../middleware/agentAuth';
import { heartbeat, pollJobs, claimJob, uploadData, failJob } from '../controllers/tallyAgent.controller';

const router = Router();

// All agent routes require the X-Agent-Key authentication
router.post('/heartbeat', agentAuthenticate, heartbeat);
router.get('/jobs', agentAuthenticate, pollJobs);
router.patch('/jobs/:id/claim', agentAuthenticate, claimJob);
router.post('/jobs/:id/data', agentAuthenticate, uploadData);
router.post('/jobs/:id/fail', agentAuthenticate, failJob);

export default router;
