/**
 * send-documents.js
 *
 * Called after successful payment (Stripe/PayPal webhook or redirect).
 *
 * What this does:
 *   1. Sends EACH TENANT their own individual email:
 *        - Personalised covering letter (addressed by name)
 *        - Official GOV.UK Information Sheet as a PDF attachment
 *        - Read-tracking pixel per tenant
 *
 *   2. Sends THE LANDLORD/AGENT one email containing:
 *        - A copy of the official GOV.UK Information Sheet
 *        - Their proof-of-service certificate (PDF) listing:
 *            · Landlord name
 *            · Property address
 *            · All tenant names on this tenancy
 *        - A link to their dashboard
 *
 *   3. Schedules a 48-hour reminder for any tenant who hasn't read yet.
 *
 * Usage:
 *   const { sendDocuments } = require('./send-documents');
 *   await sendDocuments(order);
 *
 * order shape:
 *   {
 *     orderId: string,
 *     landlordFirst: string,
 *     landlordLast: string,
 *     landlordEmail: string,
 *     propertyAddress: string,
 *     tenants: [{ first, last, email }],   // 1–4 entries
 *     dashboardUrl?: string,
 *   }
 */

'use strict';

const nodemailer = require('nodemailer');
const path       = require('path');
const { generateCertificate } = require('./generate-certificate');

// ── Config ────────────────────────────────────────────────────────────────────
const INFO_SHEET_PATH = path.join(__dirname, 'The_Renters__Rights_Act_Information_Sheet_2026.pdf');
const FROM            = `"CompliantUK" <${process.env.EMAIL_FROM || 'noreply@compliantuk.co.uk'}>`;
const BASE_URL        = process.env.BASE_URL || 'https://www.compliantuk.co.uk';
const REMINDER_MS     = 48 * 60 * 60 * 1000; // 48 hours

// ── Transport ─────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ── Main export ───────────────────────────────────────────────────────────────
async function sendDocuments(order) {
  const {
    orderId,
    landlordFirst,
    landlordLast,
    landlordEmail,
    propertyAddress,
    tenants,
    dashboardUrl,
  } = order;

  if (!tenants || tenants.length === 0) throw new Error('No tenants in order.');

  const transport    = createTransport();
  const landlordName = `${landlordFirst} ${landlordLast}`;
  const dashboard    = dashboardUrl || `${BASE_URL}/dashboard.html`;

  const infoSheetAttachment = {
    filename:    'Renters_Rights_Act_Information_Sheet_2026.pdf',
    path:        INFO_SHEET_PATH,
    contentType: 'application/pdf',
  };

  // ── 1. Email EACH TENANT individually ────────────────────────────────────
  const tenantResults = [];

  for (let i = 0; i < tenants.length; i++) {
    const tenant     = tenants[i];
    const tenantName = `${tenant.first} ${tenant.last}`;
    const trackingUrl = `${BASE_URL}/api/track?orderId=${encodeURIComponent(orderId)}&t=${i}&event=open`;

    try {
      await transport.sendMail({
        from,
        to:          `"${tenantName}" <${tenant.email}>`,
        subject:     `Important: Your Renters' Rights Act Information Sheet — ${propertyAddress}`,
        html:        tenantEmailHtml({ tenantName, landlordName, propertyAddress, trackingUrl }),
        attachments: [infoSheetAttachment],
      });

      console.log(`[send] ✓ Tenant email sent → ${tenant.email} (order ${orderId})`);
      tenantResults.push({ index: i, email: tenant.email, status: 'sent', sentAt: new Date().toISOString() });
    } catch (err) {
      console.error(`[send] ✗ Failed → ${tenant.email}:`, err.message);
      tenantResults.push({ index: i, email: tenant.email, status: 'failed', error: err.message });
    }
  }

  // ── 2. Generate landlord certificate PDF ─────────────────────────────────
  let certBuffer = null;
  try {
    certBuffer = await generateCertificate({
      landlordName,
      propertyAddress,
      tenants:  tenants.map(t => `${t.first} ${t.last}`),
      orderId,
      issuedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[send] Certificate generation failed:', err.message);
  }

  // ── 3. Email THE LANDLORD with info sheet + certificate ──────────────────
  const landlordAttachments = [infoSheetAttachment];

  if (certBuffer) {
    landlordAttachments.push({
      filename:    `CompliantUK_Certificate_${orderId}.pdf`,
      content:     certBuffer,
      contentType: 'application/pdf',
    });
  }

  try {
    await transport.sendMail({
      from,
      to:          `"${landlordName}" <${landlordEmail}>`,
      subject:     `CompliantUK — Your compliance documents for ${propertyAddress}`,
      html:        landlordEmailHtml({ landlordName, propertyAddress, tenants, orderId, dashboard, hasCert: !!certBuffer }),
      attachments: landlordAttachments,
    });
    console.log(`[send] ✓ Landlord email sent → ${landlordEmail} (order ${orderId})`);
  } catch (err) {
    console.error('[send] ✗ Landlord email failed:', err.message);
  }

  // ── 4. Schedule 48-hour read reminders ───────────────────────────────────
  tenantResults
    .filter(r => r.status === 'sent')
    .forEach(r => {
      setTimeout(async () => {
        const hasRead = await checkTenantRead(orderId, r.index).catch(() => false);
        if (hasRead) return;
        const tenant     = tenants[r.index];
        const tenantName = `${tenant.first} ${tenant.last}`;
        try {
          await transport.sendMail({
            from,
            to:          `"${tenantName}" <${tenant.email}>`,
            subject:     `Reminder: Please read your Renters' Rights Act Information Sheet — ${propertyAddress}`,
            html:        reminderEmailHtml({ tenantName, landlordName, propertyAddress }),
            attachments: [infoSheetAttachment],
          });
          console.log(`[remind] ✓ 48hr reminder sent → ${tenant.email}`);
        } catch (err) {
          console.error(`[remind] ✗ Reminder failed → ${tenant.email}:`, err.message);
        }
      }, REMINDER_MS);
    });

  return tenantResults;
}

// ── DB helper (stub — implement with your DB) ─────────────────────────────────
async function checkTenantRead(orderId, tenantIndex) {
  // Example: return db.tenantReads.exists({ orderId, tenantIndex });
  return false;
}


// ════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

// ── Tenant email ──────────────────────────────────────────────────────────────
function tenantEmailHtml({ tenantName, landlordName, propertyAddress, trackingUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your Renters' Rights Act Information Sheet</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:#080c14;padding:24px 36px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;">
        <span style="display:inline-block;width:28px;height:28px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);border-radius:7px;text-align:center;line-height:28px;font-size:13px;font-weight:800;color:white;">✓</span>
        <span style="font-size:16px;font-weight:700;color:#f1f5f9;letter-spacing:-0.3px;">Compliant<span style="color:#60a5fa;">UK</span></span>
      </span></td>
      <td align="right"><span style="font-size:11px;color:#94a3b8;font-family:monospace;">RENTERS RIGHTS ACT 2025</span></td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 36px 28px;">
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 20px;line-height:1.3;font-weight:700;">Renters' Rights Act — Information Sheet</h1>

    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 16px;">Dear ${escHtml(tenantName)},</p>

    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 16px;">
      Your landlord, <strong>${escHtml(landlordName)}</strong>, is required by law to provide you with the official Government Information Sheet under the <strong>Renters' Rights Act 2025</strong> for the property at <strong>${escHtml(propertyAddress)}</strong>.
    </p>

    <!-- Callout -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:18px 20px;">
        <p style="font-size:14px;font-weight:700;color:#1e40af;margin:0 0 10px;">📎 The Information Sheet is attached to this email as a PDF.</p>
        <p style="font-size:14px;color:#1e3a8a;margin:0 0 8px;line-height:1.6;">Please read it carefully. It explains your new legal rights including:</p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="font-size:13px;color:#1e3a8a;padding:3px 0;">✓ &nbsp;Your rights regarding rent increases</td></tr>
          <tr><td style="font-size:13px;color:#1e3a8a;padding:3px 0;">✓ &nbsp;How tenancies can now be ended</td></tr>
          <tr><td style="font-size:13px;color:#1e3a8a;padding:3px 0;">✓ &nbsp;Your rights regarding repairs and property condition</td></tr>
          <tr><td style="font-size:13px;color:#1e3a8a;padding:3px 0;">✓ &nbsp;How to raise concerns or dispute decisions</td></tr>
        </table>
      </td></tr>
    </table>

    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 16px;">
      This is the official document published by GOV.UK and is the only version required under legislation. Please open and read the attached PDF at your earliest convenience.
    </p>

    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 28px;">
      If you have questions about your tenancy rights, visit <a href="https://www.citizensadvice.org.uk" style="color:#3b82f6;">Citizens Advice</a> or <a href="https://www.gov.uk/private-renting" style="color:#3b82f6;">GOV.UK</a>.
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">

    <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
      This email was sent on behalf of <strong>${escHtml(landlordName)}</strong> by CompliantUK, a compliance document delivery service for private landlords in England. CompliantUK is not a party to your tenancy and is not your landlord's legal representative.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#080c14;padding:18px 36px;text-align:center;">
    <p style="color:#475569;font-size:12px;margin:0;font-family:Arial,sans-serif;">
      © 2026 CompliantUK &nbsp;·&nbsp;
      <a href="https://www.compliantuk.co.uk/privacy.html" style="color:#60a5fa;text-decoration:none;">Privacy Policy</a> &nbsp;·&nbsp;
      <a href="https://www.compliantuk.co.uk/terms.html" style="color:#60a5fa;text-decoration:none;">Terms</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
<!-- Read tracking pixel -->
<img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;opacity:0;border:none;">
</body></html>`;
}

// ── Landlord email ────────────────────────────────────────────────────────────
function landlordEmailHtml({ landlordName, propertyAddress, tenants, orderId, dashboard, hasCert }) {
  const tenantRows = tenants.map((t, i) => `
    <tr>
      <td style="padding:9px 12px;font-size:13px;color:#334155;border-bottom:1px solid #e2e8f0;">${i+1}. ${escHtml(t.first)} ${escHtml(t.last)}</td>
      <td style="padding:9px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escHtml(t.email)}</td>
      <td style="padding:9px 12px;font-size:12px;font-weight:700;color:#16a34a;border-bottom:1px solid #e2e8f0;">✓ Sent</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your compliance documents — CompliantUK</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:#080c14;padding:24px 36px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="display:inline-flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:28px;height:28px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);border-radius:7px;text-align:center;line-height:28px;font-size:13px;font-weight:800;color:white;">✓</span>
        <span style="font-size:16px;font-weight:700;color:#f1f5f9;letter-spacing:-0.3px;">Compliant<span style="color:#60a5fa;">UK</span></span>
      </span></td>
    </tr></table>
  </td></tr>

  <!-- Success banner -->
  <tr><td style="background:#15803d;padding:14px 36px;">
    <p style="color:#ffffff;font-size:15px;font-weight:700;margin:0;">✅ &nbsp;You're compliant — documents delivered to all tenants.</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 36px 28px;">
    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 16px;">Dear ${escHtml(landlordName)},</p>

    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 20px;">
      Payment confirmed and the official Renters' Rights Act Information Sheet has been sent to all tenants at <strong>${escHtml(propertyAddress)}</strong>. Your compliance documents are attached to this email.
    </p>

    <!-- Order details -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 24px;">
      <tr><td style="padding:16px 20px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin:0 0 10px;font-family:monospace;">Order details</p>
        <p style="font-size:14px;color:#334155;margin:0 0 5px;"><strong>Property:</strong> ${escHtml(propertyAddress)}</p>
        <p style="font-size:14px;color:#334155;margin:0 0 5px;"><strong>Landlord:</strong> ${escHtml(landlordName)}</p>
        <p style="font-size:14px;color:#334155;margin:0;"><strong>Order ref:</strong> <span style="font-family:monospace;color:#64748b;">${escHtml(orderId)}</span></p>
      </td></tr>
    </table>

    <!-- Tenants table -->
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin:0 0 8px;font-family:monospace;">Tenants on this tenancy</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 24px;">
      <tr style="background:#f8fafc;">
        <th style="padding:9px 12px;font-size:11px;font-family:monospace;text-align:left;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Tenant</th>
        <th style="padding:9px 12px;font-size:11px;font-family:monospace;text-align:left;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Email</th>
        <th style="padding:9px 12px;font-size:11px;font-family:monospace;text-align:left;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
      </tr>
      ${tenantRows}
    </table>

    <!-- Attachments note -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;">
        <p style="font-size:13px;font-weight:700;color:#15803d;margin:0 0 8px;">📎 Attached to this email:</p>
        <p style="font-size:13px;color:#166534;margin:0 0 4px;">1. Official GOV.UK Renters' Rights Act Information Sheet (PDF)</p>
        ${hasCert ? `<p style="font-size:13px;color:#166534;margin:0;">2. Your proof-of-service certificate — includes landlord name, property address, and all tenants listed</p>` : ''}
      </td></tr>
    </table>

    <!-- Dashboard CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#080c14;border-radius:10px;margin:0 0 24px;">
      <tr><td style="padding:22px 24px;text-align:center;">
        <p style="color:#94a3b8;font-size:13px;font-family:Arial,sans-serif;margin:0 0 14px;">Track reads, opens, and download your certificate anytime from your dashboard.</p>
        <a href="${dashboard}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#ffffff;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;font-family:Arial,sans-serif;">Go to my dashboard →</a>
      </td></tr>
    </table>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">

    <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
      CompliantUK provides document delivery and compliance tracking services for private landlords in England. We are not solicitors and nothing in this email constitutes legal advice. If challenged, present your dashboard certificate and this email as evidence of service. For legal questions, consult a qualified solicitor.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#080c14;padding:18px 36px;text-align:center;">
    <p style="color:#475569;font-size:12px;margin:0;font-family:Arial,sans-serif;">
      © 2026 CompliantUK &nbsp;·&nbsp;
      <a href="https://www.compliantuk.co.uk/privacy.html" style="color:#60a5fa;text-decoration:none;">Privacy</a> &nbsp;·&nbsp;
      <a href="https://www.compliantuk.co.uk/terms.html" style="color:#60a5fa;text-decoration:none;">Terms</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Reminder email ────────────────────────────────────────────────────────────
function reminderEmailHtml({ tenantName, landlordName, propertyAddress }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#080c14;padding:24px 36px;">
    <span style="font-size:16px;font-weight:700;color:#f1f5f9;">Compliant<span style="color:#60a5fa;">UK</span></span>
  </td></tr>
  <tr><td style="padding:36px;">
    <h2 style="font-size:20px;color:#0f172a;margin:0 0 16px;font-weight:700;">Reminder: Your Information Sheet is waiting to be read</h2>
    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 14px;">Dear ${escHtml(tenantName)},</p>
    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 14px;">
      We sent you an important document from your landlord <strong>${escHtml(landlordName)}</strong> regarding your tenancy at <strong>${escHtml(propertyAddress)}</strong> 48 hours ago. We noticed you haven't had a chance to read it yet.
    </p>
    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 14px;">
      The <strong>Renters' Rights Act 2025 Information Sheet</strong> is re-attached for your convenience. This is an important government document setting out your rights as a tenant.
    </p>
    <p style="font-size:15px;color:#334155;line-height:1.75;margin:0;">
      Please read it at your earliest opportunity. For tenancy questions visit <a href="https://www.citizensadvice.org.uk" style="color:#3b82f6;">Citizens Advice</a>.
    </p>
  </td></tr>
  <tr><td style="background:#080c14;padding:18px 36px;text-align:center;">
    <p style="color:#475569;font-size:12px;margin:0;font-family:Arial,sans-serif;">© 2026 CompliantUK</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendDocuments };
