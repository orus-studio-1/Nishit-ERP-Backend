function esc(value: any) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function money(value: any, currency = 'INR') {
  const amount = value && typeof value.toNumber === 'function' ? value.toNumber() : Number(value || 0);
  return `${currency} ${amount.toFixed(2)}`;
}

function textLine(x: number, y: number, size: number, text: string) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`;
}

export function renderInvoicePdf(invoice: any, printFormat?: any) {
  const template = printFormat?.template || {};
  const title = template.title || 'Tax Invoice';
  const lines: string[] = [];
  let y = 790;

  lines.push(textLine(48, y, 18, title));
  y -= 26;
  lines.push(textLine(48, y, 11, `Invoice: ${invoice.invoiceNo}`));
  lines.push(textLine(360, y, 11, `Date: ${new Date(invoice.date).toISOString().slice(0, 10)}`));
  y -= 18;
  lines.push(textLine(48, y, 11, `Customer: ${invoice.customer?.name || invoice.customerId}`));
  lines.push(textLine(360, y, 11, `Status: ${invoice.status}`));
  y -= 24;
  lines.push(textLine(48, y, 12, 'Items'));
  y -= 16;
  lines.push(textLine(48, y, 9, 'Code'));
  lines.push(textLine(125, y, 9, 'Description'));
  lines.push(textLine(330, y, 9, 'Qty'));
  lines.push(textLine(385, y, 9, 'Rate'));
  lines.push(textLine(455, y, 9, 'Amount'));
  y -= 12;

  for (const item of invoice.items || []) {
    if (y < 120) break;
    lines.push(textLine(48, y, 9, item.itemCode || item.product?.sku || ''));
    lines.push(textLine(125, y, 9, String(item.description || item.product?.name || '').slice(0, 34)));
    lines.push(textLine(330, y, 9, Number(item.quantity || 0).toString()));
    lines.push(textLine(385, y, 9, money(item.rate || item.unitPrice, invoice.currency)));
    lines.push(textLine(455, y, 9, money(item.total, invoice.currency)));
    y -= 14;
  }

  y -= 16;
  lines.push(textLine(360, y, 10, `Subtotal: ${money(invoice.subtotal, invoice.currency)}`));
  y -= 15;
  lines.push(textLine(360, y, 10, `Tax: ${money(invoice.taxAmount, invoice.currency)}`));
  y -= 15;
  lines.push(textLine(360, y, 12, `Grand Total: ${money(invoice.grandTotal, invoice.currency)}`));
  y -= 22;
  if (invoice.terms) lines.push(textLine(48, y, 9, `Terms: ${String(invoice.terms).slice(0, 95)}`));
  if (printFormat?.footer) lines.push(textLine(48, 42, 8, printFormat.footer));

  const stream = lines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
