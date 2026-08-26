import prisma from '../../lib/prisma';
import { registerJobHandler } from '../platform/job.service';

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
  const endpoint = process.env.PROCUREMENT_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error('Procurement email provider is not configured');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PROCUREMENT_EMAIL_GATEWAY_TOKEN || process.env.CRM_MESSAGE_GATEWAY_TOKEN || ''}` }, body: JSON.stringify({ to, subject, text, attachments: [{ filename, contentType: 'application/pdf', contentBase64: attachment.toString('base64') }] }) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return response.json().catch(() => ({ delivered: true }));
}

registerJobHandler('PROCUREMENT_RFQ_EMAIL', async ({ rfqId, to, token }) => {
  const row = await prisma.requestForQuotation.findUnique({ where: { id: rfqId }, include: { items: { include: { product: true } } } });
  if (!row) throw new Error('RFQ not found');
  const document = pdf([`Request for quotation ${row.rfqNo}`, ...row.items.map(i => `${i.product.sku}  Qty ${i.quantity}`), `Respond with vendor token: ${token}`]);
  return send(to, `RFQ ${row.rfqNo}`, `Please acknowledge and submit your quotation. Vendor token: ${token}`, document, `${row.rfqNo}.pdf`);
});

registerJobHandler('PROCUREMENT_PO_EMAIL', async ({ purchaseOrderId, to, token }) => {
  const row = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { supplier: true, items: { include: { product: true } } } });
  if (!row) throw new Error('Purchase order not found');
  const document = pdf([`Purchase order ${row.orderNo}`, `Vendor: ${row.supplier.name}`, ...row.items.map(i => `${i.product.sku}  ${i.quantity} x ${i.unitPrice}`), `Total: ${row.currency} ${row.total}`]);
  return send(to, `Purchase order ${row.orderNo}`, `Please acknowledge this purchase order. Token: ${token}`, document, `${row.orderNo}.pdf`);
});

registerJobHandler('PROCUREMENT_FOLLOWUP_EMAIL', async ({ communicationId, to }) => {
  const row = await prisma.supplierCommunicationLog.findUnique({ where: { id: communicationId }, include: { purchaseOrder: true } });
  if (!row) throw new Error('Supplier follow-up communication not found');
  return send(to, row.subject || 'Purchase order delivery follow-up', row.message, pdf([row.subject || 'Delivery follow-up', row.purchaseOrder?.orderNo || '', row.message]), `${row.purchaseOrder?.orderNo || 'purchase-order'}-follow-up.pdf`);
});

export async function processProcurementMonitoring() {
  const now = new Date();
  const [overdueOrders, msmeInvoices] = await Promise.all([
    prisma.purchaseOrder.count({ where: { status: { in: ['CONFIRMED', 'SENT', 'RECEIVING'] }, expectedDate: { lt: now } } }),
    prisma.purchaseInvoice.count({ where: { supplier: { msmeRegistered: true }, outstandingAmount: { gt: 0 }, dueDate: { lt: now } } }),
  ]);
  return { overdueOrders, msmeInvoices };
}
