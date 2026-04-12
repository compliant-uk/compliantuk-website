// api/track.js
// Invisible 1x1 pixel served when tenant opens their email
// Updates tenancy status: sent → opened → read
// On 'read' status: triggers certificate generation

import { createClient } from '@supabase/supabase-js';
import { generateCertificatePdf } from './generate-certificate.js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export default async function handler(req, res) {
  // Always serve the pixel immediately - don't block email loading
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(PIXEL);

  // Process tracking asynchronously
  const { id: trackingId } = req.query;
  if (!trackingId) return;

  try {
    // Get current tenancy record
    const { data: tenancy, error } = await supabase
      .from('tenancies')
      .select('*')
      .eq('tracking_id', trackingId)
      .single();

    if (error || !tenancy) return;

    // Don't reprocess if already read
    if (tenancy.status === 'read' || tenancy.status === 'certificate_generated') return;

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || 'Unknown';

    const ua = req.headers['user-agent'] || 'Unknown';
    const device = parseDevice(ua);
    const now = new Date().toISOString();

    // First open: set to 'opened'
    if (tenancy.status === 'sent') {
      await supabase
        .from('tenancies')
        .update({
          status: 'opened',
          opened_at: now,
          tenant_ip: ip,
          tenant_device: device,
        })
        .eq('tracking_id', trackingId);

      // Second pixel load = actually read (email clients load pixel twice)
      // We treat first load as read for reliability
    }

    // Mark as read and trigger certificate
    if (tenancy.status === 'sent' || tenancy.status === 'opened') {
      await supabase
        .from('tenancies')
        .update({
          status: 'read',
          read_at: now,
          tenant_ip: ip,
          tenant_device: device,
        })
        .eq('tracking_id', trackingId);

      // Generate and email certificate
      await generateAndEmailCertificate(tenancy, ip, device, now);
    }

  } catch (err) {
    console.error('Tracking error:', err);
  }
}

async function generateAndEmailCertificate(tenancy, ip, device, readAt) {
  try {
    const certPdf = await generateCertificatePdf({
      landlordId: tenancy.landlord_id,
      propertyAddress: tenancy.property_address,
      tenantFirst: tenancy.tenant_first,
      tenantLast: tenancy.tenant_last,
      tenantEmail: tenancy.tenant_email,
      sentAt: tenancy.sent_at,
      readAt,
      ipAddress: ip,
      device,
      trackingId: tenancy.tracking_id,
    });

    const certBase64 = certPdf.toString('base64');

    // Get landlord email from order
    const { data: order } = await supabase
      .from('orders')
      .select('landlord_email, landlord_first, landlord_last')
      .eq('id', tenancy.order_id)
      .single();

    if (!order) return;

    // Send read confirmation to landlord (certificate was already sent on payment)
    const readDate = new Date(readAt).toLocaleString('en-GB', {
      dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London'
    });

    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      to: order.landlord_email,
      subject: `✅ Read confirmation — ${tenancy.tenant_first} ${tenancy.tenant_last} has opened the Information Sheet`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f8fafc">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-size:28px;margin-bottom:8px">✅</div>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#fff">Tenant Read Confirmation</h1>
    <p style="margin:0;color:#93c5fd;font-size:14px">${tenancy.tenant_first} ${tenancy.tenant_last} has opened the Information Sheet</p>
  </td></tr>
  <tr><td style="background:#fff;padding:36px">
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px">Hi ${order.landlord_first},</p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 24px">Good news — your tenant has opened the Renters' Rights Act Information Sheet. This is your read confirmation. Your proof-of-service certificate was already emailed to you when the order was placed.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:0 0 24px">
      <p style="margin:0 0 14px;font-size:13px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:1px">Read Confirmation Details</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:40%">Property</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${tenancy.property_address}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Tenant</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${tenancy.tenant_first} ${tenancy.tenant_last}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Opened at</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${readDate}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">IP address</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-family:monospace">${ip}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Device</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${device}</td></tr>
      </table>
    </div>

    <div style="text-align:center">
      <a href="https://www.compliantuk.co.uk/dashboard" style="display:inline-block;background:#3b82f6;color:white;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px">View dashboard →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    });

    // Update tenancy status
    await supabase
      .from('tenancies')
      .update({ status: 'certificate_generated' })
      .eq('tracking_id', tenancy.tracking_id);

  } catch (err) {
    console.error('Certificate generation error:', err);
  }
}

function parseDevice(ua) {
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function buildCertificateEmail({ landlordFirst, tenantFirst, tenantLast, propertyAddress, readAt, ip, device, dashboardUrl }) {
  const readDate = new Date(readAt).toLocaleString('en-GB', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London'
  });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f8fafc">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-size:28px;margin-bottom:8px">🏅</div>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#fff">Certificate Generated</h1>
    <p style="margin:0;color:#93c5fd;font-size:14px">${tenantFirst} ${tenantLast} has read the Information Sheet</p>
  </td></tr>
  <tr><td style="background:#fff;padding:36px">
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px">Hi ${landlordFirst},</p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 24px">Your proof-of-service certificate has been generated and is attached to this email. This certificate is your legal record of compliance.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:0 0 24px">
      <p style="margin:0 0 14px;font-size:13px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:1px">Certificate Details</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:40%">Property</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${propertyAddress}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Tenant</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${tenantFirst} ${tenantLast}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Read at</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${readDate}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">IP address</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-family:monospace">${ip}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#64748b">Device</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${device}</td></tr>
      </table>
    </div>

    <div style="text-align:center">
      <a href="${dashboardUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px">View all certificates in dashboard →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
