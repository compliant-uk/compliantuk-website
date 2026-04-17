// stripe-webhook.js
// Lean, production-grade webhook
// Flow: Payment → Save order → Email tenants → Email landlord → Done
// Certificates generated on-demand via dashboard

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import getRawBody from 'raw-body';
import { buildTenantEmail, buildLandlordEmail } from './email-builders.js';
import { generateAndStoreCertificate } from './generate-certificate.js';

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
    let tenancyId = null;
    try {
      const { data: tenancy, error } = await supabase.from('tenancies').insert({
        order_id: orderId,
        landlord_id: landlordId,
        property_address: propertyAddress,
        tenant_first: tenant.first,
        tenant_last: tenant.last,
        tenant_email: tenant.email,
        tracking_id: trackingId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).select().single();
      if (error) console.error('Tenancy save error:', error.message);
      else tenancyId = tenancy?.id;
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
  
      });
      console.log(`Tenant email sent: ${tenant.email}`);
    } catch (err) {
      console.error('Tenant email error:', tenant.email, err.message);
    }

    // Generate and store certificate immediately (proof of delivery)
    if (tenancyId && landlordId) {
      try {
        await generateAndStoreCertificate({
          tenancyId,
          propertyAddress,
          tenantFirst: tenant.first,
          tenantLast: tenant.last,
          tenantEmail: tenant.email,
          sentAt: new Date().toISOString(),
          landlordId,
          trackingId,
        });
        console.log(`Certificate stored for ${tenant.email}`);
      } catch (err) {
        console.error('Certificate generation error (non-fatal):', err.message);
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
        const { data: tenancy, error } = await supabase.from('tenancies').insert({
          order_id: orderId,
          landlord_id: landlordId,
          property_address: propertyAddress,
          tenant_first: tenant.first,
          tenant_last: tenant.last,
          tenant_email: tenant.email,
          tracking_id: trackingId,
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).select().single();

        const tenancyId = tenancy?.id;

        const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
        await resend.emails.send({
          from: 'CompliantUK <noreply@compliantuk.co.uk>',
          reply_to: 'support@compliantuk.co.uk',
          to: tenant.email,
          subject: `Important: Renters' Rights Act 2025 — Information Sheet from your landlord`,
          html: buildTenantEmail({ tenantFirst: tenant.first, tenantLast: tenant.last, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }),
          attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
        });

        // Generate and store certificate immediately (proof of delivery)
        if (tenancyId && landlordId) {
          try {
            await generateAndStoreCertificate({
              tenancyId, propertyAddress,
              tenantFirst: tenant.first, tenantLast: tenant.last,
              tenantEmail: tenant.email,
              sentAt: new Date().toISOString(),
              landlordId, trackingId,
            });
          } catch (certErr) {
            console.error('Bulk cert error (non-fatal):', certErr.message);
          }
        }
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

    });
  } catch (err) {
    console.error('Bulk landlord email error:', err.message);
  }

  return res.status(200).json({ received: true, bulk: true });
}

  


