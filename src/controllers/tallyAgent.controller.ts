import { Response } from 'express';
import { AgentAuthRequest } from '../middleware/agentAuth';
import prisma from '../lib/prisma';
import { processVoucherData } from '../services/tally/tallySync';

export const heartbeat = async (req: AgentAuthRequest, res: Response): Promise<void> => {
  try {
    const { tallyReachable, agentVersion, availableCompanies } = req.body;
    const connectionId = req.tallyConnection!.id;

    await prisma.tallyConnection.update({
      where: { id: connectionId },
      data: {
        lastHeartbeatAt: new Date(),
        tallyReachable: Boolean(tallyReachable),
        agentVersion: typeof agentVersion === 'string' ? agentVersion : null,
        ...(Array.isArray(availableCompanies)
          ? { availableCompanies: availableCompanies.filter((n: unknown): n is string => typeof n === 'string' && n.trim() !== '').map((n: string) => n.trim()) }
          : {})
      }
    });

    res.status(200).json({ success: true, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('Agent heartbeat error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const pollJobs = async (req: AgentAuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.tallyConnection!.companyId;
    const connection = await prisma.tallyConnection.findUnique({ where: { id: req.tallyConnection!.id }, select: { tallyCompanyName: true } });

    const jobs = await prisma.tallySyncJob.findMany({
      where: {
        companyId,
        status: 'PENDING'
      },
      select: {
        id: true,
        syncType: true,
        fromDate: true,
        toDate: true
      },
      orderBy: { createdAt: 'asc' },
      take: 5
    });

    const formattedJobs = jobs.map(job => ({
      id: job.id,
      syncType: job.syncType,
      fromDate: job.fromDate,
      toDate: job.toDate,
      tallyCompanyName: connection?.tallyCompanyName ?? null
    }));

    res.status(200).json({ success: true, jobs: formattedJobs });
  } catch (error) {
    console.error('Agent poll jobs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const claimJob = async (req: AgentAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const connectionId = req.tallyConnection!.id;
    const companyId = req.tallyConnection!.companyId;

    // Atomic claim ensuring status is PENDING and companyId matches
    const { count } = await prisma.tallySyncJob.updateMany({
      where: {
        id,
        status: 'PENDING',
        companyId
      },
      data: {
        status: 'CLAIMED',
        claimedAt: new Date(),
        claimedByConnectionId: connectionId
      }
    });

    if (count === 0) {
      res.status(409).json({ success: false, message: 'Job already claimed or not pending' });
      return;
    }

    res.status(200).json({ success: true, message: 'Job claimed' });
  } catch (error) {
    console.error('Agent claim job error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const uploadData = async (req: AgentAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const connectionId = req.tallyConnection!.id;
    const companyId = req.tallyConnection!.companyId;
    const { vouchers, metadata } = req.body;

    if (!Array.isArray(vouchers)) {
      res.status(400).json({ success: false, message: 'Invalid payload: vouchers must be an array' });
      return;
    }

    const connection = await prisma.tallyConnection.findUnique({ where: { id: connectionId }, select: { tallyCompanyName: true } });
    const selectedCompany = connection?.tallyCompanyName;
    const uploadedCompany = typeof metadata?.tallyCompanyName === 'string' ? metadata.tallyCompanyName.trim() : '';
    if (!selectedCompany || uploadedCompany !== selectedCompany) {
      const message = !selectedCompany
        ? 'No Tally company selected for this connection'
        : `Tally company mismatch: expected "${selectedCompany}", received "${uploadedCompany || '(none)'}"`;
      await prisma.tallySyncJob.updateMany({
        where: { id, companyId, claimedByConnectionId: connectionId, status: 'CLAIMED' },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() }
      });
      res.status(422).json({ success: false, message });
      return;
    }

    // Attempt atomic lock transition from CLAIMED to PROCESSING
    const { count } = await prisma.tallySyncJob.updateMany({
      where: { 
        id, 
        companyId, 
        claimedByConnectionId: connectionId,
        status: 'CLAIMED'
      },
      data: {
        status: 'PROCESSING',
        uploadedAt: new Date()
      }
    });

    if (count === 0) {
      // Re-read job to determine why the atomic lock failed
      const job = await prisma.tallySyncJob.findUnique({ where: { id } });
      
      if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
      }
      if (job.companyId !== companyId || job.claimedByConnectionId !== connectionId) {
        res.status(403).json({ success: false, message: 'Forbidden' });
        return;
      }
      if (job.status === 'COMPLETED' || job.status === 'PROCESSING') {
        res.status(200).json({ success: true, message: 'Job is already processed or processing' });
        return;
      }
      res.status(400).json({ success: false, message: `Job is not in CLAIMED state (current: ${job.status})` });
      return;
    }

    // Run the actual processing synchronously or asynchronously depending on design
    // We will do it synchronously for the response since the frontend/agent expects processing results
    const result = await processVoucherData(companyId, id, vouchers);

    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('Agent upload data error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const failJob = async (req: AgentAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const connectionId = req.tallyConnection!.id;
    const companyId = req.tallyConnection!.companyId;
    const { errorCode, errorMessage } = req.body;

    const job = await prisma.tallySyncJob.findUnique({ where: { id } });

    if (!job || job.companyId !== companyId || job.claimedByConnectionId !== connectionId) {
      res.status(404).json({ success: false, message: 'Job not found or not owned by this connection' });
      return;
    }

    if (job.status !== 'CLAIMED' && job.status !== 'UPLOADING') {
      res.status(400).json({ success: false, message: 'Job cannot be failed from its current state' });
      return;
    }

    const maxRetries = job.maxRetries;
    const currentRetry = job.retryCount;
    const willRetry = currentRetry < maxRetries;

    await prisma.tallySyncJob.update({
      where: { id },
      data: {
        status: willRetry ? 'PENDING' : 'FAILED',
        retryCount: willRetry ? currentRetry + 1 : currentRetry,
        errorMessage: errorMessage ? String(errorMessage).substring(0, 500) : null,
        claimedByConnectionId: willRetry ? null : job.claimedByConnectionId,
        claimedAt: willRetry ? null : job.claimedAt,
      }
    });

    res.status(200).json({ success: true, willRetry, retryCount: willRetry ? currentRetry + 1 : currentRetry });
  } catch (error) {
    console.error('Agent fail job error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
