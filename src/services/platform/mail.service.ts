import nodemailer from 'nodemailer';

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };
export type SendMailInput = { to: string | string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] };

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function smtpTransport() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return undefined;
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE === 'true' || port === 465, auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
  return transporter;
}

export async function sendSystemMail(input: SendMailInput) {
  const smtp = smtpTransport();
  if (smtp) {
    const info = await smtp.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...input });
    return { provider: 'SMTP', messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  }
  const endpoint = process.env.SALES_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL;
  if (!endpoint) throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS or SALES_EMAIL_GATEWAY_URL.');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SALES_EMAIL_GATEWAY_TOKEN || process.env.CRM_MESSAGE_GATEWAY_TOKEN || ''}` }, body: JSON.stringify({ to: input.to, subject: input.subject, text: input.text, html: input.html, attachments: input.attachments?.map(attachment => ({ filename: attachment.filename, contentType: attachment.contentType, contentBase64: attachment.content.toString('base64') })) }) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json().catch(() => ({ provider: 'HTTP_GATEWAY', delivered: true }));
}

export function hasMailConfiguration() {
  return Boolean((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.SALES_EMAIL_GATEWAY_URL || process.env.CRM_MESSAGE_GATEWAY_URL);
}
