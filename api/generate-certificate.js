// api/generate-certificate.js
// Generates a branded PDF compliance certificate using pdf-lib
// Called internally by send-documents.js after payment

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Colour palette matching CompliantUK brand
const BRAND_DARK   = rgb(0.102, 0.102, 0.180); // #1a1a2e
const BRAND_BLUE   = rgb(0.231, 0.510, 0.965); // #3b82f6
const BRAND_GREEN  = rgb(0.133, 0.773, 0.369); // #22c55e
const BRAND_LIGHT  = rgb(0.973, 0.980, 0.992); // #f8fafc
const WHITE        = rgb(1, 1, 1);
const GREY         = rgb(0.392, 0.455, 0.545); // #64748b
const BORDER_GREY  = rgb(0.886, 0.914, 0.941); // #e2e8f0

function generateReferenceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');
  const rand  = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `CUK-${year}${month}${day}-${rand}`;
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

export async function generateComplianceCertificate({
  landlordName,
  propertyAddress,
  tenantName,
  plan,
  paymentReference,
}) {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const ref         = generateReferenceNumber();
  const issuedDate  = formatDate();

  // ── Header band ──────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: BRAND_DARK });

  // Logo text
  page.drawText('CompliantUK', {
    x: 40, y: height - 52,
    size: 22, font: fontBold, color: WHITE,
  });
  page.drawText('Renters Rights Act Compliance Platform', {
    x: 40, y: height - 72,
    size: 9, font: fontRegular, color: rgb(0.576, 0.769, 0.984),
  });

  // CERTIFIED badge (top right)
  page.drawRectangle({ x: width - 130, y: height - 80, width: 100, height: 56, color: BRAND_BLUE, borderRadius: 4 });
  page.drawText('CERTIFIED', { x: width - 120, y: height - 44, size: 11, font: fontBold, color: WHITE });
  page.drawText('COMPLIANT', { x: width - 120, y: height - 58, size: 11, font: fontBold, color: WHITE });

  // ── Certificate title area ───────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 165, width, height: 65, color: BRAND_LIGHT });
  page.drawText('PROOF OF COMPLIANCE CERTIFICATE', {
    x: 40, y: height - 135,
    size: 16, font: fontBold, color: BRAND_DARK,
  });
  page.drawText('Renters Rights Act 2025 — Information Sheet Service Record', {
    x: 40, y: height - 155,
    size: 9, font: fontRegular, color: GREY,
  });

  // Ref + date (right side)
  page.drawText(`Ref: ${ref}`, {
    x: width - 200, y: height - 135,
    size: 9, font: fontBold, color: BRAND_BLUE,
  });
  page.drawText(`Issued: ${issuedDate}`, {
    x: width - 200, y: height - 150,
    size: 8, font: fontRegular, color: GREY,
  });

  // ── Green confirmation banner ────────────────────────────────────────────
  page.drawRectangle({ x: 40, y: height - 215, width: width - 80, height: 36, color: rgb(0.240, 0.918, 0.494, 0.15), borderRadius: 4 });
  page.drawRectangle({ x: 40, y: height - 215, width: 4, height: 36, color: BRAND_GREEN });
  page.drawText('✓  The Renters Rights Act Information Sheet has been issued for the property below.', {
    x: 54, y: height - 193,
    size: 9, font: fontBold, color: rgb(0.067, 0.400, 0.169),
  });
  page.drawText('This certificate serves as your legal proof of compliance under Section 3 of the Renters Rights Act 2025.', {
    x: 54, y: height - 207,
    size: 8, font: fontRegular, color: rgb(0.067, 0.400, 0.169),
  });

  // ── Details section ──────────────────────────────────────────────────────
  let y = height - 250;

  function drawDetailRow(label, value, yPos) {
    page.drawRectangle({ x: 40, y: yPos - 4, width: width - 80, height: 28, color: BRAND_LIGHT, borderRadius: 3 });
    page.drawText(label, { x: 52, y: yPos + 8, size: 8, font: fontBold, color: GREY });
    page.drawText(value || '—', { x: 200, y: yPos + 8, size: 9, font: fontRegular, color: BRAND_DARK });
    return yPos - 36;
  }

  page.drawText('COMPLIANCE DETAILS', { x: 40, y: y, size: 10, font: fontBold, color: BRAND_DARK });
  page.drawLine({ start: { x: 40, y: y - 8 }, end: { x: width - 40, y: y - 8 }, thickness: 1, color: BORDER_GREY });
  y -= 24;

  y = drawDetailRow('Landlord / Agent Name', landlordName || 'Not provided', y);
  y = drawDetailRow('Property Address',       propertyAddress,               y);
  y = drawDetailRow('Tenant Name',            tenantName || 'Not provided',  y);
  y = drawDetailRow('Compliance Package',     plan === 'bundle' ? 'Complete Bundle (£89) — Information Sheet + Updated Tenancy Agreement' : 'Starter (£49) — Information Sheet + Proof of Service', y);
  y = drawDetailRow('Date of Issue',          issuedDate,                    y);
  y = drawDetailRow('Payment Reference',      paymentReference || ref,       y);
  y = drawDetailRow('Certificate Reference',  ref,                           y);

  // ── Documents included ───────────────────────────────────────────────────
  y -= 16;
  page.drawText('DOCUMENTS INCLUDED IN THIS PACKAGE', { x: 40, y, size: 10, font: fontBold, color: BRAND_DARK });
  page.drawLine({ start: { x: 40, y: y - 8 }, end: { x: width - 40, y: y - 8 }, thickness: 1, color: BORDER_GREY });
  y -= 24;

  const docs = [
    { name: 'Renters Rights Act Information Sheet', desc: 'Government-prescribed document — serve on tenant immediately' },
    { name: 'Proof of Service Certificate',         desc: 'This document — retain for your records' },
    ...(plan === 'bundle' ? [{ name: 'Updated Section 21-Compliant Tenancy Agreement', desc: 'Revised 2026 template aligned with Renters Rights Act' }] : []),
  ];

  for (const doc of docs) {
    page.drawCircle({ x: 52, y: y + 5, size: 5, color: BRAND_BLUE });
    page.drawText(doc.name, { x: 64, y: y + 2, size: 9, font: fontBold, color: BRAND_DARK });
    page.drawText(doc.desc, { x: 64, y: y - 10, size: 8, font: fontRegular, color: GREY });
    y -= 28;
  }

  // ── Legal statement ──────────────────────────────────────────────────────
  y -= 16;
  page.drawRectangle({ x: 40, y: y - 52, width: width - 80, height: 72, color: rgb(0.937, 0.949, 0.996), borderRadius: 4 });
  page.drawText('LEGAL STATEMENT', { x: 52, y: y - 4, size: 9, font: fontBold, color: BRAND_BLUE });

  const legalText = [
    'This certificate confirms that the Renters Rights Act 2025 Information Sheet has been generated and issued',
    `for the above property on ${issuedDate}. The landlord or managing agent is responsible for ensuring the`,
    'Information Sheet is physically served on the tenant prior to or at the commencement of any new tenancy.',
    'Failure to serve the Information Sheet may result in a civil penalty of up to £7,000 under the Act.',
  ];

  let ly = y - 18;
  for (const line of legalText) {
    page.drawText(line, { x: 52, y: ly, size: 7.5, font: fontRegular, color: BRAND_DARK });
    ly -= 11;
  }
  y -= 80;

  // ── Signature section ────────────────────────────────────────────────────
  y -= 8;
  page.drawText('PROOF OF SERVICE', { x: 40, y, size: 10, font: fontBold, color: BRAND_DARK });
  page.drawLine({ start: { x: 40, y: y - 8 }, end: { x: width - 40, y: y - 8 }, thickness: 1, color: BORDER_GREY });
  y -= 24;

  page.drawText('Landlord / Agent signature:', { x: 40, y, size: 9, font: fontRegular, color: GREY });
  page.drawLine({ start: { x: 200, y }, end: { x: 380, y }, thickness: 0.5, color: BRAND_DARK });

  page.drawText('Date served to tenant:', { x: 40, y: y - 24, size: 9, font: fontRegular, color: GREY });
  page.drawLine({ start: { x: 200, y: y - 24 }, end: { x: 380, y: y - 24 }, thickness: 0.5, color: BRAND_DARK });

  page.drawText('Tenant signature (acknowledgement):', { x: 40, y: y - 48, size: 9, font: fontRegular, color: GREY });
  page.drawLine({ start: { x: 200, y: y - 48 }, end: { x: 380, y: y - 48 }, thickness: 0.5, color: BRAND_DARK });

  page.drawText('Tenant printed name:', { x: 40, y: y - 72, size: 9, font: fontRegular, color: GREY });
  page.drawLine({ start: { x: 200, y: y - 72 }, end: { x: 380, y: y - 72 }, thickness: 0.5, color: BRAND_DARK });

  // ── Footer ───────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height: 44, color: BRAND_DARK });
  page.drawText('CompliantUK — The UK Landlord Compliance Platform', {
    x: 40, y: 28, size: 8, font: fontBold, color: WHITE,
  });
  page.drawText('www.compliantuk.co.uk  |  support@compliantuk.co.uk', {
    x: 40, y: 14, size: 7.5, font: fontRegular, color: rgb(0.576, 0.769, 0.984),
  });
  page.drawText(`Certificate ${ref}  |  Issued ${issuedDate}`, {
    x: width - 250, y: 14, size: 7, font: fontRegular, color: GREY,
  });

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, referenceNumber: ref };
}

// HTTP handler — can also be called directly via POST for testing
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { landlordName, propertyAddress, tenantName, plan, paymentReference } = req.body;

    if (!propertyAddress) {
      return res.status(400).json({ error: 'propertyAddress is required' });
    }

    const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
      landlordName, propertyAddress, tenantName, plan, paymentReference,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CompliantUK-Certificate-${referenceNumber}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Certificate generation error:', error);
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
}

