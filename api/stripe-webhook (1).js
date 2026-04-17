import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import getRawBody from 'raw-body';
import { buildTenantEmail, buildLandlordEmail } from './email-builders.js';
import { generateAndStoreCertificate } from './generate-certificate.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = 'https://www.compliantuk.co.uk';

function genPassword() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:12},()=>c[Math.floor(Math.random()*c.length)]).join('');
}

function genTrackingId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function fetchPdf() {
  const r = await fetch(`${BASE_URL}/The_Renters__Rights_Act_Information_Sheet_2026.pdf`);
  if (!r.ok) throw new Error(`PDF fetch failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseTenants(meta) {
  if (meta.tenants) return JSON.parse(meta.tenants);
  if (meta.tenantsChunks) {
    let j = '';
    for (let i = 0; i < parseInt(meta.tenantsChunks,10); i++) j += meta[`tenants_${i}`]||'';
    return JSON.parse(j);
  }
  return [];
}

async function getOrCreateLandlord(email, first, last) {
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return { landlordId: existing.id, tempPassword: null, isNew: false };
  const pw = genPassword();
  const { data: u, error } = await sb.auth.admin.createUser({
    email, password: pw, email_confirm: true,
    user_metadata: { first_name: first, last_name: last },
  });
  if (error) throw error;
  return { landlordId: u.user.id, tempPassword: pw, isNew: true };
}

async function processTenant({ tenant, orderId, landlordId, propertyAddress, landlordFirst, landlordLast, pdfBase64 }) {
  const trackingId = genTrackingId();
  const sentAt = new Date().toISOString();

  const { data: t } = await sb.from('tenancies').insert({
    order_id: orderId, landlord_id: landlordId,
    property_address: propertyAddress,
    tenant_first: tenant.first, tenant_last: tenant.last, tenant_email: tenant.email,
    tracking_id: trackingId, status: 'sent', sent_at: sentAt,
  }).select().single();

  const trackingPixelUrl = `${BASE_URL}/api/track?id=${trackingId}`;
  await resend.emails.send({
    from: 'CompliantUK <noreply@compliantuk.co.uk>',
    reply_to: 'support@compliantuk.co.uk',
    to: tenant.email,
    subject: "Important: Renters' Rights Act 2025 — Information Sheet from your landlord",
    html: buildTenantEmail({ tenantFirst: tenant.first, tenantLast: tenant.last, landlordFirst, landlordLast, propertyAddress, trackingPixelUrl }),
    attachments: pdfBase64 ? [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: pdfBase64, encoding: 'base64' }] : [],
  });

  if (t?.id) {
    await generateAndStoreCertificate({
      tenancyId: t.id, propertyAddress,
      tenantFirst: tenant.first, tenantLast: tenant.last,
      tenantEmail: tenant.email, sentAt, landlordId, trackingId,
    }).catch(e => console.error('Cert error:', e.message));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type !== 'checkout.session.completed') return res.status(200).json({ received: true });

  const session = event.data.object;
  const meta = session.metadata || {};

  // ── BULK ORDER ──
  if (meta.orderType === 'bulk' && meta.bulkOrderId) {
    try {
      const { data: bulk } = await sb.from('bulk_orders').select('*').eq('id', meta.bulkOrderId).single();
      if (!bulk) throw new Error('Bulk order not found');

      await sb.from('bulk_orders').update({ status: 'paid', stripe_session_id: session.id, paid_at: new Date().toISOString() }).eq('id', bulk.id);

      const { landlordId, tempPassword, isNew } = await getOrCreateLandlord(bulk.landlord_email, bulk.landlord_first, bulk.landlord_last);
      const properties = JSON.parse(bulk.properties_data);
      const pdfBuf = await fetchPdf().catch(() => null);
      const pdfBase64 = pdfBuf ? pdfBuf.toString('base64') : null;

      for (const prop of properties) {
        const { data: order } = await sb.from('orders').insert({
          stripe_session_id: session.id, landlord_id: landlordId,
          landlord_email: bulk.landlord_email, landlord_first: bulk.landlord_first, landlord_last: bulk.landlord_last,
          property_address: prop.address, amount_paid: 0, package: bulk.plan, status: 'processing',
        }).select().single();

        for (const t of (prop.tenants||[])) {
          await processTenant({ tenant: t, orderId: order?.id, landlordId, propertyAddress: prop.address, landlordFirst: bulk.landlord_first, landlordLast: bulk.landlord_last, pdfBase64 }).catch(e => console.error('Tenant error:', e.message));
        }
        if (order?.id) await sb.from('orders').update({ status: 'complete' }).eq('id', order.id);
      }

      await sb.from('bulk_orders').update({ status: 'processed' }).eq('id', bulk.id);

      const amountFormatted = `£${(session.amount_total/100).toFixed(2)}`;
      const orderRef = session.id.slice(-12).toUpperCase();
      const orderDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>', reply_to: 'support@compliantuk.co.uk',
        to: bulk.landlord_email, bcc: process.env.ADMIN_BCC_EMAIL||'support@compliantuk.co.uk',
        subject: `Portfolio compliance confirmed — ${properties.length} properties`,
        html: buildLandlordEmail({ landlordFirst: bulk.landlord_first, landlordLast: bulk.landlord_last, landlordEmail: bulk.landlord_email, propertyAddress: `${properties.length} properties (Portfolio)`, tenants: [], amountFormatted, isNewAccount: isNew, tempPassword, orderRef, orderDate, dashboardUrl: `${BASE_URL}/dashboard`, loginUrl: `${BASE_URL}/login` }),
      }).catch(e => console.error('Bulk landlord email error:', e.message));

    } catch (e) {
      console.error('Bulk processing error:', e.message);
    }
    return res.status(200).json({ received: true, bulk: true });
  }

  // ── SINGLE ORDER ──
  const landlordEmail = meta.landlordEmail || session.customer_details?.email || session.customer_email;
  const landlordFirst = meta.landlordFirst || 'Landlord';
  const landlordLast = meta.landlordLast || '';
  const propertyAddress = meta.propertyAddress || 'Your property';

  if (!landlordEmail) return res.status(200).json({ received: true, error: 'No landlord email' });

  let tenants = [];
  try { tenants = parseTenants(meta); } catch(e) { console.error('Parse error:', e.message); }
  if (!tenants.length) return res.status(200).json({ received: true, error: 'No tenants' });

  try {
    const { landlordId, tempPassword, isNew } = await getOrCreateLandlord(landlordEmail, landlordFirst, landlordLast);

    const { data: order } = await sb.from('orders').insert({
      stripe_session_id: session.id, landlord_id: landlordId,
      landlord_email: landlordEmail, landlord_first: landlordFirst, landlord_last: landlordLast,
      property_address: propertyAddress, amount_paid: session.amount_total,
      package: meta.package||'starter', status: 'processing',
    }).select().single();

    const pdfBuf = await fetchPdf().catch(() => null);
    const pdfBase64 = pdfBuf ? pdfBuf.toString('base64') : null;

    for (const t of tenants) {
      await processTenant({ tenant: t, orderId: order?.id, landlordId, propertyAddress, landlordFirst, landlordLast, pdfBase64 }).catch(e => console.error('Tenant error:', e.message));
    }

    if (order?.id) await sb.from('orders').update({ status: 'complete' }).eq('id', order.id);

    const amountFormatted = `£${(session.amount_total/100).toFixed(2)}`;
    const orderRef = session.id.slice(-12).toUpperCase();
    const orderDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>', reply_to: 'support@compliantuk.co.uk',
      to: landlordEmail, bcc: process.env.ADMIN_BCC_EMAIL||'support@compliantuk.co.uk',
      subject: `Compliance confirmed — ${propertyAddress}`,
      html: buildLandlordEmail({ landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants, amountFormatted, isNewAccount: isNew, tempPassword, orderRef, orderDate, dashboardUrl: `${BASE_URL}/dashboard`, loginUrl: `${BASE_URL}/login` }),
    }).catch(e => console.error('Landlord email error:', e.message));

  } catch (e) {
    console.error('Single order error:', e.message);
  }

  return res.status(200).json({ received: true });
}
