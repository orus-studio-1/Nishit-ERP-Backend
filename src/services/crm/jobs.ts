import prisma from '../../lib/prisma';
import { registerJobHandler } from '../platform/job.service';

registerJobHandler('CRM_EXPORT_LEADS', async ({ exportJobId }) => {
  const job = await prisma.crmExportJob.findUnique({ where: { id: exportJobId } });
  if (!job) throw new Error('Export job not found');
  const leads = await prisma.lead.findMany({ where: { companyId: job.companyId, mergedIntoId: null }, orderBy: { createdAt: 'desc' } });
  const columns = ['id', 'title', 'firstName', 'lastName', 'email', 'phone', 'company', 'source', 'status', 'assignedToId', 'createdAt'];
  const escape = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.join(','), ...leads.map((lead: any) => columns.map((key) => escape(lead[key])).join(','))].join('\n');
  const storageKey = `data:text/csv;base64,${Buffer.from(csv).toString('base64')}`;
  await prisma.crmExportJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', storageKey, completedAt: new Date() } });
  return { rows: leads.length };
});

registerJobHandler('CRM_DAILY_DIGEST', async ({ companyId, userId }) => {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999);
  const [due, overdue] = await Promise.all([
    prisma.activity.count({ where: { companyId, userId, dueDate: { gte: now, lte: end }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    prisma.activity.count({ where: { companyId, userId, dueDate: { lt: now }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
  ]);
  await prisma.notification.create({ data: { companyId, userId, type: 'CRM_DAILY_DIGEST', title: 'CRM follow-up digest', message: `${due} due today, ${overdue} overdue`, link: '/crm/activities' } });
  return { due, overdue };
});

for (const type of ['CRM_SEND_EMAIL', 'CRM_SEND_WHATSAPP', 'CRM_SEND_SMS']) registerJobHandler(type, async ({ communicationId }) => {
  const row = await prisma.crmCommunication.findUnique({ where: { id: communicationId } });
  if (!row) throw new Error('Communication not found');
  const endpoint = row.channel === 'WHATSAPP' ? process.env.WHATSAPP_API_URL : process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error(`${row.channel} provider is not configured`);
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRM_MESSAGE_GATEWAY_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || ''}` }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error(`${row.channel} provider returned ${response.status}`);
  const result: any = await response.json().catch(() => ({}));
  await prisma.crmCommunication.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), externalId: result.id || result.messageId || row.externalId, metadata: { ...(row.metadata as any || {}), providerResponse: result } } });
  return result;
});

registerJobHandler('CRM_SYNC_MAILBOX', async (payload) => {
  const endpoint = process.env.CRM_MAIL_SYNC_URL;
  if (!endpoint) throw new Error('Mailbox synchronization provider is not configured');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRM_MAIL_SYNC_TOKEN || ''}` }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Mailbox provider returned ${response.status}`);
  return response.json();
});

export async function processCrmReminders() {
  const due = await prisma.activity.findMany({ where: { reminderAt: { lte: new Date() }, reminderSentAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, take: 100 });
  for (const activity of due) {
    await prisma.$transaction([
      prisma.notification.create({ data: { companyId: activity.companyId, userId: activity.userId, type: 'CRM_REMINDER', title: activity.subject, message: activity.description || 'CRM activity reminder', link: `/crm/activities?id=${activity.id}` } }),
      prisma.activity.update({ where: { id: activity.id }, data: { reminderSentAt: new Date() } }),
    ]);
  }
  return due.length;
}
