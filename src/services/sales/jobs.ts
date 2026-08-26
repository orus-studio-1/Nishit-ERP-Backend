import prisma from '../../lib/prisma';
import { registerJobHandler } from '../platform/job.service';

function simplePdf(lines: string[]) {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 11 Tf 50 790 Td ${lines.map((line, i) => `${i ? '0 -18 Td ' : ''}(${escape(line)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n', offset = pdf.length;
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(offset); const value = `${index + 1} 0 obj\n${object}\nendobj\n`; pdf += value; offset += Buffer.byteLength(value); });
  const xref = offset;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

registerJobHandler('SALES_QUOTATION_EMAIL', async ({ quotationId, to, token, communicationId }) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, include: { customer: true, items: { include: { product: true } } } });
  if (!quotation) throw new Error('Quotation not found');
  if (!to) throw new Error('Quotation recipient email is missing');
  const endpoint = process.env.SALES_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error('Sales email provider is not configured');
  const pdf = simplePdf([`Quotation ${quotation.quotationNo}`, `Customer: ${quotation.customer.name}`, ...quotation.items.map(i => `${i.product.sku}  ${i.quantity} x ${i.unitPrice} = ${i.total}`), `Total: ${quotation.currency} ${quotation.total}`]);
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SALES_EMAIL_GATEWAY_TOKEN || process.env.CRM_MESSAGE_GATEWAY_TOKEN || ''}` }, body: JSON.stringify({ to, subject: `Quotation ${quotation.quotationNo}`, text: `Your quotation is attached. Tracking token: ${token}`, attachments: [{ filename: `${quotation.quotationNo}.pdf`, contentType: 'application/pdf', contentBase64: pdf.toString('base64') }] }) });
  if (!response.ok) {
    if (communicationId) await prisma.salesCommunication.update({ where: { id: communicationId }, data: { status: 'FAILED' } });
    throw new Error(`Email provider returned ${response.status}`);
  }
  if (communicationId) await prisma.salesCommunication.update({ where: { id: communicationId }, data: { status: 'SENT', sentAt: new Date() } });
  return response.json().catch(() => ({ delivered: true }));
});

registerJobHandler('SALES_COMMUNICATION_SEND', async ({ communicationId }) => {
  const communication = await prisma.salesCommunication.findUnique({ where: { id: communicationId } });
  if (!communication) throw new Error('Sales communication not found');
  if (!communication.recipient) throw new Error('Communication recipient is missing');
  const endpoint = communication.channel === 'WHATSAPP'
    ? process.env.SALES_WHATSAPP_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL
    : process.env.SALES_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error(`${communication.channel} provider is not configured`);
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SALES_MESSAGE_GATEWAY_TOKEN || process.env.SALES_EMAIL_GATEWAY_TOKEN || process.env.CRM_MESSAGE_GATEWAY_TOKEN || ''}` }, body: JSON.stringify({ channel: communication.channel, to: communication.recipient, subject: communication.subject, text: communication.message }) });
    if (!response.ok) throw new Error(`Message provider returned ${response.status}`);
    await prisma.salesCommunication.update({ where: { id: communication.id }, data: { status: 'SENT', sentAt: new Date() } });
    return response.json().catch(() => ({ delivered: true }));
  } catch (error) {
    await prisma.salesCommunication.update({ where: { id: communication.id }, data: { status: 'FAILED' } });
    throw error;
  }
});

export async function processSalesExpiry() {
  const now = new Date();
  const [quotations, reservations] = await prisma.$transaction([
    prisma.quotation.updateMany({ where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: now } }, data: { status: 'EXPIRED' } }),
    prisma.stockReservation.findMany({ where: { status: { in: ['ACTIVE', 'PARTIAL'] }, expiresAt: { lt: now } }, select: { id: true, salesOrderId: true } }),
  ]);
  if (reservations.length) await prisma.stockReservation.updateMany({ where: { id: { in: reservations.map(r => r.id) } }, data: { status: 'RELEASED', releasedAt: now, releaseReason: 'Reservation expired' } });
  return { quotations: quotations.count, reservations: reservations.length };
}
