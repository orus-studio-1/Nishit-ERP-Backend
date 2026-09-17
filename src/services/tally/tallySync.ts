import { XMLParser } from 'fast-xml-parser';
import prisma from '../../lib/prisma';
import { sendTallyRequest } from './tallyClient';

const activeCompanySyncs = new Set<string>();
export let isGlobalSyncRunning = false;
export function setGlobalSyncRunning(state: boolean) {
  isGlobalSyncRunning = state;
}

export async function syncTallyVouchers(companyId: string, fromDate?: string, toDate?: string) {
  if (activeCompanySyncs.has(companyId)) {
    throw new Error(`Tally sync is already running for company ${companyId}`);
  }
  activeCompanySyncs.add(companyId);

  console.log(`Starting Tally Vouchers Sync (Sales & Purchases) for company ${companyId}...`);

  // Default to current financial year if no dates provided
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed (April is 3)
  const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;
  const fyEndYear = fyStartYear + 1;
  
  const defaultFromDate = `${fyStartYear}0401`; // April 1st
  const defaultToDate = `${fyEndYear}0331`;     // March 31st

  const svFromDate = fromDate || defaultFromDate;
  const svToDate = toDate || defaultToDate;

  // Create Sync History record
  const syncHistory = await prisma.tallySyncHistory.create({
    data: {
      companyId: companyId,
      syncType: 'VOUCHERS',
      status: 'IN_PROGRESS',
      fromDate: svFromDate,
      toDate: svToDate
    }
  });

  const xmlPayload = `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${svFromDate}</SVFROMDATE>
          <SVTODATE>${svToDate}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
  `.trim();

  try {
    const responseXml = await sendTallyRequest(xmlPayload);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const parsedData = parser.parse(responseXml);

    const body = parsedData?.ENVELOPE?.BODY;
    let vouchers = [];

    if (body?.DATA?.COLLECTION?.VOUCHER) {
      const voucherData = body.DATA.COLLECTION.VOUCHER;
      vouchers = Array.isArray(voucherData) ? voucherData : [voucherData];
    } else if (body?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE) {
      const messages = body.IMPORTDATA.REQUESTDATA.TALLYMESSAGE;
      const msgArray = Array.isArray(messages) ? messages : [messages];
      for (const msg of msgArray) {
        if (msg.VOUCHER) vouchers.push(msg.VOUCHER);
      }
    }

    console.log(`Found ${vouchers.length} Vouchers in Tally.`);

    let createdCount = 0;
    let updatedCount = 0;
    const skippedVouchers: Array<{ invoiceNo: string, tallyGuid: string, partyName: string, reason: string }> = [];

    for (const voucher of vouchers) {
      const typeName = (voucher.VOUCHERTYPENAME || '').toLowerCase();
      
      // Strict equality check to avoid matching "Sales Return" or "Credit Note"
      if (typeName !== 'sales' && typeName !== 'purchase') {
        continue;
      }

      // Skip cancelled, optional, or deleted vouchers
      if (
        voucher.ISCANCELLED === 'Yes' ||
        voucher.ISOPTIONAL === 'Yes' ||
        voucher.ISDELETED === 'Yes'
      ) {
        continue;
      }

      const tallyGuid = voucher.GUID;
      const invoiceNo = voucher.VOUCHERNUMBER;
      const dateStr = voucher.DATE ? voucher.DATE.toString() : '';
      const date = dateStr ? new Date(`${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`) : new Date();
      const partyName = (voucher.PARTYLEDGERNAME || '').trim();

      if (!invoiceNo || !tallyGuid) {
         skippedVouchers.push({ invoiceNo: invoiceNo || 'UNKNOWN', tallyGuid: tallyGuid || 'UNKNOWN', partyName, reason: 'Missing Voucher Number or GUID' });
         continue;
      }

      let totalAmount = 0;
      let subtotalAmount = 0;

      // Extract total from Party Ledger (Exact total)
      if (voucher['ALLLEDGERENTRIES.LIST']) {
         const ledgers = Array.isArray(voucher['ALLLEDGERENTRIES.LIST']) ? voucher['ALLLEDGERENTRIES.LIST'] : [voucher['ALLLEDGERENTRIES.LIST']];
         const partyLedger = ledgers.find((l: any) => (l.LEDGERNAME || '').toString().trim() === partyName);
         if (partyLedger && partyLedger.AMOUNT) {
           totalAmount = Math.abs(parseFloat(partyLedger.AMOUNT));
         }
      }

      // Extract subtotal from Inventory
      if (voucher['ALLINVENTORYENTRIES.LIST']) {
         const inventory = Array.isArray(voucher['ALLINVENTORYENTRIES.LIST']) ? voucher['ALLINVENTORYENTRIES.LIST'] : [voucher['ALLINVENTORYENTRIES.LIST']];
         for (const item of inventory) {
             if (item.AMOUNT) {
                 subtotalAmount += Math.abs(parseFloat(item.AMOUNT));
             }
         }
      }

      // Do NOT arbitrarily calculate taxAmount. Only populate subtotal if found, otherwise default 0.
      const taxAmount = 0;

      if (typeName.includes('sales')) {
        const customer = await prisma.customer.findFirst({
          where: { name: { equals: partyName, mode: 'insensitive' }, companyId: companyId },
          select: { id: true }
        });
        
        if (!customer) {
          skippedVouchers.push({ invoiceNo, tallyGuid, partyName, reason: 'Customer not found in ERP' });
          continue; 
        }

        const existingInvoice = await prisma.salesInvoice.findFirst({
          where: {
            companyId: companyId,
            OR: [
              { tallyGuid },
              { invoiceNo }
            ]
          }
        });

        if (existingInvoice) {
          await prisma.salesInvoice.update({
            where: { id: existingInvoice.id },
            data: { tallyGuid, tallyRawData: voucher }
          });
          updatedCount++;
        } else {
          await prisma.salesInvoice.create({
            data: {
              invoiceNo,
              tallyGuid,
              tallyRawData: voucher,
              date,
              customerId: customer.id,
              status: 'SUBMITTED',
              subtotal: subtotalAmount,
              taxAmount: taxAmount,
              total: totalAmount,
              grandTotal: totalAmount,
              companyId: companyId
            }
          });
          createdCount++;
        }
      } else if (typeName.includes('purchase')) {
        const supplier = await prisma.supplier.findFirst({
          where: { name: { equals: partyName, mode: 'insensitive' }, companyId: companyId },
          select: { id: true }
        });

        if (!supplier) {
          skippedVouchers.push({ invoiceNo, tallyGuid, partyName, reason: 'Supplier not found in ERP' });
          continue;
        }

        const existingInvoice = await prisma.purchaseInvoice.findFirst({
          where: {
            companyId: companyId,
            OR: [
              { tallyGuid },
              { invoiceNo }
            ]
          }
        });

        if (existingInvoice) {
          await prisma.purchaseInvoice.update({
            where: { id: existingInvoice.id },
            data: { tallyGuid, tallyRawData: voucher }
          });
          updatedCount++;
        } else {
          await prisma.purchaseInvoice.create({
            data: {
              invoiceNo,
              tallyGuid,
              tallyRawData: voucher,
              date,
              supplierId: supplier.id,
              status: 'SENT',
              subtotal: subtotalAmount,
              taxAmount: taxAmount,
              total: totalAmount,
              baseTotal: totalAmount,
              companyId: companyId
            }
          });
          createdCount++;
        }
      }
    }

    // Finalize Sync History
    await prisma.tallySyncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: skippedVouchers.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        recordsProcessed: vouchers.length,
        recordsCreated: createdCount,
        recordsUpdated: updatedCount,
        skippedRecords: skippedVouchers as any,
        completedAt: new Date()
      }
    });

    console.log(`Tally Vouchers Sync Complete! Created: ${createdCount} | Updated: ${updatedCount} | Skipped: ${skippedVouchers.length}`);

    return { success: true, createdCount, updatedCount, skippedVouchers };

  } catch (error: any) {
    console.error('Error during Tally Vouchers Sync:', error);
    await prisma.tallySyncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message,
        completedAt: new Date()
      }
    });
    throw error;
  } finally {
    activeCompanySyncs.delete(companyId);
  }
}
