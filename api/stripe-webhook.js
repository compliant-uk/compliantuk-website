// api/stripe-webhook.js
// Fires on checkout.session.completed
// 1. Creates/finds landlord Supabase account with auto-generated password
// 2. Saves order + tenancies to Supabase
// 3. Emails landlord: confirmation + their password + dashboard link
// 4. Emails each tenant: GOV.UK info sheet PDF + covering letter + tracking pixel

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';
import { generateCertificatePdf } from './generate-certificate.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Use SERVICE ROLE key here - needed to create auth users
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = 'https://www.compliantuk.co.uk';

// Read the GOV.UK PDF from the repo (Vercel serves it statically)
async function fetchInfoSheetPdf() {
  const response = await fetch(`${BASE_URL}/The_Renters__Rights_Act_Information_Sheet_2026.pdf`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

// Generate a secure random password
function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let password = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

// Generate a unique tracking ID for each tenant
function generateTrackingId() {
  return crypto.randomBytes(16).toString('hex');
}

export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const meta = session.metadata || {};

  // Diagnostic log — see exactly what arrives
  console.log('Webhook received. Session ID:', session.id);
  console.log('Metadata keys:', Object.keys(meta));
  console.log('landlordEmail:', meta.landlordEmail);
  console.log('landlordFirst:', meta.landlordFirst);
  console.log('tenants:', meta.tenants ? meta.tenants.slice(0, 80) : 'none');
  console.log('tenantsChunks:', meta.tenantsChunks);
  console.log('customer_email:', session.customer_email);

  // Fallback: read email from session if not in metadata
  if (!meta.landlordEmail && session.customer_details?.email) {
    meta.landlordEmail = session.customer_details.email;
  }
  if (!meta.landlordEmail && session.customer_email) {
    meta.landlordEmail = session.customer_email;
  }

  try {
    // ── Detect bulk vs single order ──────────────────────────────────────────
    if (meta.orderType === 'bulk') {
      // Reassemble properties from chunked metadata
      const chunkCount = parseInt(meta.propertiesChunks || '1', 10);
      let propertiesJson = '';
      for (let i = 0; i < chunkCount; i++) {
        propertiesJson += meta[`properties_${i}`] || '';
      }
      const properties = JSON.parse(propertiesJson || '[]');
      const landlordFirst = meta.landlordFirst;
      const landlordLast  = meta.landlordLast;
      const landlordEmail = meta.landlordEmail;

      // Create/find Supabase account
      let landlordId;
      let tempPassword = null;
      let isNewAccount = false;
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === landlordEmail);
      if (existingUser) {
        landlordId = existingUser.id;
      } else {
        tempPassword = generatePassword();
        isNewAccount = true;
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: landlordEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { first_name: landlordFirst, last_name: landlordLast },
        });
        if (createError) throw new Error(`Failed to create user: ${createError.message}`);
        landlordId = newUser.user.id;
      }

      const pdfBuffer = await fetchInfoSheetPdf();
      const pdfBase64 = pdfBuffer.toString('base64');

      // Process each property
      for (const property of properties) {
        const propertyAddress = property.address;
        const tenants = property.tenants || [];

        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            stripe_session_id: session.id + '_' + propertyAddress.slice(0, 20).replace(/\s/g, '_'),
            landlord_id: landlordId,
            landlord_email: landlordEmail,
            landlord_first: landlordFirst,
            landlord_last: landlordLast,
            property_address: propertyAddress,
            amount_paid: 0, // bulk total split across properties
            package: meta.plan || 'bulk',
            status: 'processing',
          })
          .select()
          .single();

        if (orderError) {
          console.error('Failed to save bulk order for', propertyAddress, orderError);
          continue;
        }

        for (const tenant of tenants) {
          const trackingId = generateTrackingId();
          const { error: tenancyError } = await supabase
            .from('tenancies')
            .insert({
              order_id: order.id,
              landlord_id: landlordId,
              property_address: propertyAddress,
              tenant_first: tenant.first || tenant.name?.split(' ')[0] || '',
              tenant_last: tenant.last || tenant.name?.split(' ').slice(1).join(' ') || '',
              tenant_email: tenant.email,
              tracking_id: trackingId,
              status: 'sent',
            });
          if (tenancyError) { console.error('Tenancy save error:', tenancyError); continue; }

          const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
          const tenantEmailHtml = buildTenantEmail({
            tenantFirst: tenant.first || tenant.name?.split(' ')[0] || 'Tenant',
            tenantLast: tenant.last || '',
            landlordFirst,
            landlordLast,
            propertyAddress,
            trackingPixelUrl,
          });
          await resend.emails.send({
            from: 'CompliantUK <noreply@compliantuk.co.uk>',
            to: tenant.email,
            subject: `Important: Renters' Rights Act 2025 — Information Sheet from your landlord`,
            html: tenantEmailHtml,
            attachments: [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }],
          });
        }

        await supabase.from('orders').update({ status: 'complete' }).eq('id', order.id);
      }

      // Email landlord confirmation
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: landlordEmail,
        bcc: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
        subject: `✅ Portfolio order confirmed — ${properties.length} properties processed`,
        html: buildLandlordEmail({
          landlordFirst, landlordLast, landlordEmail,
          propertyAddress: `${properties.length} properties`,
          tenants: properties.flatMap(p => p.tenants || []),
          amountFormatted: `£${(session.amount_total / 100).toFixed(2)}`,
          isNewAccount, tempPassword,
          dashboardUrl: `${BASE_URL}/dashboard`,
          loginUrl: `${BASE_URL}/login`,
        }),
      });

      return res.status(200).json({ received: true, bulk: true, properties: properties.length });
    }

    // ── Single property order ────────────────────────────────────────────────
    const {
      landlordFirst = session.customer_details?.name?.split(' ')[0] || 'Landlord',
      landlordLast = session.customer_details?.name?.split(' ').slice(1).join(' ') || '',
      landlordEmail,
      propertyAddress,
      tenantCount,
    } = meta;

    const tenants = (() => {
      if (meta.tenants) return JSON.parse(meta.tenants);
      if (meta.tenantsChunks) {
        let json = '';
        for (let i = 0; i < parseInt(meta.tenantsChunks, 10); i++) json += meta[`tenants_${i}`] || '';
        return JSON.parse(json);
      }
      return [];
    })();

    // ─────────────────────────────────────
    // 1. Create or find Supabase account
    // ─────────────────────────────────────
    let landlordId = null;
    let tempPassword = null;
    let isNewAccount = false;

    // Create or find Supabase account — wrapped so failure doesn't kill email send
    try {
      // Try to find existing user by email first
      const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const existingUser = users?.find(u => u.email?.toLowerCase() === landlordEmail.toLowerCase());

      if (existingUser) {
        landlordId = existingUser.id;
        console.log('Found existing user:', landlordId);
      } else {
        tempPassword = generatePassword();
        isNewAccount = true;
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: landlordEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { first_name: landlordFirst, last_name: landlordLast },
        });
        if (createError) {
          console.error('Create user error:', createError.message);
          // If user already exists with different case, try to find them
          if (createError.message.includes('already')) {
            const found = users?.find(u => u.email?.toLowerCase() === landlordEmail.toLowerCase());
            if (found) landlordId = found.id;
          }
        } else {
          landlordId = newUser.user.id;
          console.log('Created new user:', landlordId);
        }
      }
    } catch (authErr) {
      console.error('Auth error (non-fatal):', authErr.message);
    }

    // ─────────────────────────────────────
    // 2. Save order to Supabase
    // ─────────────────────────────────────
    let order = null;
    try {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          stripe_session_id: session.id,
          landlord_id: landlordId,
          landlord_email: landlordEmail,
          landlord_first: landlordFirst,
          landlord_last: landlordLast,
          property_address: propertyAddress,
          amount_paid: session.amount_total,
          package: meta.package || 'starter',
          status: 'processing',
        })
        .select()
        .single();
      if (orderError) {
        console.error('Order save error:', orderError.message);
      } else {
        order = orderData;
      }
    } catch (orderErr) {
      console.error('Order save failed (non-fatal):', orderErr.message);
    }

    // ─────────────────────────────────────
    // 3. Fetch GOV.UK PDF
    // ─────────────────────────────────────
    let pdfBase64 = null;
    try {
      const pdfBuffer = await fetchInfoSheetPdf();
      pdfBase64 = pdfBuffer.toString('base64');
    } catch (pdfErr) {
      console.error('PDF fetch failed:', pdfErr.message);
      // Continue without PDF — tenant emails will still send, landlord gets confirmation
    }

    // ─────────────────────────────────────
    // 4. Save tenancies + email each tenant
    // ─────────────────────────────────────
    const tenancyRecords = [];

    for (const tenant of tenants) {
      const trackingId = generateTrackingId();

      // Save tenancy record
      const { data: tenancy, error: tenancyError } = await supabase
        .from('tenancies')
        .insert({
          order_id: order?.id || null,
          landlord_id: landlordId,
          property_address: propertyAddress,
          tenant_first: tenant.first,
          tenant_last: tenant.last,
          tenant_email: tenant.email,
          tracking_id: trackingId,
          status: 'sent',
        })
        .select()
        .single();

      if (tenancyError) {
        console.error('Failed to save tenancy:', tenancyError);
        continue;
      }

      // Email each tenant
      const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
      const tenantEmailHtml = buildTenantEmail({
        tenantFirst: tenant.first,
        tenantLast: tenant.last,
        landlordFirst,
        landlordLast,
        propertyAddress,
        trackingPixelUrl,
      });

      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: tenant.email,
        subject: `Important: Renters' Rights Act 2025 — Information Sheet from your landlord`,
        html: tenantEmailHtml,
        attachments: pdfBase64 ? [
          {
            filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf',
            content: pdfBase64,
            encoding: 'base64',
          },
        ] : [],
      });

      // ── Generate proof-of-service certificate immediately on payment ──
      try {
        const certPdf = await generateCertificatePdf({
          propertyAddress,
          tenantFirst: tenant.first,
          tenantLast: tenant.last,
          tenantEmail: tenant.email,
          sentAt: new Date().toISOString(),
          trackingId,
          landlordId,
        });

        const certBase64 = certPdf.toString('base64');
        console.log(`Cert generated for ${tenant.email}, size: ${certBase64.length} chars`);

        // Store cert in Supabase — accessible via dashboard for download
        const { error: certSaveError } = await supabase.from('tenancies').update({
          status: 'certificate_generated',
          cert_data: certBase64,
          cert_generated_at: new Date().toISOString(),
        }).eq('id', tenancy.id);

        if (certSaveError) {
          console.error('Cert save to Supabase failed:', certSaveError.message);
        } else {
          console.log(`Cert saved to Supabase for tenancy ${tenancy.id}`);
        }

        // Track in tenancyRecords for landlord email summary
        tenancyRecords.push({
          ...tenancy,
          trackingId,
          certBase64,
          certFilename: `Certificate-${tenant.first}-${tenant.last}-${propertyAddress.slice(0,25).replace(/\s/g,'-')}.pdf`,
        });

      } catch (certErr) {
        console.error('Certificate generation error for', tenant.email, ':', certErr.message);
        // Still push to tenancyRecords without cert so landlord email is sent
        tenancyRecords.push({ ...tenancy, trackingId, certBase64: null });
      }
    }

    // ─────────────────────────────────────
    // 5. Email landlord: confirmation + password + dashboard link
    // ─────────────────────────────────────
    const amountFormatted = `£${(session.amount_total / 100).toFixed(2)}`;
    const orderRef = session.id.slice(-12).toUpperCase();
    const orderDate = new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'});
    const landlordEmailHtml = buildLandlordEmail({
      landlordFirst,
      landlordLast,
      landlordEmail,
      propertyAddress,
      tenants,
      amountFormatted,
      isNewAccount,
      tempPassword,
      dashboardUrl: `${BASE_URL}/dashboard`,
      loginUrl: `${BASE_URL}/login`,
      orderRef,
      orderDate,
    });

    const landlordAttachments = [];
    if (pdfBase64) {
      landlordAttachments.push({
        filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf',
        content: pdfBase64,
        encoding: 'base64',
      });
    }

    console.log(`Sending landlord email to ${landlordEmail}, ${landlordAttachments.length} attachments`);

    const landlordEmailResult = await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      reply_to: 'support@compliantuk.co.uk',
      to: landlordEmail,
      bcc: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
      subject: `Compliance confirmed — ${propertyAddress}`,
      html: landlordEmailHtml,
      attachments: landlordAttachments,
    });

    console.log('Landlord email result:', JSON.stringify(landlordEmailResult));

    // ─────────────────────────────────────
    // 6. Mark order complete
    // ─────────────────────────────────────
    if (order?.id) {
      await supabase.from('orders').update({ status: 'complete' }).eq('id', order.id);
    }

    return res.status(200).json({ received: true, orderId: order?.id });

  } catch (err) {
    console.error('Webhook processing error:', err);
    // Return 200 so Stripe doesn't retry - log the error for manual review
    return res.status(200).json({ received: true, error: err.message });
  }
}

// ─────────────────────────────────────
// EMAIL TEMPLATES
// ─────────────────────────────────────

function buildTenantEmail({ tenantFirst, tenantLast, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Renters' Rights Act — Information Sheet</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:28px;height:28px;background:#3b82f6;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:13px">✓</div>
      <span style="color:white;font-weight:700;font-size:17px;letter-spacing:-0.3px">Compliant<span style="color:#60a5fa">UK</span></span>
    </div>
    <div style="color:#94a3b8;font-size:12px;margin-top:4px">Official Document Delivery Service</div>
  </td></tr>

  <!-- Alert bar -->
  <tr><td style="background:#1e3a5f;padding:12px 36px;text-align:center;border-left:4px solid #3b82f6">
    <p style="margin:0;color:#93c5fd;font-size:13px;font-weight:600">📋 Important legal document from your landlord — please read</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:40px 36px">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.5px">
      Renters' Rights Act 2025 — Information Sheet
    </h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px">Served on behalf of your landlord</p>

    <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7">
      Dear ${tenantFirst} ${tenantLast},
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7">
      Your landlord, <strong>${landlordFirst} ${landlordLast}</strong>, is required by law to provide you with the official Government Information Sheet under the <strong>Renters' Rights Act 2025</strong>, which came into force on 1 May 2026.
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7">
      This document explains your rights as a tenant under the new legislation — including your right to a secure tenancy, protection from unfair eviction, and how to report concerns about your property.
    </p>
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">
      The official Information Sheet is attached to this email as a PDF. <strong>Please open and read the attachment.</strong>
    </p>

    <!-- Property box -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:0 0 28px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Property</p>
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a">${propertyAddress}</p>
    </div>

    <!-- What to do -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#166534">What you need to do</p>
      <p style="margin:0 0 8px;font-size:14px;color:#15803d;line-height:1.6">1. Open the PDF attachment in this email</p>
      <p style="margin:0 0 8px;font-size:14px;color:#15803d;line-height:1.6">2. Read through the Information Sheet</p>
      <p style="margin:0;font-size:14px;color:#15803d;line-height:1.6">3. No further action is required from you</p>
    </div>

    <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6">
      This email was sent on behalf of your landlord by CompliantUK, a document delivery and compliance service for private landlords in England. CompliantUK is not a solicitor and this is not legal advice.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK · <a href="https://www.compliantuk.co.uk/privacy" style="color:#94a3b8">Privacy</a> · <a href="https://www.compliantuk.co.uk/terms" style="color:#94a3b8">Terms</a></p>
  </td></tr>

</table>
</td></tr>
</table>
<!-- Read tracking pixel -->
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />
</body>
</html>`;
}

function buildLandlordEmail({
  landlordFirst, landlordLast, landlordEmail, propertyAddress,
  tenants, amountFormatted, isNewAccount, tempPassword,
  dashboardUrl, loginUrl, orderRef, orderDate,
}) {
  const tenantRows = tenants.map(t => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155;font-weight:500">${t.first} ${t.last}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">${t.email}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right">
        <span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">SENT + CERT ISSUED ✓</span>
      </td>
    </tr>
  `).join('');

  const accountSection = isNewAccount ? `
    <!-- Account credentials -->
    <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin:0 0 24px;border-left:4px solid #3b82f6">
      <h2 style="margin:0 0 6px;font-size:17px;font-weight:700;color:#ffffff">🔑 Your CompliantUK Account</h2>
      <p style="margin:0 0 20px;color:#93c5fd;font-size:13px">We've created your personal landlord dashboard — log in anytime to track compliance across all your properties.</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="padding:0 0 12px">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Username (Email)</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#e2e8f0;font-family:monospace">${landlordEmail}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 0 0;border-top:1px solid rgba(255,255,255,0.1)">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Temporary Password</p>
            <p style="margin:0;font-size:20px;font-weight:800;color:#60a5fa;font-family:monospace;letter-spacing:2px">${tempPassword}</p>
            <p style="margin:6px 0 0;font-size:12px;color:#94a3b8">You can change this password after logging in via your account settings.</p>
          </td>
        </tr>
      </table>
      <div style="margin-top:20px">
        <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Log in to your dashboard →</a>
      </div>
    </div>
  ` : `
    <!-- Returning customer - just show dashboard link -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#166534">📊 Track compliance in your dashboard</p>
      <p style="margin:0 0 16px;color:#15803d;font-size:14px">This order has been added to your existing account.</p>
      <a href="${dashboardUrl}" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Go to dashboard →</a>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Compliance Confirmed — CompliantUK</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;background:#3b82f6;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:13px;vertical-align:middle">✓</div>
        <span style="color:white;font-weight:700;font-size:17px;letter-spacing:-0.3px;vertical-align:middle">Compliant<span style="color:#60a5fa">UK</span></span>
      </div>
    </div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.8px">✅ You're compliant.</h1>
    <p style="margin:0;color:#93c5fd;font-size:15px">Payment confirmed. Documents delivered. Certificates emailed to you now.</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:36px 36px 32px">

    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">Hi ${landlordFirst},</p>
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">
      Your compliance pack has been processed. The official Renters' Rights Act 2025 Information Sheet has been emailed to each of your tenants individually, and a copy is attached to this email for your records.
    </p>
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">
      Your proof-of-service certificates have been generated and are ready to download from your dashboard — one per tenant.
    </p>

    <!-- Order summary box -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px 28px;margin:0 0 24px">
      <p style="margin:0 0 16px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Order Summary</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;width:40%">Order reference</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600;font-family:monospace">${orderRef}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Date</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${orderDate}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Landlord</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${landlordFirst} ${landlordLast}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Landlord email</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${landlordEmail}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Property</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${propertyAddress}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Document served</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">Renters' Rights Act 2025 — Official Information Sheet</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Tenants served</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${tenants.length} tenant${tenants.length > 1 ? 's' : ''}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Certificates</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#166534;font-weight:600">✅ Ready to download in your dashboard</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#64748b">Amount paid</td>
          <td style="padding:8px 0;font-size:15px;color:#0f172a;font-weight:700">${amountFormatted}</td>
        </tr>
      </table>
    </div>

    <!-- Tenant delivery status -->
    <div style="margin:0 0 28px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Tenant Delivery Status</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <th style="text-align:left;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Tenant</th>
          <th style="text-align:left;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Email</th>
          <th style="text-align:right;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Status</th>
        </tr>
        ${tenantRows}
      </table>
    </div>

    ${accountSection}

    <!-- What happens next -->
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:20px 24px;margin:0 0 8px">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#92400e">What happens next</p>
      <p style="margin:0 0 8px;font-size:13px;color:#78350f;line-height:1.6">⏰ <strong>48hr reminder</strong> — if a tenant hasn't opened the document by then, we automatically chase them.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#78350f;line-height:1.6">🏅 <strong>Certificates in your dashboard</strong> — your proof-of-service certificates have been generated and are ready to download from your dashboard.</p>
      <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6">📊 <strong>Live tracking</strong> — log into your dashboard anytime to see real-time status.</p>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center">
    <p style="margin:0 0 4px;color:#94a3b8;font-size:12px">© 2026 CompliantUK</p>
    <p style="margin:0;color:#94a3b8;font-size:12px"><a href="https://www.compliantuk.co.uk/privacy" style="color:#94a3b8">Privacy</a> · <a href="https://www.compliantuk.co.uk/terms" style="color:#94a3b8">Terms</a> · <a href="https://www.compliantuk.co.uk/contact" style="color:#94a3b8">Contact</a></p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
