import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { success, error } from '../utils/response';

/**
 * GET /tally/connection-status
 * Returns the current Tally Agent connection status for the user's company.
 */
export const getConnectionStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      error(res, 'Company not found for current user', 400);
      return;
    }

    const connection = await prisma.tallyConnection.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!connection) {
      // No connection configured yet — return a sensible default
      success(res, {
        isOnline: false,
        tallyReachable: false,
        tallyCompanyName: null,
        availableCompanies: [],
        lastHeartbeatAt: null,
        agentVersion: null,
      });
      return;
    }

    // Consider the agent "online" if the last heartbeat was within 2 minutes
    const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
    const isOnline = connection.lastHeartbeatAt
      ? Date.now() - new Date(connection.lastHeartbeatAt).getTime() < ONLINE_THRESHOLD_MS
      : false;

    success(res, {
      isOnline,
      tallyReachable: isOnline ? connection.tallyReachable : false,
      tallyCompanyName: connection.tallyCompanyName,
      availableCompanies: connection.availableCompanies,
      lastHeartbeatAt: connection.lastHeartbeatAt,
      agentVersion: connection.agentVersion,
    });
  } catch (err: any) {
    console.error('getConnectionStatus error:', err);
    error(res, 'Failed to load connection status', 500);
  }
};

/**
 * PUT /tally/connection/company
 * Save the selected Tally company name for synchronization.
 */
export const saveCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      error(res, 'Company not found for current user', 400);
      return;
    }

    const { tallyCompanyName } = req.body;
    if (!tallyCompanyName || typeof tallyCompanyName !== 'string' || !tallyCompanyName.trim()) {
      error(res, 'tallyCompanyName is required', 400);
      return;
    }

    const connection = await prisma.tallyConnection.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!connection) {
      error(res, 'No active Tally connection found. Please set up the Tally Agent first.', 404);
      return;
    }

    await prisma.tallyConnection.update({
      where: { id: connection.id },
      data: { tallyCompanyName: tallyCompanyName.trim() },
    });

    success(res, null, 'Tally company saved successfully');
  } catch (err: any) {
    console.error('saveCompany error:', err);
    error(res, 'Failed to save Tally company', 500);
  }
};

/**
 * POST /tally/sync
 * Create a new sync job for the Tally Agent to pick up.
 */
export const createSyncJob = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      error(res, 'Company not found for current user', 400);
      return;
    }

    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) {
      error(res, 'fromDate and toDate are required', 400);
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      error(res, 'Dates must be in YYYY-MM-DD format', 400);
      return;
    }

    if (fromDate > toDate) {
      error(res, 'fromDate cannot be after toDate', 400);
      return;
    }

    // Check for a connection with a selected company
    const connection = await prisma.tallyConnection.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!connection) {
      error(res, 'No active Tally connection found. Please set up the Tally Agent first.', 400);
      return;
    }

    if (!connection.tallyCompanyName) {
      error(res, 'No Tally company selected. Please select a company first.', 400);
      return;
    }

    // Check for an already active job
    const activeJob = await prisma.tallySyncJob.findFirst({
      where: {
        companyId,
        status: { in: ['PENDING', 'CLAIMED', 'PROCESSING'] },
      },
    });

    if (activeJob) {
      error(res, 'A sync job is already in progress. Please wait for it to finish.', 409);
      return;
    }

    // Convert YYYY-MM-DD to YYYYMMDD for the agent
    const fromDateFormatted = fromDate.replace(/-/g, '');
    const toDateFormatted = toDate.replace(/-/g, '');

    const job = await prisma.tallySyncJob.create({
      data: {
        companyId,
        syncType: 'VOUCHERS',
        fromDate: fromDateFormatted,
        toDate: toDateFormatted,
        status: 'PENDING',
      },
    });

    success(res, { jobId: job.id }, 'Sync job created', 202);
  } catch (err: any) {
    console.error('createSyncJob error:', err);
    error(res, 'Failed to create sync job', 500);
  }
};

/**
 * GET /tally/sync
 * List recent sync jobs for the current user's company.
 */
export const listSyncJobs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      error(res, 'Company not found for current user', 400);
      return;
    }

    const jobs = await prisma.tallySyncJob.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        syncType: true,
        fromDate: true,
        toDate: true,
        status: true,
        recordsProcessed: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });

    success(res, jobs);
  } catch (err: any) {
    console.error('listSyncJobs error:', err);
    error(res, 'Failed to load sync jobs', 500);
  }
};

/**
 * GET /tally/sync/:id
 * Get a single sync job by ID.
 */
export const getSyncJob = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      error(res, 'Company not found for current user', 400);
      return;
    }

    const { id } = req.params;

    const job = await prisma.tallySyncJob.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        syncType: true,
        fromDate: true,
        toDate: true,
        status: true,
        recordsProcessed: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      error(res, 'Sync job not found', 404);
      return;
    }

    success(res, job);
  } catch (err: any) {
    console.error('getSyncJob error:', err);
    error(res, 'Failed to load sync job', 500);
  }
};
