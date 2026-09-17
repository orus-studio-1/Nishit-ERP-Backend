import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { syncTallyVouchers } from '../services/tally/tallySync';
import prisma from '../lib/prisma';

export const triggerManualSync = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, fromDate, toDate } = req.body;

    if (!companyId || !fromDate || !toDate) {
      res.status(400).json({
        success: false,
        message: 'companyId, fromDate, and toDate are required',
      });
      return;
    }

    // Authorization scoping
    if (!req.access?.isSuperAdmin && req.user?.companyId !== companyId) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to sync data for this company',
      });
      return;
    }

    // Basic date format validation YYYYMMDD
    if (!/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate)) {
      res.status(400).json({
        success: false,
        message: 'Dates must be in YYYYMMDD format',
      });
      return;
    }

    if (fromDate > toDate) {
      res.status(400).json({
        success: false,
        message: 'fromDate cannot be after toDate',
      });
      return;
    }

    const fromYear = parseInt(fromDate.substring(0, 4), 10);
    const toYear = parseInt(toDate.substring(0, 4), 10);
    if (toYear - fromYear > 1 || (toYear - fromYear === 1 && toDate.substring(4) > fromDate.substring(4))) {
      res.status(400).json({
        success: false,
        message: 'Date range cannot exceed 1 year',
      });
      return;
    }

    // Ensure company exists
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    });
    
    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found',
      });
      return;
    }

    // Create a skeleton sync history to return immediately
    const syncHistory = await prisma.tallySyncHistory.create({
      data: {
        companyId: companyId,
        syncType: 'VOUCHERS',
        status: 'IN_PROGRESS',
        fromDate: fromDate,
        toDate: toDate
      }
    });

    // Run async without blocking response
    syncTallyVouchers(companyId, fromDate, toDate).catch(err => {
      console.error('Async Tally Sync Failed:', err);
    });

    res.status(202).json({
      success: true,
      message: 'Tally manual sync queued successfully',
      jobId: syncHistory.id
    });
  } catch (error: any) {
    console.error('Manual Tally Sync Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger Tally sync',
    });
  }
};
