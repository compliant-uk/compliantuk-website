// api/generate-certificate.js
// Generates a professional proof-of-service certificate PDF
// Called from track.js when tenant reads the document

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Generate a proof-of-service certificate PDF
 * @returns {Promise<Buffer>} PDF as a Buffer
 */
export async function generateCertificatePdf({
  propertyAddress,
  tenantFirst,
  tenantLast,
  tenantEmail,
  sentAt,
  readAt,
  ipAddress,
  device,
  trackingId,
  landlordId,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Colours
  const navy     = rgb(0.031, 0.047, 0.078);  // #080c14
  const blue     = rgb(0.231, 0.510, 0.965);  // #3b82f6
  const blue2    = rgb(0.376, 0.647, 0.980);  // #60a5fa
  const emerald  = rgb(0.063, 0.725, 0.506);  // #10b981
  const slate    = rgb(0.580, 0.635, 0.722);  // #94a3b8
  const dark     = rgb(0.063, 0.094, 0.157);  // #101828
  const lightBg  = rgb(0.973, 0.984, 0.996);  // #f8fafc
  const borderC  = rgb(0.882, 0.914, 0.941);  // #e2e8f0
  const green    = rgb(0.166, 0.663, 0.376);  // #2aa760
  const white    = rgb(1, 1, 1);

  // ── HEADER BAND ──
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: navy });

  // Logo mark
  page.drawRectangle({ x: 40, y: height - 85, width: 32, height: 32, color: blue, borderRadius: 6 });
  page.drawText('✓', { x: 48, y: height - 68, size: 14, font: helveticaBold, color: white });

  // Logo text
  page.drawText('CompliantUK', { x: 80, y: height - 72, size: 16, font: helveticaBold, color: white });

  // Header right: certificate label
  page.drawText('PROOF OF SERVICE CERTIFICATE', {
    x: width - 280,
    y: height - 64,
    size: 9,
    font: helveticaBold,
    color: blue2,
  });
  page.drawText('Renters\' Rights Act 2025 — Compliance Record', {
    x: width - 280,
    y: height - 78,
    size: 8,
    font: helvetica,
    color: slate,
  });

  // ── ACCENT BAR ──
  page.drawRectangle({ x: 0, y: height - 124, width, height: 4, color: blue });

  // ── MAIN TITLE ──
  page.drawText('PROOF OF SERVICE', {
    x: 40, y: height - 168,
    size: 28, font: helveticaBold, color: dark,
  });
  page.drawText('This certificate confirms that the official Government Information Sheet', {
    x: 40, y: height - 196,
    size: 11, font: helvetica, color: rgb(0.4, 0.45, 0.5),
  });
  page.drawText('was delivered to and read by the tenant named below.', {
    x: 40, y: height - 212,
    size: 11, font: helvetica, color: rgb(0.4, 0.45, 0.5),
  });

  // ── VERIFIED BADGE ──
  page.drawRectangle({ x: width - 140, y: height - 200, width: 100, height: 44, color: rgb(0.94, 0.99, 0.96), borderRadius: 8 });
  page.drawRectangle({ x: width - 140, y: height - 200, width: 100, height: 44, borderColor: rgb(0.73, 0.93, 0.81), borderWidth: 1, borderRadius: 8 });
  page.drawText('✓ VERIFIED', { x: width - 125, y: height - 174, size: 10, font: helveticaBold, color: green });
  page.drawText('Auto-generated', { x: width - 128, y: height - 188, size: 8, font: helvetica, color: rgb(0.4, 0.6, 0.45) });

  // Divider
  page.drawLine({ start: { x: 40, y: height - 230 }, end: { x: width - 40, y: height - 230 }, thickness: 1, color: borderC });

  // ── INFO GRID ──
  const sectionY = height - 270;
  const col1 = 40, col2 = 320;

  function drawField(label, value, x, y) {
    page.drawText(label.toUpperCase(), { x, y, size: 8, font: helveticaBold, color: slate });
    const lines = wrapText(value, 32);
    lines.forEach((line, i) => {
      page.drawText(line, { x, y: y - 14 - (i * 14), size: 11, font: helveticaBold, color: dark });
    });
    return y - 14 - (lines.length * 14) - 8;
  }

  drawField('Property Address', propertyAddress, col1, sectionY);
  drawField('Landlord Reference', landlordId ? `LND-${landlordId.substring(0, 8).toUpperCase()}` : 'N/A', col2, sectionY);

  const row2Y = sectionY - 56;
  drawField('Tenant Name', `${tenantFirst} ${tenantLast}`, col1, row2Y);
  drawField('Tenant Email', tenantEmail, col2, row2Y);

  // Divider
  const row3Y = row2Y - 56;
  page.drawLine({ start: { x: 40, y: row3Y + 10 }, end: { x: width - 40, y: row3Y + 10 }, thickness: 0.5, color: borderC });

  // ── DELIVERY & READ TIMESTAMPS ──
  const tsY = row3Y - 20;
  page.drawText('DELIVERY & READ RECORD', { x: 40, y: tsY, size: 9, font: helveticaBold, color: blue });

  // Sent box
  const sentDate = formatDate(sentAt);
  page.drawRectangle({ x: 40, y: tsY - 60, width: 240, height: 55, color: lightBg, borderRadius: 8 });
  page.drawRectangle({ x: 40, y: tsY - 60, width: 240, height: 55, borderColor: borderC, borderWidth: 1, borderRadius: 8 });
  page.drawText('📧  DOCUMENT SENT', { x: 54, y: tsY - 28, size: 8, font: helveticaBold, color: slate });
  page.drawText(sentDate, { x: 54, y: tsY - 44, size: 11, font: helveticaBold, color: dark });

  // Arrow
  page.drawText('→', { x: 295, y: tsY - 36, size: 16, font: helveticaBold, color: blue });

  // Read box (highlighted)
  const readDate = formatDate(readAt);
  page.drawRectangle({ x: 315, y: tsY - 60, width: 240, height: 55, color: rgb(0.94, 0.99, 0.96), borderRadius: 8 });
  page.drawRectangle({ x: 315, y: tsY - 60, width: 240, height: 55, borderColor: rgb(0.73, 0.93, 0.81), borderWidth: 1.5, borderRadius: 8 });
  page.drawText('✓  DOCUMENT READ', { x: 329, y: tsY - 28, size: 8, font: helveticaBold, color: green });
  page.drawText(readDate, { x: 329, y: tsY - 44, size: 11, font: helveticaBold, color: dark });

  // ── TECHNICAL EVIDENCE ──
  const evY = tsY - 90;
  page.drawLine({ start: { x: 40, y: evY + 10 }, end: { x: width - 40, y: evY + 10 }, thickness: 0.5, color: borderC });

  page.drawText('TECHNICAL EVIDENCE', { x: 40, y: evY - 10, size: 9, font: helveticaBold, color: blue });

  page.drawText('IP Address:', { x: 40, y: evY - 30, size: 9, font: helveticaBold, color: slate });
  page.drawText(ipAddress, { x: 130, y: evY - 30, size: 10, font: helvetica, color: dark });

  page.drawText('Device Type:', { x: 40, y: evY - 47, size: 9, font: helveticaBold, color: slate });
  page.drawText(device, { x: 130, y: evY - 47, size: 10, font: helvetica, color: dark });

  page.drawText('Certificate ID:', { x: 40, y: evY - 64, size: 9, font: helveticaBold, color: slate });
  page.drawText(trackingId, { x: 130, y: evY - 64, size: 9, font: helvetica, color: dark });

  page.drawText('Issued by:', { x: 40, y: evY - 81, size: 9, font: helveticaBold, color: slate });
  page.drawText('CompliantUK Document Delivery Service', { x: 130, y: evY - 81, size: 9, font: helvetica, color: dark });

  // ── LEGAL STATEMENT ──
  const legalY = evY - 110;
  page.drawRectangle({ x: 40, y: legalY - 50, width: width - 80, height: 55, color: rgb(0.953, 0.969, 0.996), borderRadius: 8 });
  page.drawRectangle({ x: 40, y: legalY - 50, width: width - 80, height: 55, borderColor: rgb(0.749, 0.847, 0.984), borderWidth: 1, borderRadius: 8 });
  page.drawText('LEGAL STATEMENT', { x: 54, y: legalY - 16, size: 8, font: helveticaBold, color: blue });
  page.drawText('This certificate constitutes evidence of delivery and service of the Renters\' Rights Act 2025 Information Sheet', {
    x: 54, y: legalY - 30, size: 8.5, font: helvetica, color: rgb(0.2, 0.35, 0.65),
  });
  page.drawText('pursuant to the requirements of the Renters\' Rights Act 2025 (England). Generated automatically by CompliantUK.', {
    x: 54, y: legalY - 43, size: 8.5, font: helvetica, color: rgb(0.2, 0.35, 0.65),
  });

  // ── FOOTER ──
  page.drawLine({ start: { x: 0, y: 60 }, end: { x: width, y: 60 }, thickness: 0.5, color: borderC });
  page.drawRectangle({ x: 0, y: 0, width, height: 60, color: navy });
  page.drawText('CompliantUK — Official Document Delivery & Compliance Service', {
    x: 40, y: 36, size: 8, font: helvetica, color: slate,
  });
  page.drawText(`Certificate generated: ${formatDate(new Date().toISOString())} · www.compliantuk.co.uk`, {
    x: 40, y: 20, size: 7.5, font: helvetica, color: rgb(0.3, 0.4, 0.5),
  });
  page.drawText('© 2026 CompliantUK', { x: width - 110, y: 20, size: 7.5, font: helvetica, color: rgb(0.3, 0.4, 0.5) });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/London',
  }) + ' GMT';
}

function wrapText(text, maxChars) {
  if (!text) return ['N/A'];
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Also export as HTTP handler for direct calls
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const pdf = await generateCertificatePdf(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.status(200).send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
