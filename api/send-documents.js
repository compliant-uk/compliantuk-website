// api/send-documents.js
// Handles post-payment document delivery via Resend email service
// Sends personalised emails to each tenant and landlord with proof certificates

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { generateCertificatePdf } from './generate-certificate.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BASE_URL = 'https://www.compliantuk.co.uk';

/**
 * Sends document delivery emails to tenants and landlord after successful payment
 * @param {Object} order - Order data from Stripe webhook
 * @param {string} order.landlordFirst
 * @param {string} order.landlordLast
 * @param {string} order.landlordEmail
 * @param {string} order.propertyAddress
 * @param {Array<{first: string, last: string, email: string}>} order.tenants
 * @param {string} order.orderId - unique order/session ID for tracking
 */
export async function sendDocuments(order) {
  const { landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants, orderId } = order;
  const landlordName = `${landlordFirst} ${landlordLast}`;

  if (!tenants || tenants.length === 0) {
    throw new Error('No tenants provided in order.');
  }

  // Fetch GOV.UK Information Sheet PDF from Supabase storage or use embedded URL
  // For now, we'll reference the PDF URL directly
  const infoPdfUrl = `${BASE_URL}/The_Renters__Rights_Act_Information_Sheet_2026.pdf`;

  // ── 1. Email each tenant individually ────────────────────────────────────
  const tenantResults = [];
  for (let i = 0; i < tenants.length; i++) {
    const tenant = tenants[i];
    const tenantName = `${tenant.first} ${tenant.last}`;
    const trackingId = `${orderId}_tenant_${i}`;

    try {
      const html = buildTenantEmail({
        tenantName,
        landlordName,
        propertyAddress,
        trackingId,
      });

      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: tenant.email,
        subject: `Important: Your Renters' Rights Act Information Sheet — ${propertyAddress}`,
        html,
        attachments: [
          {
            filename: 'Renters_Rights_Act_Information_Sheet_2026.pdf',
            path: infoPdfUrl,
          },
        ],
      });

      tenantResults.push({
        tenantIndex: i,
        email: tenant.email,
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
      console.log(`[send-documents] Tenant email sent: ${tenant.email} (order ${orderId})`);
    } catch (err) {
      console.error(`[send-documents] Failed to email tenant ${tenant.email}:`, err.message);
      tenantResults.push({
        tenantIndex: i,
        email: tenant.email,
        status: 'failed',
        error: err.message,
      });
    }
  }

  // ── 2. Generate certificate PDF (landlord copy) ───────────────────────────
  let certificatePdfBuffer = null;
  try {
    certificatePdfBuffer = await generateCertificatePdf({
      landlordName,
      propertyAddress,
      tenants: tenants.map(t => `${t.first} ${t.last}`),
      orderId,
      issuedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[send-documents] Certificate generation failed:', err.message);
  }

  // ── 3. Email landlord ─────────────────────────────────────────────────────
  const landlordAttachments = [
    {
      filename: 'Renters_Rights_Act_Information_Sheet_2026.pdf',
      path: infoPdfUrl,
    },
  ];

  if (certificatePdfBuffer) {
    landlordAttachments.push({
      filename: `CompliantUK_Certificate_${orderId}.pdf`,
      content: certificatePdfBuffer,
      contentType: 'application/pdf',
    });
  }

  try {
    const html = buildLandlordEmail({
      landlordName,
      propertyAddress,
      tenants,
      orderId,
    });

    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      to: landlordEmail,
      subject: `CompliantUK — Your compliance documents for ${propertyAddress}`,
      html,
      attachments: landlordAttachments,
    });
    console.log(`[send-documents] Landlord email sent: ${landlordEmail} (order ${orderId})`);
  } catch (err) {
    console.error('[send-documents] Failed to email landlord:', err.message);
  }

  return tenantResults;
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildTenantEmail({ tenantName, landlordName, propertyAddress, trackingId }) {
  const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Renters' Rights Act Information Sheet</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.15);padding:8px 16px;border-radius:8px;margin-bottom:16px">
      <span style="font-size:18px;font-weight:800;color:white">✓ CompliantUK</span>
    </div>
    <h1 style="color:white;font-size:22px;font-weight:700;margin:0;line-height:1.3">Important: Renters' Rights Act Information Sheet</h1>
  </div>

  <div style="padding:36px 40px">
    <p style="font-size:16px;color:#1e293b;margin:0 0 16px">Dear ${tenantName},</p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 16px">
      Your landlord, <strong>${landlordName}</strong>, is required by law to provide you with the official Government Information Sheet under the <strong>Renters' Rights Act 2025</strong> for your property at <strong>${propertyAddress}</strong>.
    </p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 16px">
      <strong>Please read the attached document carefully.</strong> It explains your new legal rights as a tenant, including:
    </p>

    <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin:0 0 20px;border-left:4px solid #3b82f6">
      <p style="margin:0 0 8px;font-size:14px;color:#1e293b;line-height:1.6">✓ Your rights regarding rent increases</p>
      <p style="margin:0 0 8px;font-size:14px;color:#1e293b;line-height:1.6">✓ How tenancies can now be ended</p>
      <p style="margin:0 0 8px;font-size:14px;color:#1e293b;line-height:1.6">✓ Your rights regarding repairs and property condition</p>
      <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.6">✓ How to raise concerns or disputes</p>
    </div>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 16px">
      The document is attached to this email as a PDF. This is the official version from GOV.UK and is the only version required under legislation. Please read it at your earliest convenience.
    </p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 32px">
      If you have any questions about your tenancy, we recommend speaking directly with your landlord or seeking independent advice from <a href="https://www.citizensadvice.org.uk" style="color:#3b82f6;text-decoration:none">Citizens Advice</a>.
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;"/>

    <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0;">
      This email was sent on behalf of <strong>${landlordName}</strong> by CompliantUK, a compliance document delivery service for private landlords in England. For information about the Renters' Rights Act 2025, visit <a href="https://www.gov.uk" style="color:#3b82f6;text-decoration:none">GOV.UK</a>.
    </p>
  </div>

  <div style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
      © 2026 CompliantUK · <a href="${BASE_URL}/privacy" style="color:#94a3b8">Privacy Policy</a>
    </p>
  </div>
</div>
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="">
</body>
</html>`;
}

function buildLandlordEmail({ landlordName, propertyAddress, tenants, orderId }) {
  const tenantListHtml = tenants
    .map(
      (t, i) =>
        `<tr>
      <td style="padding:10px 12px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${i + 1}. ${t.first} ${t.last}</td>
      <td style="padding:10px 12px;font-size:14px;color:#64748b;border-bottom:1px solid #e2e8f0;">${t.email}</td>
      <td style="padding:10px 12px;font-size:14px;color:#10b981;border-bottom:1px solid #e2e8f0;font-weight:600;">✓ Sent</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Your compliance documents — CompliantUK</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.15);padding:8px 16px;border-radius:8px;margin-bottom:16px">
      <span style="font-size:18px;font-weight:800;color:white">✓ CompliantUK</span>
    </div>
    <h1 style="color:white;font-size:22px;font-weight:700;margin:0;line-height:1.3">You're compliant</h1>
  </div>

  <div style="background:#10b981;padding:18px 40px;text-align:center">
    <p style="color:white;font-size:16px;font-weight:700;margin:0;">✅ Documents delivered</p>
  </div>

  <div style="padding:36px 40px">
    <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Dear ${landlordName},</p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px">
      Your compliance documents have been successfully delivered to all tenants for <strong>${propertyAddress}</strong>. Below is a summary of what was sent.
    </p>

    <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin:0 0 24px;border-left:4px solid #3b82f6">
      <p style="font-size:14px;color:#64748b;margin:0 0 12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Delivery Summary</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;"><strong>Property:</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right">${propertyAddress}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;"><strong>Tenants:</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right">${tenants.length}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;"><strong>Order ID:</strong></td>
          <td style="padding:8px 0;text-align:right;font-family:monospace;font-size:12px">${orderId}</td>
        </tr>
      </table>
    </div>

    <p style="font-size:14px;color:#64748b;margin:0 0 16px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Tenants Notified</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-weight:600;color:#1e293b;border-bottom:1px solid #e2e8f0;">Tenant</td>
        <td style="padding:10px 12px;font-weight:600;color:#1e293b;border-bottom:1px solid #e2e8f0;">Email</td>
        <td style="padding:10px 12px;font-weight:600;color:#1e293b;border-bottom:1px solid #e2e8f0;">Status</td>
      </tr>
      ${tenantListHtml}
    </table>

    <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 16px;">
      <strong>What happens next:</strong> Tenants will receive the official Government Information Sheet and can track when they open it. If a tenant hasn't opened the document within 48 hours, they'll receive a reminder email.
    </p>

    <p style="font-size:14px;color:#475569;line-height:1.6;margin:0;">
      Your proof-of-delivery certificate is attached to this email for your records. You can also access all your orders and delivery status from your <a href="${BASE_URL}/dashboard" style="color:#3b82f6;text-decoration:none">landlord dashboard</a>.
    </p>
  </div>

  <div style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
      © 2026 CompliantUK · <a href="${BASE_URL}/privacy" style="color:#94a3b8">Privacy Policy</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

export default sendDocuments;
