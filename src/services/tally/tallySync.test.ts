import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../lib/prisma';
import * as tallyClient from './tallyClient';
import { syncTallyVouchers } from './tallySync';

// Mock dependencies
vi.mock('../../lib/prisma', () => ({
  default: {
    tallySyncHistory: {
      create: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    supplier: {
      findFirst: vi.fn(),
    },
    salesInvoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    purchaseInvoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    }
  }
}));

vi.mock('./tallyClient', () => ({
  sendTallyRequest: vi.fn()
}));

describe('Tally Vouchers Sync', () => {
  const companyId = 'test-company-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks setup
    (prisma.tallySyncHistory.create as any).mockResolvedValue({ id: 'history-123' });
    (prisma.tallySyncHistory.update as any).mockResolvedValue({});
  });

  it('should generate correct XML payload with date ranges', async () => {
    (tallyClient.sendTallyRequest as any).mockResolvedValue('<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>');
    
    await syncTallyVouchers(companyId, '20230401', '20240331');
    
    expect(tallyClient.sendTallyRequest).toHaveBeenCalledWith(expect.stringContaining('<SVFROMDATE>20230401</SVFROMDATE>'));
    expect(tallyClient.sendTallyRequest).toHaveBeenCalledWith(expect.stringContaining('<SVTODATE>20240331</SVTODATE>'));
    expect(prisma.tallySyncHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId, fromDate: '20230401', toDate: '20240331' })
    }));
  });

  it('should filter exact voucher types and map sales correctly', async () => {
    const xml = `
      <ENVELOPE><BODY><DATA><COLLECTION>
        <VOUCHER>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <GUID>guid-sales-1</GUID>
          <VOUCHERNUMBER>INV-001</VOUCHERNUMBER>
          <DATE>20230415</DATE>
          <PARTYLEDGERNAME>Test Customer</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST><LEDGERNAME>Test Customer</LEDGERNAME><AMOUNT>-1500.50</AMOUNT></ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </COLLECTION></DATA></BODY></ENVELOPE>
    `;
    (tallyClient.sendTallyRequest as any).mockResolvedValue(xml);
    (prisma.customer.findFirst as any).mockResolvedValue({ id: 'cust-1' });
    (prisma.salesInvoice.findFirst as any).mockResolvedValue(null);

    const result = await syncTallyVouchers(companyId, '20230401', '20230430');
    
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ name: { equals: 'Test Customer', mode: 'insensitive' }, companyId })
    }));
    expect(prisma.salesInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ invoiceNo: 'INV-001', companyId, total: 1500.5, customerId: 'cust-1' })
    }));
    expect(result.createdCount).toBe(1);
  });

  it('should skip returns, journals, and mismatched voucher types', async () => {
    const xml = `
      <ENVELOPE><BODY><DATA><COLLECTION>
        <VOUCHER>
          <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
          <GUID>guid-cn-1</GUID>
          <VOUCHERNUMBER>CN-001</VOUCHERNUMBER>
        </VOUCHER>
        <VOUCHER>
          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
          <GUID>guid-jr-1</GUID>
          <VOUCHERNUMBER>JR-001</VOUCHERNUMBER>
        </VOUCHER>
      </COLLECTION></DATA></BODY></ENVELOPE>
    `;
    (tallyClient.sendTallyRequest as any).mockResolvedValue(xml);

    const result = await syncTallyVouchers(companyId, '20230401', '20230430');
    expect(prisma.salesInvoice.create).not.toHaveBeenCalled();
    expect(prisma.purchaseInvoice.create).not.toHaveBeenCalled();
    expect(result.createdCount).toBe(0);
  });

  it('should skip cancelled, optional, and deleted vouchers', async () => {
    const xml = `
      <ENVELOPE><BODY><DATA><COLLECTION>
        <VOUCHER>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <GUID>guid-sales-cancel</GUID>
          <VOUCHERNUMBER>INV-CAN</VOUCHERNUMBER>
          <ISCANCELLED>Yes</ISCANCELLED>
        </VOUCHER>
      </COLLECTION></DATA></BODY></ENVELOPE>
    `;
    (tallyClient.sendTallyRequest as any).mockResolvedValue(xml);

    const result = await syncTallyVouchers(companyId, '20230401', '20230430');
    expect(prisma.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('should handle missing customers by pushing to skipped and marking history partial', async () => {
    const xml = `
      <ENVELOPE><BODY><DATA><COLLECTION>
        <VOUCHER>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <GUID>guid-missing-cust</GUID>
          <VOUCHERNUMBER>INV-002</VOUCHERNUMBER>
          <PARTYLEDGERNAME>Unknown Customer</PARTYLEDGERNAME>
        </VOUCHER>
      </COLLECTION></DATA></BODY></ENVELOPE>
    `;
    (tallyClient.sendTallyRequest as any).mockResolvedValue(xml);
    (prisma.customer.findFirst as any).mockResolvedValue(null);

    const result = await syncTallyVouchers(companyId, '20230401', '20230430');
    
    expect(result.skippedVouchers.length).toBe(1);
    expect(result.skippedVouchers[0].reason).toBe('Customer not found in ERP');
    expect(prisma.tallySyncHistory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PARTIAL_SUCCESS', skippedRecords: expect.any(Array) })
    }));
  });

  it('should update existing records and not create duplicates (idempotency)', async () => {
    const xml = `
      <ENVELOPE><BODY><DATA><COLLECTION>
        <VOUCHER>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <GUID>guid-purch-1</GUID>
          <VOUCHERNUMBER>PUR-001</VOUCHERNUMBER>
          <PARTYLEDGERNAME>Test Supplier</PARTYLEDGERNAME>
        </VOUCHER>
      </COLLECTION></DATA></BODY></ENVELOPE>
    `;
    (tallyClient.sendTallyRequest as any).mockResolvedValue(xml);
    (prisma.supplier.findFirst as any).mockResolvedValue({ id: 'sup-1' });
    (prisma.purchaseInvoice.findFirst as any).mockResolvedValue({ id: 'existing-inv-1' });

    const result = await syncTallyVouchers(companyId, '20230401', '20230430');
    
    expect(prisma.purchaseInvoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId, OR: [{ tallyGuid: 'guid-purch-1' }, { invoiceNo: 'PUR-001' }] })
    }));
    expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-inv-1' },
      data: expect.objectContaining({ tallyGuid: 'guid-purch-1' })
    }));
    expect(prisma.purchaseInvoice.create).not.toHaveBeenCalled();
    expect(result.updatedCount).toBe(1);
  });

  it('should record FAILED history on exceptions', async () => {
    (tallyClient.sendTallyRequest as any).mockRejectedValue(new Error('Network error'));
    
    await expect(syncTallyVouchers(companyId)).rejects.toThrow('Network error');
    
    expect(prisma.tallySyncHistory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorMessage: 'Network error' })
    }));
  });
});
