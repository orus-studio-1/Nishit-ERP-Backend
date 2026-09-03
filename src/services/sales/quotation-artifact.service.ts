import { createHash } from 'crypto';
import PDFDocument = require('pdfkit');
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../lib/prisma';
import { quotationDefaults } from './quotation-profile.service';

type Db = Prisma.TransactionClient | PrismaClient;
const money = (value: unknown) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const text = (value: unknown) => String(value ?? '').trim();
const address = (value: any) => [value?.address, value?.city, value?.state, value?.zip, value?.country].filter(Boolean).join(', ');
const imageBuffer = (value: unknown) => { const match = text(value).match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i); return match ? Buffer.from(match[1], 'base64') : null; };

export async function quotationPdf(quotation: any) {
  const snapshot = quotation.companySnapshot || {};
  const customerAddress = quotation.shippingAddressSnapshot || {};
  const pdf = new PDFDocument({ size: 'A4', margin: 28, bufferPages: true, info: { Title: `Quotation ${quotation.quotationNo}` } });
  const chunks: Buffer[] = [];
  pdf.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
  const left = 28, right = 567, width = right - left, top = 43;
  const line = (x1: number, y1: number, x2: number, y2: number, thickness = 0.45) => pdf.strokeColor('#111111').lineWidth(thickness).moveTo(x1, y1).lineTo(x2, y2).stroke();
  const cell = (value: unknown, x: number, y: number, w: number, options: any = {}) => pdf.fillColor('#111111').font(options.bold ? 'Times-Bold' : 'Times-Roman').fontSize(options.size || 6.4).text(text(value), x + 2, y + (options.padY ?? 2.5), { width: w - 4, height: options.height ? options.height - 3 : undefined, align: options.align || 'left', ellipsis: true, lineGap: 0 });
  const logo = imageBuffer(snapshot.logo);
  if (logo) { try { pdf.image(logo, left + 8, top + 8, { fit: [58, 44], valign: 'center' }); } catch {} }
  const titleX = left + (logo ? 65 : 0), titleW = width - (logo ? 65 : 0);
  pdf.fillColor('#111111').font('Times-Bold').fontSize(8.5).text(text(snapshot.name || snapshot.legalName || 'COMPANY').toUpperCase(), titleX, top + 2, { width: titleW, align: 'center' });
  pdf.font('Times-Roman').fontSize(6.5).text(address(snapshot).toUpperCase(), titleX, top + 12, { width: titleW, align: 'center' });
  pdf.text([quotation.company?.phone ? `TEL. NO. ${quotation.company.phone}` : '', quotation.company?.email ? `EMAIL : ${quotation.company.email}` : '', snapshot.gstin ? `GSTIN : ${snapshot.gstin}` : ''].filter(Boolean).join('   '), titleX, top + 24, { width: titleW, align: 'center' });
  pdf.font('Times-Roman').fontSize(6).text(text((snapshot as any).tagline || ''), left + 1, top + 58, { width: width - 2 });
  line(left, top + 72, right, top + 72);
  const customerBottom = top + 125, split = left + 398;
  line(split, top + 72, split, customerBottom - 13);
  pdf.font('Times-Roman').fontSize(6.5).text('To,', left + 30, top + 80);
  pdf.font('Times-Bold').fontSize(8).text(quotation.customerNameSnapshot || quotation.customer.name, left + 30, top + 88, { width: 335, align: 'center' });
  pdf.font('Times-Roman').fontSize(6.3).text(address(customerAddress), left + 30, top + 99, { width: 335, align: 'center', height: 16 });
  pdf.font('Times-Roman').fontSize(6.3).text(`DATE :      ${new Date(quotation.date).toLocaleDateString('en-GB')}`, split + 6, top + 80, { width: 129 });
  pdf.text(`QUOTATION No.  ${quotation.quotationNo}`, split + 6, top + 96, { width: 129 });
  pdf.fontSize(6.5).text('We greatly appreciate your enquiry & we are pleased to quote our lowest prices as under.', left + 60, customerBottom - 11, { width: 350, align: 'center' });
  line(left, customerBottom, right, customerBottom);
  const columns: Array<{ label: string; x: number; w: number; align?: 'left' | 'center' | 'right' }> = [
    { label: 'NO.', x: left, w: 16, align: 'center' }, { label: 'CODE / HSN', x: left + 16, w: 40, align: 'center' },
    { label: 'DESCRIPTION', x: left + 56, w: 189, align: 'center' }, { label: 'SERIES / MAKE', x: left + 245, w: 46, align: 'center' },
    { label: 'QTY.', x: left + 291, w: 34, align: 'right' }, { label: 'UNIT', x: left + 325, w: 24, align: 'center' },
    { label: 'RATE', x: left + 349, w: 37, align: 'right' }, { label: 'PER', x: left + 386, w: 28, align: 'center' },
    { label: 'DIS. IN %', x: left + 414, w: 34, align: 'right' }, { label: 'GST IN %', x: left + 448, w: 26, align: 'right' },
    { label: 'NET AMT.', x: left + 474, w: 65, align: 'right' },
  ];
  let y = customerBottom;
  const header = () => { const height = 14; columns.forEach(col => { line(col.x, y, col.x, y + height); cell(col.label, col.x, y, col.w, { bold: true, align: col.align, height, size: 5.7, padY: 4 }); }); line(right, y, right, y + height); line(left, y + height, right, y + height); y += height; };
  header();
  quotation.items.forEach((item: any, index: number) => {
    if (y > 650) { line(left, top, right, top); line(left, top, left, y); line(right, top, right, y); pdf.addPage(); y = top; line(left, top, right, top); header(); }
    pdf.font('Times-Roman').fontSize(6.2);
    const rowHeight = Math.max(13, Math.min(25, pdf.heightOfString(text(item.description || item.product.name), { width: columns[2].w - 4 }) + 4));
    columns.forEach(col => line(col.x, y, col.x, y + rowHeight)); line(right, y, right, y + rowHeight); line(left, y + rowHeight, right, y + rowHeight);
    const net = Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discount) / 100) * (1 + Number(item.taxRate) / 100);
    [index + 1, item.hsnCode || item.product.hsnCode || item.product.sku, item.description || item.product.name, item.brand || item.product.brand || item.product.manufacturer, money(item.quantity), 'Nos', money(item.unitPrice), 'Each', `${money(item.discount)}%`, `${money(item.taxRate)}%`, money(net)].forEach((value, colIndex) => cell(value, columns[colIndex].x, y, columns[colIndex].w, { align: columns[colIndex].align, height: rowHeight }));
    y += rowHeight;
  });
  const totalHeight = 14; line(left, y, right, y); line(left, y + totalHeight, right, y + totalHeight); line(left + 474, y, left + 474, y + totalHeight); line(right, y, right, y + totalHeight);
  cell('TOTAL INR', left + 350, y, 124, { bold: true, align: 'right', height: totalHeight }); cell(money(quotation.total), left + 474, y, 65, { bold: true, align: 'right', height: totalHeight }); y += totalHeight;
  const thanksHeight = 11; pdf.font('Times-Roman').fontSize(6).text('Thanking you and wishing you a happy association with us.', left + 1, y + 2, { width: width - 2 }); line(left, y + thanksHeight, right, y + thanksHeight); y += thanksHeight;
  const conditions = [quotation.taxAmount ? 'GST : EXTRA AS ABOVE.' : '', quotation.deliveryTerms ? `DELIVERY WITHIN : ${quotation.deliveryTerms}` : '', quotation.deliveryChargesNote ? `DELIVERY CHARGES : ${quotation.deliveryChargesNote}` : '', quotation.terms || ''].filter(Boolean).join('\n').toUpperCase();
  const footerHeight = Math.max(78, pdf.heightOfString(conditions, { width: 340, lineGap: 1 }) + 12, pdf.heightOfString(text(snapshot.bankDetails), { width: 174, lineGap: 1 }) + 38);
  pdf.font('Times-Bold').fontSize(6.2).text(conditions, left + 1, y + 8, { width: 340, lineGap: 1 });
  pdf.font('Times-Roman').fontSize(6.2).text(`FOR ${text(snapshot.name || snapshot.legalName).toUpperCase()}`, left + 382, y + 7, { width: 145, align: 'center' });
  const signature = imageBuffer(snapshot.signature);
  if (signature) { try { pdf.image(signature, left + 418, y + 15, { fit: [78, 23], align: 'center', valign: 'center' }); } catch {} }
  pdf.font('Times-Roman').fontSize(6).text(text(snapshot.bankDetails), left + 360, y + 40, { width: 174, lineGap: 1 });
  const bottom = y + footerHeight; line(left, top, right, top); line(left, top, left, bottom); line(right, top, right, bottom); line(left, bottom, right, bottom);
  pdf.end(); return completed;
}

export async function preserveQuotationArtifact(quotationId: string, db: Db = prisma) {
  const quotation = await db.quotation.findUnique({ where: { id: quotationId }, include: { customer: true, items: { include: { product: true } } } });
  if (!quotation) throw new Error('Quotation not found');
  const company = quotation.companyId ? await db.company.findUnique({ where: { id: quotation.companyId } }) : null;
  const fallback = quotationDefaults(company);
  const pdf = await quotationPdf({ ...quotation, companySnapshot: quotation.companySnapshot || fallback.companySnapshot, deliveryTerms: quotation.deliveryTerms || fallback.deliveryTerms, deliveryChargesNote: quotation.deliveryChargesNote || fallback.deliveryChargesNote, terms: quotation.terms || fallback.terms, company });
  const checksum = createHash('sha256').update(pdf).digest('hex');
  const content = Uint8Array.from(pdf);
  return db.quotationArtifact.upsert({ where: { quotationId }, update: { fileName: `${quotation.quotationNo}.pdf`, content, checksum }, create: { quotationId, fileName: `${quotation.quotationNo}.pdf`, content, checksum } });
}
