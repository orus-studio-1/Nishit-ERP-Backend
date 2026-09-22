import prisma from '../../lib/prisma';
import { registerJobHandler } from '../platform/job.service';
import { sendSystemMail } from '../platform/mail.service';

function pdf(lines: string[]) {
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 11 Tf 50 790 Td ${lines.map((line, i) => `${i ? '0 -18 Td ' : ''}(${escape(line)}) Tj`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n', offset = out.length; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(offset); const row = `${i + 1} 0 obj\n${object}\nendobj\n`; out += row; offset += Buffer.byteLength(row); });
  const xref = offset; out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

async function send(to: string, subject: string, text: string, attachment: Buffer, filename: string) {
  if (!to) throw new Error('Vendor email address is missing');
  return sendSystemMail({ to, subject, text, attachments: [{ filename, contentType: 'application/pdf', content: attachment }] });
}

registerJobHandler('PROCUREMENT_RFQ_EMAIL', async ({ rfqId, supplierId, to, token, communicationId }) => {
  const row = await prisma.requestForQuotation.findUnique({ where: { id: rfqId }, include: { items: { include: { product: true } } } });
  if (!row) throw new Error('RFQ not found');
  const document = pdf([`Request for quotation ${row.rfqNo}`, ...row.items.map(i => `${i.product.sku}  Qty ${i.quantity}`), `Respond with vendor token: ${token}`]);
  const communication = communicationId ? await prisma.supplierCommunicationLog.findUnique({ where: { id: communicationId } }) : await prisma.supplierCommunicationLog.create({ data: { companyId: row.companyId, rfqId: row.id, supplierId, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'RFQ_SENT', recipient: to, subject: `RFQ ${row.rfqNo}`, message: `Please acknowledge and submit your quotation. Vendor token: ${token}`, status: 'QUEUED', queuedAt: new Date() } });
  try { const result = await send(to, communication.subject || `RFQ ${row.rfqNo}`, communication.message, document, `${row.rfqNo}.pdf`); await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'SENT', deliveredAt: new Date(), failedAt: null, failureReason: null } }); return result; }
  catch (error: any) { await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: error.message || 'RFQ email failed' } }); throw error; }
});

registerJobHandler('PROCUREMENT_PO_EMAIL', async ({ purchaseOrderId, to, token }) => {
  const row = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { supplier: true, items: { include: { product: true } } } });
  if (!row) throw new Error('Purchase order not found');
  const document = pdf([`Purchase order ${row.orderNo}`, `Vendor: ${row.supplier.name}`, ...row.items.map(i => `${i.product.sku}  ${i.quantity} x ${i.unitPrice}`), `Total: ${row.currency} ${row.total}`]);
  const communication = await prisma.supplierCommunicationLog.findFirst({ where: { purchaseOrderId: row.id, kind: 'PURCHASE_ORDER_SENT', recipient: to }, orderBy: { sentAt: 'desc' } }) || await prisma.supplierCommunicationLog.create({ data: { companyId: row.companyId, supplierId: row.supplierId, purchaseOrderId: row.id, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'PURCHASE_ORDER_SENT', recipient: to, subject: `Purchase order ${row.orderNo}`, message: `Please acknowledge purchase order ${row.orderNo}. Token: ${token}`, status: 'QUEUED', queuedAt: new Date() } });
  try { const result = await send(to, communication.subject || `Purchase order ${row.orderNo}`, communication.message, document, `${row.orderNo}.pdf`); await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'SENT', deliveredAt: new Date(), failedAt: null, failureReason: null } }); return result; }
  catch (error: any) { await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: error.message || 'Purchase-order email failed' } }); throw error; }
});

registerJobHandler('PROCUREMENT_RECEIPT_EMAIL', async ({ receiptId, communicationId, to }) => {
  const [receipt, communication] = await Promise.all([
    prisma.purchaseReceipt.findUnique({ where: { id: receiptId }, include: { supplier: true, purchaseOrder: true, items: { include: { product: true, warehouse: true } } } }),
    prisma.supplierCommunicationLog.findUnique({ where: { id: communicationId } }),
  ]);
  if (!receipt || !communication) throw new Error('Purchase receipt communication not found');
  const lines = receipt.items.map(item => `${item.product.sku} ${item.product.name} | accepted ${item.acceptedQty} | rejected ${item.rejectedQty} | ${item.warehouse?.name || 'warehouse not set'}`);
  const document = pdf([`Goods receipt ${receipt.receiptNo}`, receipt.purchaseOrder ? `Purchase order ${receipt.purchaseOrder.orderNo}` : '', `Supplier ${receipt.supplier.name}`, ...lines]);
  try { const result = await send(to, communication.subject || `Goods receipt ${receipt.receiptNo}`, communication.message, document, `${receipt.receiptNo}.pdf`); await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'SENT', deliveredAt: new Date(), failedAt: null, failureReason: null } }); return result; }
  catch (error: any) { await prisma.supplierCommunicationLog.update({ where: { id: communication.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: error.message || 'Receipt email failed' } }); throw error; }
});

registerJobHandler('PROCUREMENT_FOLLOWUP_EMAIL', async ({ communicationId, to }) => {
  const row = await prisma.supplierCommunicationLog.findUnique({ where: { id: communicationId }, include: { purchaseOrder: true } });
  if (!row) throw new Error('Supplier follow-up communication not found');
  try {
    const result = row.purchaseOrder
      ? await send(to, row.subject || 'Purchase order follow-up', row.message, pdf([row.subject || 'Purchase order follow-up', row.purchaseOrder.orderNo, row.message]), `${row.purchaseOrder.orderNo}-follow-up.pdf`)
      : await sendSystemMail({ to, subject: row.subject || 'Supplier communication', text: row.message });
    await prisma.supplierCommunicationLog.update({ where: { id: communicationId }, data: { status: 'SENT', deliveredAt: new Date(), failedAt: null, failureReason: null } });
    return result;
  } catch (error: any) {
    await prisma.supplierCommunicationLog.update({ where: { id: communicationId }, data: { status: 'FAILED', failedAt: new Date(), failureReason: error.message || 'Email delivery failed' } });
    throw error;
  }
});

export async function processProcurementMonitoring() {
  const now = new Date();

  // --- Fetch overdue Purchase Orders ---
  const overdueOrders = await prisma.purchaseOrder.findMany({
    where: { status: { in: ['CONFIRMED', 'SENT', 'RECEIVING'] }, expectedDate: { lt: now } },
    include: { supplier: true },
  });

  // --- Fetch overdue MSME invoices ---
  const msmeInvoices = await prisma.purchaseInvoice.findMany({
    where: { supplier: { msmeRegistered: true }, outstandingAmount: { gt: 0 }, dueDate: { lt: now } },
    include: { supplier: true },
  });

  // --- Get unique company IDs from all overdue items ---
  const companyIds = [...new Set([
    ...overdueOrders.map(o => o.companyId),
    ...msmeInvoices.map(i => i.companyId),
  ].filter(Boolean))] as string[];

  for (const companyId of companyIds) {
    // Find users who should receive procurement alerts
    const users = await prisma.user.findMany({
      where: { companyId, isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'PURCHASE_MANAGER'] } },
      select: { id: true, email: true },
    });

    for (const user of users) {
      // --- OVERDUE PURCHASE ORDER ALERTS (per PO) ---
      for (const po of overdueOrders.filter(o => o.companyId === companyId)) {
        const daysOverdue = Math.ceil((now.getTime() - new Date(po.expectedDate!).getTime()) / 86400000);
        const type = `PO_OVERDUE:${po.id}`;
        const existing = await prisma.notification.findFirst({ where: { userId: user.id, type, isRead: false } });
        const message = `${po.orderNo} from ${po.supplier.name} was expected on ${new Date(po.expectedDate!).toLocaleDateString()} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue). Total: ${po.currency} ${po.total}.`;
        if (existing) await prisma.notification.update({ where: { id: existing.id }, data: { message, link: `/procurement/purchase-orders/${po.id}` } });
        else {
          await prisma.notification.create({ data: { companyId, userId: user.id, type, title: `PO overdue: ${po.supplier.name}`, message, link: `/procurement/purchase-orders/${po.id}` } });
          if (user.email) await sendSystemMail({ to: user.email, subject: `PO overdue: ${po.supplier.name}`, text: message });
        }
      }

      // --- MSME INVOICE OVERDUE ALERTS (per invoice) ---
      for (const inv of msmeInvoices.filter(i => i.companyId === companyId)) {
        const daysOverdue = Math.ceil((now.getTime() - new Date(inv.dueDate!).getTime()) / 86400000);
        const type = `MSME_OVERDUE:${inv.id}`;
        const existing = await prisma.notification.findFirst({ where: { userId: user.id, type, isRead: false } });
        const message = `${inv.invoiceNo} from ${inv.supplier.name} (MSME) was due on ${new Date(inv.dueDate!).toLocaleDateString()} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue). Outstanding: ₹${inv.outstandingAmount}.`;
        if (existing) await prisma.notification.update({ where: { id: existing.id }, data: { message, link: `/procurement/purchase-invoices` } });
        else {
          await prisma.notification.create({ data: { companyId, userId: user.id, type, title: `MSME payment overdue: ${inv.supplier.name}`, message, link: `/procurement/purchase-invoices` } });
          if (user.email) await sendSystemMail({ to: user.email, subject: `MSME payment overdue: ${inv.supplier.name}`, text: message });
        }
      }
    }
  }

  return { overdueOrders: overdueOrders.length, msmeInvoices: msmeInvoices.length };
}
