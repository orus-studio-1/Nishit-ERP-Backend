import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerManualSync } from './tally.controller';
import prisma from '../lib/prisma';
import * as tallySync from '../services/tally/tallySync';

vi.mock('../lib/prisma', () => ({
  default: {
    company: {
      findUnique: vi.fn(),
    },
    tallySyncHistory: {
      create: vi.fn(),
    }
  }
}));

vi.mock('../services/tally/tallySync', () => ({
  syncTallyVouchers: vi.fn().mockResolvedValue({}),
}));

describe('Tally Controller', () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {},
      access: { isSuperAdmin: false },
      user: { companyId: 'company-1' }
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    
    (prisma.company.findUnique as any).mockResolvedValue({ id: 'company-1' });
    (prisma.tallySyncHistory.create as any).mockResolvedValue({ id: 'job-123' });
  });

  it('should return 400 if required fields are missing', async () => {
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('required') }));
  });

  it('should return 403 if user companyId does not match and is not super admin', async () => {
    req.body = { companyId: 'company-2', fromDate: '20230401', toDate: '20230430' };
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('should allow mismatch if user is super admin', async () => {
    req.body = { companyId: 'company-2', fromDate: '20230401', toDate: '20230430' };
    req.access.isSuperAdmin = true;
    (prisma.company.findUnique as any).mockResolvedValue({ id: 'company-2' });
    
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('should return 400 for invalid date formats', async () => {
    req.body = { companyId: 'company-1', fromDate: 'invalid', toDate: '20230430' };
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('YYYYMMDD') }));
  });

  it('should return 400 for reversed dates', async () => {
    req.body = { companyId: 'company-1', fromDate: '20230430', toDate: '20230401' };
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('cannot be after') }));
  });

  it('should return 400 for date range exceeding 1 year', async () => {
    req.body = { companyId: 'company-1', fromDate: '20230401', toDate: '20240402' };
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('exceed 1 year') }));
  });

  it('should return 404 if company does not exist', async () => {
    req.body = { companyId: 'company-1', fromDate: '20230401', toDate: '20230430' };
    (prisma.company.findUnique as any).mockResolvedValue(null);
    await triggerManualSync(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 202 and trigger async sync on success', async () => {
    req.body = { companyId: 'company-1', fromDate: '20230401', toDate: '20230430' };
    await triggerManualSync(req, res);
    
    expect(prisma.tallySyncHistory.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-123' }));
    
    // Check if background task was called
    expect(tallySync.syncTallyVouchers).toHaveBeenCalledWith('company-1', '20230401', '20230430');
  });
});
