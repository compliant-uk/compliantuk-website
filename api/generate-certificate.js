// api/generate-certificate.js
// Generates proof-of-service certificate PDF
// Called from stripe-webhook immediately after tenant emails are sent
// Certificates stored in Supabase Storage — never emailed

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Generate certificate PDF, upload to Supabase Storage, update tenancy record
 * @returns {Promise<string>} public URL of the stored certificate
 */
export async function generateAndStoreCertificate({
  tenancyId,
  propertyAddress,
  tenantFirst,
  tenantLast,
  tenantEmail,
  sentAt,
  landlordId,
  trackingId,
}) {
  const pdf = await buildCertificatePdf({
    propertyAddress, tenantFirst, tenantLast, tenantEmail,
    sentAt, readAt: null, ipAddress: null, device: null,
    trackingId, landlordId,
  });

  // Store in Supabase Storage under landlord's folder
  const filename = `${landlordId}/${trackingId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('certificates')
    .upload(filename, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('certificates')
    .getPublicUrl(filename);

  // Save URL back to tenancy record
  await supabase
    .from('tenancies')
    .update({ certificate_url: publicUrl })
    .eq('id', tenancyId);

  return publicUrl;
}

/**
 * Build the PDF bytes — pure function, no side effects
 */
export async function buildCertificatePdf({
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

  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const navy    = rgb(0.031, 0.047, 0.078);
  const blue    = rgb(0.231, 0.510, 0.965);
  const blue2   = rgb(0.376, 0.647, 0.980);
  const green   = rgb(0.166, 0.663, 0.376);
  const slate   = rgb(0.580, 0.635, 0.722);
  const dark    = rgb(0.063, 0.094, 0.157);
  const lightBg = rgb(0.973, 0.984, 0.996);
  const borderC = rgb(0.882, 0.914, 0.941);
  const greenBg = rgb(0.94, 0.99, 0.96);
  const greenBd = rgb(0.73, 0.93, 0.81);
  const blueBg  = rgb(0.953, 0.969, 0.996);
  const blueBd  = rgb(0.749, 0.847, 0.984);
  const midGrey = rgb(0.4, 0.45, 0.5);
  const white   = rgb(1, 1, 1);

  // ── HEADER ──
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: navy });
  page.drawRectangle({ x: 40, y: height - 88, width: 36, height: 36, color: blue });
  page.drawText('CUK', { x: 43, y: height - 72, size: 9, font: bold, color: white });
  page.drawText('CompliantUK', { x: 84, y: height - 72, size: 16, font: bold, color: white });
  page.drawText('PROOF OF SERVICE CERTIFICATE', {
    x: width - 280, y: height - 64, size: 9, font: bold, color: blue2,
  });
  page.drawText("Renters' Rights Act 2025 — Compliance Record", {
    x: width - 280, y: height - 78, size: 8, font: regular, color: slate,
  });

  // Accent bar
  page.drawRectangle({ x: 0, y: height - 124, width, height: 4, color: blue });

  // ── TITLE ──
  page.drawText('PROOF OF SERVICE', { x: 40, y: height - 168, size: 28, font: bold, color: dark });
  page.drawText('This certificate confirms that the official Government Information Sheet', {
    x: 40, y: height - 196, size: 11, font: regular, color: midGrey,
  });
  page.drawText("was delivered to the tenant named below.", {
    x: 40, y: height - 212, size: 11, font: regular, color: midGrey,
  });

  // Verified badge
  page.drawRectangle({ x: width - 140, y: height - 202, width: 100, height: 46, color: greenBg });
  page.drawRectangle({ x: width - 140, y: height - 202, width: 100, height: 46, borderColor: greenBd, borderWidth: 1 });
  page.drawText('DELIVERED', { x: width - 126, y: height - 174, size: 10, font: bold, color: green });
  page.drawText('Auto-generated', { x: width - 128, y: height - 188, size: 8, font: regular, color: rgb(0.4, 0.6, 0.45) });

  // Divider
  page.drawLine({ start: { x: 40, y: height - 230 }, end: { x: width - 40, y: height - 230 }, thickness: 1, color: borderC });

  // ── INFO GRID ──
  const sectionY = height - 270;

  function drawField(label, value, x, y) {
    page.drawText(label.toUpperCase(), { x, y, size: 8, font: bold, color: slate });
    const lines = wrapText(value || 'N/A', 32);
    lines.forEach((line, i) => {
      page.drawText(line, { x, y: y - 14 - (i * 14), size: 11, font: bold, color: dark });
    });
    return y - 14 - (lines.length * 14) - 8;
  }

  drawField('Property Address', propertyAddress, 40, sectionY);
  drawField('Landlord Reference', landlordId ? `LND-${landlordId.substring(0, 8).toUpperCase()}` : 'N/A', 320, sectionY);

  const row2Y = sectionY - 56;
  drawField('Tenant Name', `${tenantFirst} ${tenantLast}`, 40, row2Y);
  drawField('Tenant Email', tenantEmail, 320, row2Y);

  // Divider
  const row3Y = row2Y - 56;
  page.drawLine({ start: { x: 40, y: row3Y + 10 }, end: { x: width - 40, y: row3Y + 10 }, thickness: 0.5, color: borderC });

  // ── DELIVERY RECORD ──
  const tsY = row3Y - 20;
  page.drawText('DELIVERY RECORD', { x: 40, y: tsY, size: 9, font: bold, color: blue });

  // Sent box
  page.drawRectangle({ x: 40, y: tsY - 60, width: 240, height: 55, color: lightBg });
  page.drawRectangle({ x: 40, y: tsY - 60, width: 240, height: 55, borderColor: borderC, borderWidth: 1 });
  page.drawText('EMAIL SENT', { x: 54, y: tsY - 28, size: 8, font: bold, color: slate });
  page.drawText(formatDate(sentAt), { x: 54, y: tsY - 44, size: 11, font: bold, color: dark });

  // Arrow
  page.drawText('->', { x: 295, y: tsY - 36, size: 16, font: bold, color: blue });

  // Delivery confirmed box
  page.drawRectangle({ x: 315, y: tsY - 60, width: 240, height: 55, color: greenBg });
  page.drawRectangle({ x: 315, y: tsY - 60, width: 240, height: 55, borderColor: greenBd, borderWidth: 1.5 });
  page.drawText('DELIVERED', { x: 329, y: tsY - 28, size: 8, font: bold, color: green });
  page.drawText(formatDate(sentAt), { x: 329, y: tsY - 44, size: 11, font: bold, color: dark });

  // Read row — always shown, with pending state if not yet captured
  const rdY = tsY - 80;
  page.drawText('TENANT OPEN RECORD:', { x: 40, y: rdY, size: 9, font: bold, color: blue });
  if (readAt) {
    page.drawText(formatDate(readAt), { x: 200, y: rdY, size: 9, font: regular, color: dark });
  } else {
    page.drawRectangle({ x: 200, y: rdY - 4, width: 80, height: 14, color: rgb(0.98, 0.97, 0.93) });
    page.drawText('Awaiting open', { x: 202, y: rdY, size: 8, font: regular, color: rgb(0.7, 0.6, 0.2) });
  }

  page.drawText('IP ADDRESS:', { x: 40, y: rdY - 18, size: 9, font: bold, color: slate });
  page.drawText(
    ipAddress && ipAddress !== 'Not recorded' ? ipAddress : (readAt ? 'Not recorded' : 'Pending — captured on open'),
    { x: 130, y: rdY - 18, size: 9, font: regular, color: dark }
  );

  page.drawText('DEVICE:', { x: 40, y: rdY - 34, size: 9, font: bold, color: slate });
  page.drawText(
    device && device !== 'Unknown' ? device : (readAt ? 'Unknown' : 'Pending — captured on open'),
    { x: 130, y: rdY - 34, size: 9, font: regular, color: dark }
  );

  // ── TECHNICAL EVIDENCE ──
  const evY = tsY - 130;
  page.drawLine({ start: { x: 40, y: evY + 10 }, end: { x: width - 40, y: evY + 10 }, thickness: 0.5, color: borderC });

  page.drawText('TECHNICAL EVIDENCE', { x: 40, y: evY - 10, size: 9, font: bold, color: blue });
  page.drawText('Certificate ID:', { x: 40, y: evY - 30, size: 9, font: bold, color: slate });
  page.drawText(trackingId || 'N/A', { x: 130, y: evY - 30, size: 9, font: regular, color: dark });
  page.drawText('Issued by:', { x: 40, y: evY - 47, size: 9, font: bold, color: slate });
  page.drawText('CompliantUK Document Delivery Service', { x: 130, y: evY - 47, size: 9, font: regular, color: dark });

  // ── LEGAL STATEMENT ──
  const legalY = evY - 76;
  page.drawRectangle({ x: 40, y: legalY - 50, width: width - 80, height: 55, color: blueBg });
  page.drawRectangle({ x: 40, y: legalY - 50, width: width - 80, height: 55, borderColor: blueBd, borderWidth: 1 });
  page.drawText('LEGAL STATEMENT', { x: 54, y: legalY - 16, size: 8, font: bold, color: blue });
  page.drawText("This certificate constitutes evidence of delivery of the Renters' Rights Act 2025 Information Sheet", {
    x: 54, y: legalY - 30, size: 8.5, font: regular, color: rgb(0.2, 0.35, 0.65),
  });
  page.drawText('pursuant to the requirements of the Renters\' Rights Act 2025 (England). Generated automatically by CompliantUK.', {
    x: 54, y: legalY - 43, size: 8.5, font: regular, color: rgb(0.2, 0.35, 0.65),
  });

  // ── FOOTER ──
  page.drawLine({ start: { x: 0, y: 60 }, end: { x: width, y: 60 }, thickness: 0.5, color: borderC });
  page.drawRectangle({ x: 0, y: 0, width, height: 60, color: navy });
  page.drawText('CompliantUK — Official Document Delivery & Compliance Service', {
    x: 40, y: 36, size: 8, font: regular, color: slate,
  });
  page.drawText(`Certificate generated: ${formatDate(new Date().toISOString())} · www.compliantuk.co.uk`, {
    x: 40, y: 20, size: 7.5, font: regular, color: rgb(0.3, 0.4, 0.5),
  });
  page.drawText('© 2026 CompliantUK', { x: width - 110, y: 20, size: 7.5, font: regular, color: rgb(0.3, 0.4, 0.5) });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── HTTP handler — called from dashboard "Download Certificate" button ────────
// Returns the PDF directly for on-demand download
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { tenancyId } = req.body;
    if (!tenancyId) return res.status(400).json({ error: 'tenancyId required' });

    // Fetch tenancy record
    const { data, error } = await supabase
      .from('tenancies')
      .select('*')
      .eq('id', tenancyId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Tenancy not found' });

    // If already stored, redirect to stored URL
    if (data.certificate_url) {
      return res.redirect(302, data.certificate_url);
    }

    // Otherwise generate on-the-fly and stream back
    const pdf = await buildCertificatePdf({
      propertyAddress: data.property_address,
      tenantFirst:     data.tenant_first,
      tenantLast:      data.tenant_last,
      tenantEmail:     data.tenant_email,
      sentAt:          data.sent_at,
      readAt:          data.read_at,
      ipAddress:       data.tenant_ip,
      device:          data.tenant_device,
      trackingId:      data.tracking_id,
      landlordId:      data.landlord_id,
    });

    // Also upload it now so future downloads use storage
    if (data.landlord_id && data.tracking_id) {
      try {
        const filename = `${data.landlord_id}/${data.tracking_id}.pdf`;
        await supabase.storage.from('certificates').upload(filename, pdf, {
          contentType: 'application/pdf', upsert: true,
        });
        const { data: { publicUrl } } = supabase.storage.from('certificates').getPublicUrl(filename);
        await supabase.from('tenancies').update({ certificate_url: publicUrl }).eq('id', tenancyId);
      } catch (e) {
        console.error('Storage upload error (non-fatal):', e.message);
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Certificate-${data.tenant_first}-${data.tenant_last}.pdf"`);
    res.status(200).send(pdf);
  } catch (err) {
    console.error('Certificate generation error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
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
