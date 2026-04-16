// stripe-webhook.js
// Lean, production-grade webhook
// Flow: Payment → Save order → Email tenants → Email landlord → Done
// Certificates generated on-demand via dashboard

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import getRawBody from 'raw-body';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const BASE_URL = 'https://www.compliantuk.co.uk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length: 12}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateTrackingId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function fetchInfoSheetPdf() {
  const res = await fetch(`${BASE_URL}/The_Renters__Rights_Act_Information_Sheet_2026.pdf`);
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseTenants(meta) {
  if (meta.tenants) return JSON.parse(meta.tenants);
  if (meta.tenantsChunks) {
    let json = '';
    for (let i = 0; i < parseInt(meta.tenantsChunks, 10); i++) json += meta[`tenants_${i}`] || '';
    return JSON.parse(json);
  }
  return [];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verify Stripe signature
  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const meta = session.metadata || {};

  // ── 0. Handle Bulk Orders (from Supabase) ──────────────────────────────────
  let tenants = [];
  let landlordEmail = meta.landlordEmail || session.customer_details?.email || session.customer_email;
  let landlordFirst = meta.landlordFirst || 'Landlord';
  let landlordLast = meta.landlordLast || '';
  let propertyAddress = meta.propertyAddress || 'Your property';
  let isBulk = meta.orderType === 'bulk';
  let bulkOrderId = meta.bulkOrderId;

  if (isBulk && bulkOrderId) {
    console.log(`Fetching bulk order data for ID: ${bulkOrderId}`);
    try {
      const { data: bulkOrder, error: bulkError } = await supabase
        .from('bulk_orders')
        .select('*')
        .eq('id', bulkOrderId)
        .single();

      if (bulkError || !bulkOrder) {
        console.error('Failed to fetch bulk order:', bulkError?.message);
      } else {
        // Override with bulk order data
        landlordEmail = bulkOrder.landlord_email;
        landlordFirst = bulkOrder.landlord_first;
        landlordLast = bulkOrder.landlord_last;
        // For bulk, we'll process properties one by one in a loop later or handle differently
        // If it's a bulk order, properties_data contains the array of property/tenant objects
        const properties = JSON.parse(bulkOrder.properties_data);
        
        // Update bulk order status
        await supabase.from('bulk_orders').update({ 
          status: 'paid', 
          stripe_session_id: session.id,
          paid_at: new Date().toISOString() 
        }).eq('id', bulkOrderId);

        // We'll need a different processing loop for bulk orders
        return await handleBulkOrderProcessing({ session, bulkOrder, properties, res });
      }
    } catch (err) {
      console.error('Bulk order processing error:', err.message);
    }
  }

  // Fallback to standard single-property processing
  if (!landlordEmail) {
    console.error('No landlord email found in session', session.id);
    return res.status(200).json({ received: true, error: 'No landlord email' });
  }

  // Parse tenants for standard order
  try { tenants = parseTenants(meta); } catch(e) { console.error('Tenant parse error:', e.message); }
  if (!tenants.length) {
    console.error('No tenants found for session', session.id);
    return res.status(200).json({ received: true, error: 'No tenants' });
  }

  console.log(`Processing order: ${session.id} | ${landlordEmail} | ${tenants.length} tenant(s) | ${propertyAddress}`);

  // ── 1. Create/find landlord account ───────────────────────────────────────
  let landlordId = null;
  let tempPassword = null;
  let isNewAccount = false;

  try {
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = users?.find(u => u.email?.toLowerCase() === landlordEmail.toLowerCase());

    if (existing) {
      landlordId = existing.id;
    } else {
      tempPassword = generatePassword();
      isNewAccount = true;
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: landlordEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { first_name: landlordFirst, last_name: landlordLast },
      });
      if (error) console.error('Create user error:', error.message);
      else landlordId = newUser.user.id;
    }
  } catch (err) {
    console.error('Auth error:', err.message);
  }

  // ── 2. Save order ─────────────────────────────────────────────────────────
  let orderId = null;
  try {
    const { data: order, error } = await supabase.from('orders').insert({
      stripe_session_id: session.id,
      landlord_id: landlordId,
      landlord_email: landlordEmail,
      landlord_first: landlordFirst,
      landlord_last: landlordLast,
      property_address: propertyAddress,
      amount_paid: session.amount_total,
      package: meta.package || 'starter',
      status: 'processing',
    }).select().single();
    if (error) console.error('Order save error:', error.message);
    else orderId = order.id;
  } catch (err) {
    console.error('Order error:', err.message);
  }

  // ── 3. Fetch GOV.UK PDF ───────────────────────────────────────────────────
  let pdfBase64 = null;
  try {
    const buf = await fetchInfoSheetPdf();
    pdfBase64 = buf.toString('base64');
  } catch (err) {
    console.error('PDF fetch error:', err.message);
  }

  // ── 4. Save tenancies + email each tenant ─────────────────────────────────
  for (const tenant of tenants) {
    const trackingId = generateTrackingId();

    // Save tenancy record
    try {
      await supabase.from('tenancies').insert({
        order_id: orderId,
        landlord_id: landlordId,
        property_address: propertyAddress,
        tenant_first: tenant.first,
        tenant_last: tenant.last,
        tenant_email: tenant.email,
        tracking_id: trackingId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Tenancy save error:', err.message);
    }

    // Email tenant
    try {
      const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        reply_to: 'support@compliantuk.co.uk',
        to: tenant.email,
        subject: `Important: Renters' Rights Act 2025 — Information Sheet from your landlord`,
        html: buildTenantEmail({ tenantFirst: tenant.first, tenantLast: tenant.last, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }),
        attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
      });
      console.log(`Tenant email sent: ${tenant.email}`);
    } catch (err) {
      console.error('Tenant email error:', tenant.email, err.message);
    }
  }

  // ── 5. Email landlord confirmation ────────────────────────────────────────
  try {
    const amountFormatted = `£${(session.amount_total / 100).toFixed(2)}`;
    const orderRef = session.id.slice(-12).toUpperCase();
    const orderDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      reply_to: 'support@compliantuk.co.uk',
      to: landlordEmail,
      bcc: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
      subject: `Compliance confirmed — ${propertyAddress}`,
      html: buildLandlordEmail({ landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants, amountFormatted, isNewAccount, tempPassword, orderRef, orderDate, dashboardUrl: `${BASE_URL}/dashboard`, loginUrl: `${BASE_URL}/login` }),
      attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
    });
    console.log(`Landlord email sent: ${landlordEmail}`);
  } catch (err) {
    console.error('Landlord email error:', err.message);
  }

  // ── 6. Mark order complete ────────────────────────────────────────────────
  if (orderId) {
    try {
      await supabase.from('orders').update({ status: 'complete' }).eq('id', orderId);
    } catch (err) {
      console.error('Order complete error:', err.message);
    }
  }

  console.log(`Order complete: ${session.id}`);
  return res.status(200).json({ received: true });
}

// ─── Bulk Order Processor ─────────────────────────────────────────────────────

async function handleBulkOrderProcessing({ session, bulkOrder, properties, res }) {
  console.log(`Processing bulk order: ${bulkOrder.id} | ${properties.length} properties`);
  
  // 1. Create/Find Landlord Account
  let landlordId = null;
  let tempPassword = null;
  let isNewAccount = false;
  const { landlord_email: landlordEmail, landlord_first: landlordFirst, landlord_last: landlordLast } = bulkOrder;

  try {
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = users?.find(u => u.email?.toLowerCase() === landlordEmail.toLowerCase());

    if (existing) {
      landlordId = existing.id;
    } else {
      tempPassword = generatePassword();
      isNewAccount = true;
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: landlordEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { first_name: landlordFirst, last_name: landlordLast },
      });
      if (error) console.error('Create user error:', error.message);
      else landlordId = newUser.user.id;
    }
  } catch (err) {
    console.error('Auth error:', err.message);
  }

  // 2. Fetch PDF
  let pdfBase64 = null;
  try {
    const buf = await fetchInfoSheetPdf();
    pdfBase64 = buf.toString('base64');
  } catch (err) {
    console.error('PDF fetch error:', err.message);
  }

  // 3. Process each property/tenancy
  for (const prop of properties) {
    const propertyAddress = prop.address;
    const tenants = prop.tenants || [];

    // Create a parent order for each property for dashboard visibility
    let orderId = null;
    try {
      const { data: order, error } = await supabase.from('orders').insert({
        stripe_session_id: session.id,
        landlord_id: landlordId,
        landlord_email: landlordEmail,
        landlord_first: landlordFirst,
        landlord_last: landlordLast,
        property_address: propertyAddress,
        amount_paid: 0, // already paid in bulk
        package: bulkOrder.plan,
        status: 'processing',
      }).select().single();
      if (error) console.error('Bulk child order save error:', error.message);
      else orderId = order.id;
    } catch (err) {
      console.error('Order error:', err.message);
    }

    for (const tenant of tenants) {
      const trackingId = generateTrackingId();
      try {
        await supabase.from('tenancies').insert({
          order_id: orderId,
          landlord_id: landlordId,
          property_address: propertyAddress,
          tenant_first: tenant.first,
          tenant_last: tenant.last,
          tenant_email: tenant.email,
          tracking_id: trackingId,
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

        const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
        await resend.emails.send({
          from: 'CompliantUK <noreply@compliantuk.co.uk>',
          reply_to: 'support@compliantuk.co.uk',
          to: tenant.email,
          subject: `Important: Renters' Rights Act 2025 — Information Sheet from your landlord`,
          html: buildTenantEmail({ tenantFirst: tenant.first, tenantLast: tenant.last, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }),
          attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
        });
      } catch (err) {
        console.error('Bulk tenant processing error:', tenant.email, err.message);
      }
    }

    if (orderId) {
      await supabase.from('orders').update({ status: 'complete' }).eq('id', orderId);
    }
  }

  // 4. Update Bulk Order status
  await supabase.from('bulk_orders').update({ status: 'processed' }).eq('id', bulkOrder.id);

  // 5. Landlord Confirmation
  try {
    const amountFormatted = `£${(session.amount_total / 100).toFixed(2)}`;
    const orderRef = session.id.slice(-12).toUpperCase();
    const orderDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      reply_to: 'support@compliantuk.co.uk',
      to: landlordEmail,
      bcc: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
      subject: `Portfolio compliance confirmed — ${properties.length} properties`,
      html: buildLandlordEmail({ 
        landlordFirst, 
        landlordLast, 
        landlordEmail, 
        propertyAddress: `${properties.length} properties (Portfolio)`, 
        tenants: [], // Simplified for bulk
        amountFormatted, 
        isNewAccount, 
        tempPassword, 
        orderRef, 
        orderDate, 
        dashboardUrl: `${BASE_URL}/dashboard`, 
        loginUrl: `${BASE_URL}/login` 
      }),
      attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
    });
  } catch (err) {
    console.error('Bulk landlord email error:', err.message);
  }

  return res.status(200).json({ received: true, bulk: true });
}

// ─── Email builders ───────────────────────────────────────────────────────────

function buildTenantEmail({ tenantFirst, tenantLast, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Renters' Rights Act 2025 — Information Sheet</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-weight:700;font-size:17px;color:white">Compliant<span style="color:#60a5fa">UK</span></div>
    <h1 style="margin:12px 0 0;font-size:22px;font-weight:800;color:#fff;line-height:1.3">Important: Information Sheet from your landlord</h1>
  </td></tr>
  <tr><td style="background:#fff;padding:36px">
    <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.7">Dear ${tenantFirst} ${tenantLast},</p>
    <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.7">Your landlord, ${landlordFirst} ${landlordLast}, is required by law to provide you with the official Renters' Rights Act 2025 Information Sheet. This document explains your rights as a tenant under the new legislation.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Property</p>
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a">${propertyAddress}</p>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#166534">What you need to do</p>
      <p style="margin:0 0 8px;font-size:14px;color:#15803d;line-height:1.6">1. Open the PDF attachment in this email</p>
      <p style="margin:0 0 8px;font-size:14px;color:#15803d;line-height:1.6">2. Read through the Information Sheet</p>
      <p style="margin:0;font-size:14px;color:#15803d;line-height:1.6">3. No further action is required from you</p>
    </div>
    <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6">This email was sent on behalf of your landlord by CompliantUK, a document delivery and compliance service for private landlords in England. CompliantUK is not a solicitor and this is not legal advice.</p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK · <a href="${BASE_URL}/privacy" style="color:#94a3b8">Privacy</a> · <a href="${BASE_URL}/terms" style="color:#94a3b8">Terms</a></p>
  </td></tr>
</table></td></tr></table>
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="">
</body></html>`;
}

function buildLandlordEmail({ landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants, amountFormatted, isNewAccount, tempPassword, orderRef, orderDate, dashboardUrl, loginUrl }) {
  const tenantRows = tenants.map(t => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155;font-weight:500">${t.first} ${t.last}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">${t.email}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right"><span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">SENT ✓</span></td>
    </tr>`).join('');

  const accountSection = isNewAccount ? `
    <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin:0 0 24px;border-left:4px solid #3b82f6">
      <h2 style="margin:0 0 6px;font-size:17px;font-weight:700;color:#fff">🔑 Your CompliantUK Account</h2>
      <p style="margin:0 0 20px;color:#93c5fd;font-size:13px">Log in anytime to track compliance, generate certificates and manage your properties.</p>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Email</p>
      <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#e2e8f0;font-family:monospace">${landlordEmail}</p>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Temporary Password</p>
      <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#60a5fa;font-family:monospace;letter-spacing:2px">${tempPassword}</p>
      <p style="margin:0 0 20px;font-size:12px;color:#94a3b8">Change this after logging in via account settings.</p>
      <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Log in to dashboard →</a>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#166534">📊 View in your dashboard</p>
      <p style="margin:0 0 16px;color:#15803d;font-size:14px">This order has been added to your existing account.</p>
      <a href="${dashboardUrl}" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Go to dashboard →</a>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compliance Confirmed — CompliantUK</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-weight:700;font-size:17px;color:white;margin-bottom:16px">Compliant<span style="color:#60a5fa">UK</span></div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.8px">✅ You're compliant.</h1>
    <p style="margin:0;color:#93c5fd;font-size:15px">Payment confirmed. Documents delivered to your tenants.</p>
  </td></tr>
  <tr><td style="background:#fff;padding:36px">
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">Hi ${landlordFirst},</p>
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">The official Renters' Rights Act 2025 Information Sheet has been emailed to each of your tenants. A copy is attached to this email for your records.</p>
    <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">Log into your dashboard to track delivery status and generate your proof-of-service certificates.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px 28px;margin:0 0 24px">
      <p style="margin:0 0 16px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Order Summary</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;width:40%">Reference</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600;font-family:monospace">${orderRef}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Date</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${orderDate}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Landlord</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${landlordFirst} ${landlordLast}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Property</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${propertyAddress}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Document</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">Renters' Rights Act 2025 — Information Sheet</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Tenants</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${tenants.length} tenant${tenants.length > 1 ? 's' : ''}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Certificates</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">Available in dashboard on request</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#64748b">Amount paid</td><td style="padding:8px 0;font-size:15px;color:#0f172a;font-weight:700">${amountFormatted}</td></tr>
      </table>
    </div>

    <div style="margin:0 0 28px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Tenant Delivery Status</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <th style="text-align:left;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase">Tenant</th>
          <th style="text-align:left;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase">Email</th>
          <th style="text-align:right;font-size:11px;font-weight:700;color:#94a3b8;padding:0 0 8px;text-transform:uppercase">Status</th>
        </tr>
        ${tenantRows}
      </table>
    </div>

    ${accountSection}

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:20px 24px">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#92400e">What happens next</p>
      <p style="margin:0 0 8px;font-size:13px;color:#78350f;line-height:1.6">⏰ <strong>48hr reminder</strong> — if a tenant hasn't opened the document, we automatically send a reminder.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#78350f;line-height:1.6">🏅 <strong>Certificates on request</strong> — log into your dashboard to generate and download your proof-of-service certificate anytime.</p>
      <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6">📊 <strong>Live tracking</strong> — see real-time delivery status for every tenant.</p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center">
    <p style="margin:0 0 4px;color:#94a3b8;font-size:12px">© 2026 CompliantUK</p>
    <p style="margin:0;color:#94a3b8;font-size:12px"><a href="${BASE_URL}/privacy" style="color:#94a3b8">Privacy</a> · <a href="${BASE_URL}/terms" style="color:#94a3b8">Terms</a> · <a href="${BASE_URL}/contact" style="color:#94a3b8">Contact</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}
