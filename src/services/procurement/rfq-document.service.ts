import PDFDocument = require('pdfkit');
import prisma from '../../lib/prisma';
import { quotationDefaults } from '../sales/quotation-profile.service';

const ACCENT = '#1F3A5F', INK = '#1F2933', MUTED = '#6B7280', BORDER = '#D5DAE1', SHADE = '#F3F5F8';
const text = (value: unknown) => String(value ?? '').trim();
const address = (value: any) => [value?.address, value?.city, value?.state, value?.zip, value?.country].map(text).filter(Boolean).join(', ');
const date = (value: unknown) => value ? new Date(value as any).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const qty = (value: unknown) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const imageBuffer = (value: unknown) => { const match = text(value).match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i); return match ? Buffer.from(match[1], 'base64') : null; };

export async function loadRfqDocument(rfqId: string, supplierId?: string) {
  const rfq = await prisma.requestForQuotation.findUnique({ where: { id: rfqId }, include: { materialRequest: true, items: { include: { product: { include: { unit: true } } } }, suppliers: { include: { supplier: true } } } });
  if (!rfq) throw new Error('RFQ not found');
  const company = rfq.companyId ? await prisma.company.findUnique({ where: { id: rfq.companyId } }) : null;
  const invite = rfq.suppliers.find(row => row.supplierId === supplierId);
  return { rfq, company, supplier: invite?.supplier || null, supplierEmail: invite?.email || invite?.supplier.email || '' };
}

type RfqDocument = Awaited<ReturnType<typeof loadRfqDocument>>;

/** Who the supplier should send the quotation to, and how. */
export function rfqResponseInstructions({ rfq, company }: RfqDocument) {
  const contact = [company?.email ? `email it to ${company.email}` : '', company?.phone ? `share it on ${company.phone}` : ''].filter(Boolean).join(' or ');
  return [
    `Please send your quotation on your company letterhead${contact ? ` - ${contact}` : ''}.`,
    `Mention RFQ No. ${rfq.rfqNo} in your quotation and email subject.`,
    rfq.validUntil ? `Submit your quotation on or before ${date(rfq.validUntil)}.` : 'Submit your quotation at the earliest.',
    'Your quotation should include unit rate, GST %, HSN code, delivery lead time, freight & packing charges, payment terms and validity of the offer.',
  ];
}

export async function rfqPdf(data: RfqDocument) {
  const { rfq, company, supplier } = data;
  const profile = quotationDefaults(company).companySnapshot || ({} as any);
  const companyName = text(profile.legalName || profile.name || 'Company');
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Request for Quotation ${rfq.rfqNo}`, Author: companyName } });
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const left = 40, right = doc.page.width - 40, width = right - left, top = 40, limit = doc.page.height - 70;
  let y = top;
  const ensure = (height: number) => { if (y + height > limit) { doc.addPage(); y = top; return true; } return false; };
  const write = (value: string, x: number, at: number, w: number, options: { font?: string; size?: number; color?: string; align?: 'left' | 'right' | 'center'; lineGap?: number } = {}) => {
    doc.font(options.font || 'Helvetica').fontSize(options.size || 8.5).fillColor(options.color || INK).text(value, x, at, { width: w, align: options.align || 'left', lineGap: options.lineGap ?? 1 });
    return doc.y;
  };
  const measure = (value: string, w: number, font = 'Helvetica', size = 8.5) => doc.font(font).fontSize(size).heightOfString(value, { width: w, lineGap: 1 });

  // Header: company identity on the left, document title on the right.
  const logo = imageBuffer(profile.logo);
  let identityX = left;
  if (logo) { try { doc.image(logo, left, top, { fit: [64, 52], valign: 'center' }); identityX = left + 76; } catch {} }
  const identityW = 300 - (identityX - left);
  let headerBottom = write(companyName, identityX, top, identityW, { font: 'Helvetica-Bold', size: 13, color: ACCENT });
  if (address(profile)) headerBottom = write(address(profile), identityX, headerBottom + 2, identityW, { size: 8, color: MUTED });
  const contactLine = [company?.phone ? `Ph: ${company.phone}` : '', company?.email ? `Email: ${company.email}` : ''].filter(Boolean).join('   ');
  if (contactLine) headerBottom = write(contactLine, identityX, headerBottom + 1, identityW, { size: 8, color: MUTED });
  if (profile.gstin) headerBottom = write(`GSTIN: ${profile.gstin}`, identityX, headerBottom + 1, identityW, { font: 'Helvetica-Bold', size: 8, color: INK });
  write('REQUEST FOR QUOTATION', right - 230, top, 230, { font: 'Helvetica-Bold', size: 15, color: ACCENT, align: 'right' });
  write(rfq.rfqNo, right - 230, top + 21, 230, { font: 'Helvetica-Bold', size: 10, align: 'right' });
  write(`Date: ${date(rfq.transactionDate)}`, right - 230, top + 35, 230, { size: 8.5, color: MUTED, align: 'right' });
  y = Math.max(headerBottom, top + (logo ? 52 : 48)) + 10;
  doc.rect(left, y, width, 2.5).fill(ACCENT);
  y += 14;

  // Supplier and RFQ detail panels.
  const gap = 12, panelW = (width - gap) / 2, pad = 9, stripH = 18;
  const panel = (x: number, title: string, body: () => number) => {
    doc.rect(x, y, panelW, stripH).fill(SHADE);
    write(title, x + pad, y + 5.5, panelW - pad * 2, { font: 'Helvetica-Bold', size: 7.5, color: ACCENT });
    return body();
  };
  const supplierBottom = panel(left, 'QUOTATION REQUESTED FROM', () => {
    const w = panelW - pad * 2, x = left + pad;
    if (!supplier) return write('All invited suppliers', x, y + stripH + 7, w, { font: 'Helvetica-Bold', size: 10 });
    let at = write(supplier.name, x, y + stripH + 7, w, { font: 'Helvetica-Bold', size: 10 });
    const lines = [address(supplier), [supplier.phone ? `Ph: ${supplier.phone}` : '', data.supplierEmail || supplier.email ? `Email: ${data.supplierEmail || supplier.email}` : ''].filter(Boolean).join('   '), supplier.taxId ? `GSTIN: ${supplier.taxId}` : '', `Supplier code: ${supplier.supplierNo}`].filter(Boolean);
    for (const line of lines) at = write(line, x, at + 2, w, { size: 8, color: MUTED });
    return at;
  });
  const detailsBottom = panel(left + panelW + gap, 'RFQ DETAILS', () => {
    const x = left + panelW + gap + pad, labelW = 100, valueW = panelW - pad * 2 - labelW;
    const rows: Array<[string, string]> = [
      ['RFQ Number', rfq.rfqNo],
      ['RFQ Date', date(rfq.transactionDate)],
      ['Quotation Due By', rfq.validUntil ? date(rfq.validUntil) : 'At the earliest'],
      ...(rfq.materialRequest ? [['Our Reference', rfq.materialRequest.requestNo] as [string, string]] : []),
      ['Quote Currency', text(supplier?.currency || company?.currency || 'INR')],
      ['No. of Items', String(rfq.items.length)],
    ];
    let at = y + stripH + 7;
    for (const [label, value] of rows) {
      write(label, x, at, labelW, { size: 8, color: MUTED });
      at = Math.max(write(value, x + labelW, at, valueW, { font: 'Helvetica-Bold', size: 8.5 }), at + 11) + 3;
    }
    return at - 3;
  });
  const panelBottom = Math.max(supplierBottom, detailsBottom) + pad;
  doc.lineWidth(0.7).strokeColor(BORDER).rect(left, y, panelW, panelBottom - y).stroke().rect(left + panelW + gap, y, panelW, panelBottom - y).stroke();
  y = panelBottom + 16;

  y = write('Dear Sir / Madam,', left, y, width, { size: 9 }) + 4;
  y = write('We invite you to submit your best quotation for the materials listed below. Kindly quote unit rates exclusive of GST and mention the applicable GST %, delivery lead time and payment terms against each item.', left, y, width, { size: 9, lineGap: 2 }) + 12;

  // Items table. Rate and Amount are left blank for the supplier to fill in.
  const columns: Array<{ label: string; w: number; align: 'left' | 'right' | 'center' }> = [
    { label: '#', w: 22, align: 'center' }, { label: 'ITEM & DESCRIPTION', w: 187, align: 'left' }, { label: 'HSN / SAC', w: 52, align: 'center' },
    { label: 'QTY', w: 48, align: 'right' }, { label: 'UNIT', w: 38, align: 'center' }, { label: 'REQUIRED BY', w: 68, align: 'center' },
    { label: 'UNIT RATE', w: 50, align: 'right' }, { label: 'AMOUNT', w: width - 465, align: 'right' },
  ];
  const xs = columns.reduce<number[]>((acc, col, i) => [...acc, i ? acc[i - 1] + columns[i - 1].w : left], []);
  const cellPad = 5;
  const tableHeader = () => {
    doc.rect(left, y, width, 22).fill(ACCENT);
    columns.forEach((col, i) => write(col.label, xs[i] + cellPad, y + 7.5, col.w - cellPad * 2, { font: 'Helvetica-Bold', size: 7, color: '#FFFFFF', align: col.align }));
    y += 22;
  };
  ensure(80);
  tableHeader();
  rfq.items.forEach((item, index) => {
    const product = item.product, descW = columns[1].w - cellPad * 2;
    const meta = [`SKU: ${product.sku}`, product.brand || product.manufacturer ? `Make: ${product.brand || product.manufacturer}` : ''].filter(Boolean).join('   |   ');
    const description = text(item.description || product.description);
    const height = Math.max(26, measure(product.name, descW, 'Helvetica-Bold', 8.5) + measure(meta, descW, 'Helvetica', 7.5) + (description ? measure(description, descW, 'Helvetica', 7.5) + 2 : 0) + 14);
    if (ensure(height)) { write(`${rfq.rfqNo} - items (continued)`, left, y, width, { font: 'Helvetica-Bold', size: 8, color: MUTED }); y += 14; tableHeader(); }
    if (index % 2) doc.rect(left, y, width, height).fill(SHADE);
    const middle = y + 8;
    write(String(index + 1), xs[0] + cellPad, middle, columns[0].w - cellPad * 2, { size: 8.5, color: MUTED, align: 'center' });
    let at = write(product.name, xs[1] + cellPad, middle - 1, descW, { font: 'Helvetica-Bold', size: 8.5 });
    at = write(meta, xs[1] + cellPad, at + 1, descW, { size: 7.5, color: MUTED });
    if (description) write(description, xs[1] + cellPad, at + 2, descW, { size: 7.5, color: INK });
    const unit = text(item.uom || product.unit?.symbol || product.unit?.name || 'Nos');
    [product.hsnCode || '-', qty(item.quantity), unit, item.requiredBy ? date(item.requiredBy) : date(rfq.materialRequest?.requiredBy) || '-'].forEach((value, i) =>
      write(value, xs[i + 2] + cellPad, middle, columns[i + 2].w - cellPad * 2, { font: i === 1 ? 'Helvetica-Bold' : 'Helvetica', size: 8.5, align: columns[i + 2].align }));
    doc.lineWidth(0.5).strokeColor(BORDER).moveTo(xs[6], y).lineTo(xs[6], y + height).moveTo(xs[7], y).lineTo(xs[7], y + height).stroke();
    y += height;
    doc.lineWidth(0.5).strokeColor(BORDER).moveTo(left, y).lineTo(right, y).stroke();
  });
  y += 18;

  // How to respond.
  const instructions = rfqResponseInstructions(data);
  const bulletW = width - 32;
  const instructionsH = 30 + instructions.reduce((sum, line) => sum + measure(line, bulletW, 'Helvetica', 8.5) + 4, 0);
  ensure(instructionsH);
  doc.rect(left, y, width, instructionsH).fill('#EEF3F9');
  doc.rect(left, y, 3, instructionsH).fill(ACCENT);
  let at = write('HOW TO SUBMIT YOUR QUOTATION', left + 14, y + 10, width - 28, { font: 'Helvetica-Bold', size: 8.5, color: ACCENT }) + 6;
  for (const line of instructions) {
    write('•', left + 14, at, 10, { font: 'Helvetica-Bold', size: 8.5, color: ACCENT });
    at = write(line, left + 26, at, bulletW, { size: 8.5 }) + 4;
  }
  y += instructionsH + 16;

  const section = (title: string, body: string) => {
    if (!body) return;
    ensure(30 + measure(body, width, 'Helvetica', 8.5));
    y = write(title, left, y, width, { font: 'Helvetica-Bold', size: 8.5, color: ACCENT }) + 4;
    y = write(body, left, y, width, { size: 8.5, lineGap: 2 }) + 14;
  };
  section('REMARKS', text(rfq.message));
  section('TERMS & CONDITIONS', text(rfq.terms).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, i) => `${i + 1}. ${line.replace(/^\d+[.)]\s*/, '')}`).join('\n'));

  // Sign-off.
  const signature = imageBuffer(profile.signature);
  ensure(signature ? 80 : 60);
  const signX = right - 200;
  write('Thank you,', left, y, 200, { size: 9 });
  write(`For ${companyName}`, signX, y, 200, { font: 'Helvetica-Bold', size: 9, align: 'right' });
  if (signature) { try { doc.image(signature, right - 110, y + 14, { fit: [110, 34], align: 'right', valign: 'center' }); } catch {} }
  write('Authorised Signatory', signX, y + (signature ? 52 : 36), 200, { size: 8, color: MUTED, align: 'right' });

  // Footer on every page.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 45;
    doc.lineWidth(0.5).strokeColor(BORDER).moveTo(left, footerY).lineTo(right, footerY).stroke();
    write(`${companyName}  |  ${rfq.rfqNo}`, left, footerY + 7, 220, { size: 7, color: MUTED });
    write('This is a system-generated document.', left + 150, footerY + 7, width - 300, { size: 7, color: MUTED, align: 'center' });
    write(`Page ${i + 1} of ${pages.count}`, right - 120, footerY + 7, 120, { size: 7, color: MUTED, align: 'right' });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return completed;
}

/** Plain-text and HTML email body that accompanies the RFQ PDF. */
export function rfqEmail(data: RfqDocument) {
  const { rfq, company, supplier } = data;
  const companyName = text(company?.legalName || company?.name || 'our company');
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const instructions = rfqResponseInstructions(data);
  const greeting = supplier ? `Dear ${supplier.name},` : 'Dear Sir / Madam,';
  const intro = `${companyName} invites you to quote for the ${rfq.items.length} item${rfq.items.length === 1 ? '' : 's'} listed below under RFQ No. ${rfq.rfqNo}. The full Request for Quotation is attached as a PDF.`;
  const lines = rfq.items.map((item, i) => `${i + 1}. ${item.product.name} (${item.product.sku}) - ${qty(item.quantity)} ${text(item.uom || item.product.unit?.symbol || 'Nos')}${item.requiredBy ? `, required by ${date(item.requiredBy)}` : ''}`);
  const subject = `Request for Quotation ${rfq.rfqNo} - ${companyName}`;
  const plain = [greeting, '', intro, '', ...lines, '', 'How to submit your quotation:', ...instructions.map(line => `- ${line}`), ...(rfq.message ? ['', rfq.message] : []), '', 'Regards,', companyName, [company?.phone, company?.email].filter(Boolean).join(' | ')].join('\n');
  const cell = 'padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:${INK};max-width:640px;margin:0 auto;">
  <div style="background:${ACCENT};color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;">
    <div style="font-size:12px;letter-spacing:1px;opacity:.85;">REQUEST FOR QUOTATION</div>
    <div style="font-size:20px;font-weight:bold;margin-top:2px;">${escape(rfq.rfqNo)}</div>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:none;padding:20px;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 12px;font-size:14px;">${escape(greeting)}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${escape(intro)}</p>
    ${rfq.validUntil ? `<p style="margin:0 0 16px;font-size:14px;"><strong>Quotation due by: ${escape(date(rfq.validUntil))}</strong></p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <thead><tr style="background:${SHADE};text-align:left;">
        <th style="${cell}">#</th><th style="${cell}">Item</th><th style="${cell}text-align:right;">Qty</th><th style="${cell}">Unit</th><th style="${cell}">Required by</th>
      </tr></thead>
      <tbody>${rfq.items.map((item, i) => `<tr>
        <td style="${cell}color:${MUTED};">${i + 1}</td>
        <td style="${cell}"><strong>${escape(item.product.name)}</strong><br><span style="color:${MUTED};font-size:12px;">SKU: ${escape(item.product.sku)}</span></td>
        <td style="${cell}text-align:right;font-weight:bold;">${escape(qty(item.quantity))}</td>
        <td style="${cell}">${escape(text(item.uom || item.product.unit?.symbol || 'Nos'))}</td>
        <td style="${cell}">${escape(item.requiredBy ? date(item.requiredBy) : '-')}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div style="background:#EEF3F9;border-left:3px solid ${ACCENT};padding:12px 16px;margin-bottom:16px;">
      <div style="font-weight:bold;color:${ACCENT};font-size:13px;margin-bottom:6px;">How to submit your quotation</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;">${instructions.map(line => `<li>${escape(line)}</li>`).join('')}</ul>
    </div>
    ${rfq.message ? `<p style="font-size:13px;line-height:1.5;white-space:pre-line;">${escape(rfq.message)}</p>` : ''}
    <p style="margin:16px 0 0;font-size:14px;">Regards,<br><strong>${escape(companyName)}</strong><br><span style="color:${MUTED};font-size:12px;">${escape([company?.phone, company?.email].filter(Boolean).join(' | '))}</span></p>
  </div>
</div>`;
  return { subject, text: plain, html };
}
