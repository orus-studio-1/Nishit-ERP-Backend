import prisma from '../../lib/prisma';
import { registerJobHandler } from '../platform/job.service';
import { preserveQuotationArtifact } from './quotation-artifact.service';
import { sendSystemMail } from '../platform/mail.service';

registerJobHandler('SALES_ALERT_EMAIL', async ({ to, title, message, actionHref }) => sendSystemMail({ to, subject: `[Sales delivery alert] ${title}`, text: `${message}\n\nOpen ERP: ${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}${actionHref || '/sales/fulfilment'}` }));

async function queueAlertEmail(order: any, title: string, message: string, actionHref = '/sales/fulfilment') {
  const users = await prisma.user.findMany({ where: { ...(order.companyId ? { companyId: order.companyId } : {}), role: { in: ['ADMIN', 'MANAGER', 'SALES_REP', 'PURCHASE_MANAGER'] }, email: { not: '' } }, select: { email: true } });
  const recipients = [...new Set(users.map(user => user.email).filter(Boolean))];
  if (recipients.length) await prisma.backgroundJob.create({ data: { tenantId: order.tenantId, type: 'SALES_ALERT_EMAIL', payload: { to: recipients, title, message, actionHref } } });
}

registerJobHandler('SALES_QUOTATION_EMAIL', async ({ quotationId, to, token, communicationId, channel = 'EMAIL' }) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, include: { customer: true, items: { include: { product: true } } } });
  if (!quotation) throw new Error('Quotation not found');
  if (!to) throw new Error('Quotation recipient email is missing');
  const artifact = await preserveQuotationArtifact(quotation.id);
  const pdf = Buffer.from(artifact.content);
  const communication = communicationId ? await prisma.salesCommunication.findUnique({ where: { id: communicationId } }) : null;
  try {
    const result = channel === 'WHATSAPP'
      ? await sendGatewayMessage(channel, to, communication?.subject || `Quotation ${quotation.quotationNo}`, communication?.message || `Your quotation is attached. Tracking token: ${token}`, pdf, `${quotation.quotationNo}.pdf`)
      : await sendSystemMail({ to, subject: communication?.subject || `Quotation ${quotation.quotationNo}`, text: communication?.message || `Please find quotation ${quotation.quotationNo}, revision ${quotation.revisionNo}, attached.`, attachments: [{ filename: `${quotation.quotationNo}.pdf`, contentType: 'application/pdf', content: pdf }] });
    if (communicationId) await prisma.salesCommunication.update({ where: { id: communicationId }, data: { status: 'SENT', sentAt: new Date() } });
    return result;
  } catch (error) { if (communicationId) await prisma.salesCommunication.update({ where: { id: communicationId }, data: { status: 'FAILED' } }); throw error; }
});

async function sendGatewayMessage(channel: string, to: string, subject: string, text: string, attachment?: Buffer, filename?: string) {
  const endpoint = channel === 'WHATSAPP' ? process.env.SALES_WHATSAPP_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL : process.env.SALES_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error(`${channel} provider is not configured`);
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SALES_MESSAGE_GATEWAY_TOKEN || process.env.CRM_MESSAGE_GATEWAY_TOKEN || ''}` }, body: JSON.stringify({ channel, to, subject, text, attachments: attachment ? [{ filename, contentType: 'application/pdf', contentBase64: attachment.toString('base64') }] : undefined }) });
  if (!response.ok) throw new Error(`${channel} provider returned ${response.status}`);
  return response.json().catch(() => ({ delivered: true }));
}

registerJobHandler('SALES_COMMUNICATION_SEND', async ({ communicationId }) => {
  const communication = await prisma.salesCommunication.findUnique({ where: { id: communicationId } });
  if (!communication) throw new Error('Sales communication not found');
  if (!communication.recipient) throw new Error('Communication recipient is missing');
  try {
    const response = communication.channel === 'EMAIL' ? await sendSystemMail({ to: communication.recipient, subject: communication.subject || 'Nishit ERP notification', text: communication.message }) : await sendGatewayMessage(communication.channel, communication.recipient, communication.subject || 'Nishit ERP notification', communication.message);
    await prisma.salesCommunication.update({ where: { id: communication.id }, data: { status: 'SENT', sentAt: new Date() } });
    return response;
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

export async function processSalesCommitmentAlerts() {
  const orders = await prisma.salesOrder.findMany({ where: { status: { in: ['CONFIRMED', 'AWAITING_STOCK', 'PARTIALLY_READY', 'READY_TO_DISPATCH', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED', 'PARTIALLY_DELIVERED', 'PROCESSING', 'SHIPPED'] } }, include: { items: { include: { product: { include: { stockLevels: true } } } }, deliveryNotes: { where: { status: 'SUBMITTED' } } } });
  let created = 0;
  for (const order of orders) {
    const policy = await prisma.salesAlertPolicy.findFirst({ where: { companyId: order.companyId } });
    if (policy && !policy.isActive) continue;
    const daysConfigured = (Array.isArray(policy?.warningDays) ? policy.warningDays : [7, 3, 1, 0]).map(Number).sort((a, b) => b - a);
    for (const item of order.items) {
      const promised = item.committedDeliveryDate || order.deliveryDate; if (!promised) continue;
      const remaining = Math.max(0, Number(item.quantity) - Number(item.deliveredQty) - Number(item.shortClosedQty)); if (!remaining) continue;
      const today = new Date(); today.setHours(0,0,0,0); const due = new Date(promised); due.setHours(0,0,0,0); const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      const threshold = days < 0 ? -1 : daysConfigured.find(value => days <= value); if (threshold == null) continue;
      const available = item.product.stockLevels.reduce((sum, level) => sum + Number(level.quantity) - Number(level.reservedQty), 0);
      const shortage = Math.max(0, remaining - Math.max(0, available) - Number(item.incomingQty));
      const type = days < 0 ? 'OVERDUE' : days === 0 ? 'DUE_TODAY' : shortage > 0 ? `SHORTAGE_D${threshold}` : `NOT_READY_D${threshold}`;
      const alertKey = `${order.id}:${item.id}:${type}`; const exists = await prisma.salesCommitmentAlert.findUnique({ where: { alertKey } });
      const severity = days < 0 || days <= 1 ? 'CRITICAL' : days <= 3 ? 'HIGH' : 'MEDIUM'; const title = `${days < 0 ? 'Overdue' : `${days} day commitment`}: ${item.product.name}`; const message = `${order.orderNo}: ${remaining} open, ${available} available, ${shortage} unplanned shortage.`;
      await prisma.salesCommitmentAlert.upsert({ where: { alertKey }, update: { severity, title, message, status: 'OPEN', resolvedAt: null }, create: { companyId: order.companyId, salesOrderId: order.id, salesOrderItemId: item.id, alertKey, type, severity, title, message, action: shortage > 0 ? (item.supplyMode === 'MAKE_TO_ORDER' ? 'CREATE_PRODUCTION_PLAN' : 'CREATE_MATERIAL_REQUEST') : 'CREATE_DISPATCH', actionHref: '/sales/fulfilment', dueAt: promised } });
      if (!exists) { created++; const users = await prisma.user.findMany({ where: { ...(order.companyId ? { companyId: order.companyId } : {}), role: { in: ['ADMIN','MANAGER'] } }, select: { id: true }, take: 20 }); if (users.length) await prisma.notification.createMany({ data: users.map(user => ({ companyId: order.companyId, userId: user.id, title, message, type: severity === 'CRITICAL' ? 'ERROR' : 'WARNING', link: '/sales/fulfilment' })) }); await queueAlertEmail(order, title, message); }
      if (available > 0 && Number(item.readyQty) < Math.min(remaining, available)) {
        const stockKey = `${order.id}:${item.id}:STOCK_UNALLOCATED`;
        const stockExists = await prisma.salesCommitmentAlert.findUnique({ where: { alertKey: stockKey } });
        await prisma.salesCommitmentAlert.upsert({ where: { alertKey: stockKey }, update: { status: 'OPEN', resolvedAt: null, message: `${available} units are available but not fully allocated to ${order.orderNo}.` }, create: { companyId: order.companyId, salesOrderId: order.id, salesOrderItemId: item.id, alertKey: stockKey, type: 'STOCK_UNALLOCATED', severity: days <= 3 ? 'HIGH' : 'MEDIUM', title: `Stock available but unallocated: ${item.product.name}`, message: `${available} units are available but not fully allocated to ${order.orderNo}.`, action: 'RESERVE_STOCK', actionHref: '/sales/fulfilment', dueAt: promised } });
        if (!stockExists) await queueAlertEmail(order, `Stock available but unallocated: ${item.product.name}`, `${available} units are available but not fully allocated to ${order.orderNo}.`);
      }
    }
    for (const note of order.deliveryNotes) {
      if (!note.expectedDeliveryAt || ['DELIVERED', 'RETURNED'].includes(note.shipmentStatus) || note.expectedDeliveryAt >= new Date()) continue;
      const alertKey = `${order.id}:${note.id}:SHIPMENT_OVERDUE`;
      const exists = await prisma.salesCommitmentAlert.findUnique({ where: { alertKey } });
      await prisma.salesCommitmentAlert.upsert({ where: { alertKey }, update: { status: 'OPEN', resolvedAt: null }, create: { companyId: order.companyId, salesOrderId: order.id, alertKey, type: 'SHIPMENT_OVERDUE', severity: 'CRITICAL', title: `Shipment overdue: ${note.deliveryNo}`, message: `Expected delivery was ${note.expectedDeliveryAt.toLocaleDateString()}.`, action: 'CONTACT_TRANSPORTER', actionHref: '/invoicing/delivery-notes', dueAt: note.expectedDeliveryAt } });
      if (!exists) { created++; await queueAlertEmail(order, `Shipment overdue: ${note.deliveryNo}`, `Expected delivery was ${note.expectedDeliveryAt.toLocaleDateString()}.`, '/invoicing/delivery-notes'); }
    }
    const requests = await prisma.materialRequest.findMany({ where: { sourceDocumentType: 'SALES_ORDER', sourceDocumentId: order.id }, include: { purchaseOrders: true } });
    for (const request of requests) for (const po of request.purchaseOrders) {
      if (!po.expectedDate || ['RECEIVED', 'CANCELLED'].includes(po.status)) continue;
      const requiredBy = request.requiredBy || order.deliveryDate;
      const lateAgainstPromise = requiredBy && po.expectedDate > requiredBy;
      const overdueIncoming = po.expectedDate < new Date();
      if (!lateAgainstPromise && !overdueIncoming) continue;
      const alertKey = `${order.id}:${po.id}:INCOMING_PO_DELAYED`;
      const exists = await prisma.salesCommitmentAlert.findUnique({ where: { alertKey } });
      await prisma.salesCommitmentAlert.upsert({ where: { alertKey }, update: { status: 'OPEN', resolvedAt: null, dueAt: po.expectedDate }, create: { companyId: order.companyId, salesOrderId: order.id, alertKey, type: 'INCOMING_PO_DELAYED', severity: overdueIncoming ? 'CRITICAL' : 'HIGH', title: `Incoming purchase order at risk: ${po.orderNo}`, message: lateAgainstPromise ? `Expected ${po.expectedDate.toLocaleDateString()} is later than the sales requirement.` : `Purchase order was expected on ${po.expectedDate.toLocaleDateString()}.`, action: 'CONTACT_SUPPLIER', actionHref: '/procurement/purchase-orders', dueAt: po.expectedDate } });
      if (!exists) { created++; await queueAlertEmail(order, `Incoming purchase order at risk: ${po.orderNo}`, lateAgainstPromise ? `Expected ${po.expectedDate.toLocaleDateString()} is later than the sales requirement.` : `Purchase order was expected on ${po.expectedDate.toLocaleDateString()}.`, '/procurement/purchase-orders'); }
    }
  }
  return { scannedOrders: orders.length, createdAlerts: created };
}

export async function processSalesInvoiceMonitoring() {
  const now = new Date();
  
  const overdueInvoices = await prisma.salesInvoice.findMany({
    where: { status: 'SUBMITTED', outstandingAmount: { gt: 0 }, dueDate: { lt: now } },
    include: { customer: true },
  });

  const companyIds = [...new Set(overdueInvoices.map(i => i.companyId).filter(Boolean))] as string[];

  for (const companyId of companyIds) {
    const users = await prisma.user.findMany({
      where: { companyId, isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_REP'] } },
      select: { id: true, email: true },
    });

    for (const user of users) {
      for (const inv of overdueInvoices.filter(i => i.companyId === companyId)) {
        const daysOverdue = Math.ceil((now.getTime() - new Date(inv.dueDate!).getTime()) / 86400000);
        const type = `SALES_INVOICE_OVERDUE:${inv.id}`;
        const existing = await prisma.notification.findFirst({ where: { userId: user.id, type, isRead: false } });
        const message = `Invoice ${inv.invoiceNo} for ${inv.customer.name} was due on ${new Date(inv.dueDate!).toLocaleDateString()} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue). Outstanding: ${inv.currency} ${inv.outstandingAmount}.`;
        
        if (existing) {
          await prisma.notification.update({ where: { id: existing.id }, data: { message, link: `/invoicing/sales-invoices/${inv.id}` } });
        } else {
          await prisma.notification.create({
            data: {
              companyId,
              userId: user.id,
              type,
              title: `Invoice overdue: ${inv.customer.name}`,
              message,
              link: `/invoicing/sales-invoices/${inv.id}`,
            },
          });
          if (user.email) await sendSystemMail({ to: user.email, subject: `Invoice overdue: ${inv.customer.name}`, text: message });
        }
      }
    }
  }

  return { overdueInvoices: overdueInvoices.length };
}
