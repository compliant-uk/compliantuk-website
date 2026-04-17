import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import getRawBody from 'raw-body';
import { generateAndStoreCertificate } from './generate-certificate.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const BASE = 'https://www.compliantuk.co.uk';

function genPw() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:12},()=>c[Math.floor(Math.random()*c.length)]).join('');
}
function genId() { return Math.random().toString(36).slice(2)+Date.now().toString(36); }
async function fetchPdf() {
  const r = await fetch(`${BASE}/The_Renters__Rights_Act_Information_Sheet_2026.pdf`);
  if (!r.ok) throw new Error(`PDF ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function parseTenants(m) {
  if (m.tenants) return JSON.parse(m.tenants);
  if (m.tenantsChunks) { let j=''; for(let i=0;i<parseInt(m.tenantsChunks,10);i++) j+=m[`tenants_${i}`]||''; return JSON.parse(j); }
  return [];
}
async function getOrCreate(email,first,last) {
  const {data:{users}} = await sb.auth.admin.listUsers({perPage:1000});
  const ex = users?.find(u=>u.email?.toLowerCase()===email.toLowerCase());
  if (ex) return {id:ex.id,pw:null,isNew:false};
  const pw = genPw();
  const {data:u,error} = await sb.auth.admin.createUser({email,password:pw,email_confirm:true,user_metadata:{first_name:first,last_name:last}});
  if (error) throw error;
  return {id:u.user.id,pw,isNew:true};
}
async function doTenant(t,orderId,landlordId,addr,lFirst,lLast,pdf64) {
  const tid = genId();
  const now = new Date().toISOString();
  const {data:row} = await sb.from('tenancies').insert({
    order_id:orderId,landlord_id:landlordId,property_address:addr,
    tenant_first:t.first,tenant_last:t.last,tenant_email:t.email,
    tracking_id:tid,status:'sent',sent_at:now
  }).select().single();
  const pixel = `${BASE}/api/track?id=${tid}`;
  await resend.emails.send({
    from:'CompliantUK <noreply@compliantuk.co.uk>',reply_to:'support@compliantuk.co.uk',
    to:t.email,subject:"Important: Renters' Rights Act 2025 — Information Sheet from your landlord",
    html:tenantHtml(t.first,t.last,lFirst,lLast,addr,pixel),
    attachments:pdf64?[{filename:'Renters-Rights-Act-Information-Sheet-2026.pdf',content:pdf64,encoding:'base64'}]:[],
  });
  if (row?.id) generateAndStoreCertificate({tenancyId:row.id,propertyAddress:addr,tenantFirst:t.first,tenantLast:t.last,tenantEmail:t.email,sentAt:now,landlordId,trackingId:tid}).catch(e=>console.error('cert:',e.message));
}

export default async function handler(req,res) {
  if (req.method!=='POST') return res.status(405).end();
  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
  if (event.type!=='checkout.session.completed') return res.status(200).json({received:true});

  const session = event.data.object;
  const meta = session.metadata||{};

  if (meta.orderType==='bulk' && meta.bulkOrderId) {
    try {
      const {data:bulk} = await sb.from('bulk_orders').select('*').eq('id',meta.bulkOrderId).single();
      if (!bulk) throw new Error('Bulk not found');
      await sb.from('bulk_orders').update({status:'paid',stripe_session_id:session.id,paid_at:new Date().toISOString()}).eq('id',bulk.id);
      const {id:landlordId,pw,isNew} = await getOrCreate(bulk.landlord_email,bulk.landlord_first,bulk.landlord_last);
      const props = JSON.parse(bulk.properties_data);
      const pdf64 = await fetchPdf().then(b=>b.toString('base64')).catch(()=>null);
      for (const prop of props) {
        const {data:order} = await sb.from('orders').insert({stripe_session_id:session.id,landlord_id:landlordId,landlord_email:bulk.landlord_email,landlord_first:bulk.landlord_first,landlord_last:bulk.landlord_last,property_address:prop.address,amount_paid:0,package:bulk.plan,status:'processing'}).select().single();
        for (const t of (prop.tenants||[])) await doTenant(t,order?.id,landlordId,prop.address,bulk.landlord_first,bulk.landlord_last,pdf64).catch(e=>console.error('tenant:',e.message));
        if (order?.id) await sb.from('orders').update({status:'complete'}).eq('id',order.id);
      }
      await sb.from('bulk_orders').update({status:'processed'}).eq('id',bulk.id);
      const fmt = `£${(session.amount_total/100).toFixed(2)}`;
      const ref = session.id.slice(-12).toUpperCase();
      const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
      await resend.emails.send({from:'CompliantUK <noreply@compliantuk.co.uk>',reply_to:'support@compliantuk.co.uk',to:bulk.landlord_email,bcc:process.env.ADMIN_BCC_EMAIL||'support@compliantuk.co.uk',subject:`Portfolio compliance confirmed — ${props.length} properties`,html:landlordHtml(bulk.landlord_first,bulk.landlord_last,bulk.landlord_email,`${props.length} properties (Portfolio)`,[],fmt,isNew,pw,ref,date)}).catch(e=>console.error('landlord email:',e.message));
    } catch(e) { console.error('bulk error:',e.message); }
    return res.status(200).json({received:true,bulk:true});
  }

  const lEmail = meta.landlordEmail||session.customer_details?.email||session.customer_email;
  const lFirst = meta.landlordFirst||'Landlord';
  const lLast = meta.landlordLast||'';
  const addr = meta.propertyAddress||'Your property';
  if (!lEmail) return res.status(200).json({received:true,error:'no email'});
  let tenants=[];
  try { tenants=parseTenants(meta); } catch(e) { console.error('parse:',e.message); }
  if (!tenants.length) return res.status(200).json({received:true,error:'no tenants'});

  try {
    const {id:landlordId,pw,isNew} = await getOrCreate(lEmail,lFirst,lLast);
    const {data:order} = await sb.from('orders').insert({stripe_session_id:session.id,landlord_id:landlordId,landlord_email:lEmail,landlord_first:lFirst,landlord_last:lLast,property_address:addr,amount_paid:session.amount_total,package:meta.package||'starter',status:'processing'}).select().single();
    const pdf64 = await fetchPdf().then(b=>b.toString('base64')).catch(()=>null);
    for (const t of tenants) await doTenant(t,order?.id,landlordId,addr,lFirst,lLast,pdf64).catch(e=>console.error('tenant:',e.message));
    if (order?.id) await sb.from('orders').update({status:'complete'}).eq('id',order.id);
    const fmt = `£${(session.amount_total/100).toFixed(2)}`;
    const ref = session.id.slice(-12).toUpperCase();
    const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    await resend.emails.send({from:'CompliantUK <noreply@compliantuk.co.uk>',reply_to:'support@compliantuk.co.uk',to:lEmail,bcc:process.env.ADMIN_BCC_EMAIL||'support@compliantuk.co.uk',subject:`Compliance confirmed — ${addr}`,html:landlordHtml(lFirst,lLast,lEmail,addr,tenants,fmt,isNew,pw,ref,date)}).catch(e=>console.error('landlord email:',e.message));
  } catch(e) { console.error('single error:',e.message); }
  return res.status(200).json({received:true});
}

function tenantHtml(tFirst,tLast,lFirst,lLast,addr,pixel) {
  const landlordName = `${lFirst} ${lLast}`;
  const tenantName = `${tFirst} ${tLast}`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Important Legal Document — Renters' Rights Act 2025</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">

  <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center">
    <div style="display:inline-block;background:rgba(255,255,255,0.15);padding:8px 16px;border-radius:8px;margin-bottom:16px">
      <span style="font-size:18px;font-weight:800;color:white">✓ CompliantUK</span>
    </div>
    <h1 style="color:white;font-size:22px;font-weight:700;margin:0;line-height:1.3">Important Legal Document for Your Tenancy</h1>
    <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:10px 0 0">Renters' Rights Act 2025 — Please Read</p>
  </div>

  <div style="background:#fef3c7;border-bottom:2px solid #f59e0b;padding:14px 40px">
    <p style="margin:0;font-size:14px;color:#92400e;font-weight:600">⚠ This is not spam. This is an official legal document sent on behalf of your landlord.</p>
  </div>

  <div style="padding:36px 40px">
    <p style="font-size:16px;color:#1e293b;margin:0 0 20px">Dear ${tenantName},</p>

    <div style="background:#eff6ff;border-radius:10px;padding:20px 24px;margin:0 0 20px;border-left:4px solid #3b82f6">
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1e40af">📋 What is this email?</p>
      <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.7">Under the <strong>Renters' Rights Act 2025</strong>, every landlord in England is legally required to provide each tenant with an official Government Information Sheet. Your landlord, <strong>${landlordName}</strong>, is fulfilling this legal duty for your property at <strong>${addr}</strong>.</p>
    </div>

    <div style="background:#f0fdf4;border-radius:10px;padding:20px 24px;margin:0 0 20px;border-left:4px solid #10b981">
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#065f46">🏠 Why do you need to read it?</p>
      <p style="margin:0 0 12px;font-size:14px;color:#1e293b;line-height:1.7">The attached PDF is the <strong>official GOV.UK information sheet</strong> that sets out your rights as a tenant. It covers:</p>
      <p style="margin:0 0 6px;font-size:14px;color:#1e293b">✓ Your rights if your landlord wants to increase the rent</p>
      <p style="margin:0 0 6px;font-size:14px;color:#1e293b">✓ What your landlord must do before ending your tenancy</p>
      <p style="margin:0 0 6px;font-size:14px;color:#1e293b">✓ Your right to a well-maintained, safe property</p>
      <p style="margin:0;font-size:14px;color:#1e293b">✓ How to raise a dispute or complaint if needed</p>
    </div>

    <div style="background:#f8fafc;border-radius:10px;padding:20px 24px;margin:0 0 28px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#1e293b">📎 What you need to do</p>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.7"><strong>Open and read the PDF attached to this email.</strong> There is nothing to sign or return. Your receipt of this document is recorded automatically and protects both you and your landlord under the new legislation.</p>
    </div>

    <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 28px">For questions about your rights, <a href="https://www.citizensadvice.org.uk" style="color:#3b82f6;text-decoration:none;font-weight:600">Citizens Advice</a> offers free independent guidance. For information on the Act itself, visit <a href="https://www.gov.uk/government/collections/renters-rights-bill" style="color:#3b82f6;text-decoration:none;font-weight:600">GOV.UK</a>.</p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px"/>
    <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">This email was sent on behalf of <strong>${landlordName}</strong> by <strong>CompliantUK</strong>, a compliance document delivery service for private landlords in England. Delivery of this document is recorded for legal compliance purposes only.</p>
  </div>

  <div style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0">© 2026 CompliantUK</p>
  </div>
</div>
<img src="${pixel}" width="1" height="1" style="display:none" alt="">
</body></html>`;
}

function landlordHtml(lFirst,lLast,lEmail,addr,tenants,amount,isNew,pw,ref,date) {
  const rows = tenants.map(t=>`<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155">${t.first} ${t.last}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">${t.email}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right"><span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">SENT</span></td></tr>`).join('');
  const acct = isNew
    ? `<div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin:0 0 24px;border-left:4px solid #3b82f6"><h2 style="margin:0 0 6px;font-size:17px;font-weight:700;color:#fff">Your CompliantUK Account</h2><p style="margin:0 0 16px;color:#93c5fd;font-size:13px">Log in to track compliance and download certificates.</p><p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Email</p><p style="margin:0 0 16px;font-size:15px;color:#e2e8f0;font-family:monospace">${lEmail}</p><p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Temporary Password</p><p style="margin:0 0 20px;font-size:22px;font-weight:800;color:#60a5fa;font-family:monospace;letter-spacing:2px">${pw}</p><a href="${BASE}/login?email=${encodeURIComponent(lEmail)}&new=1" style="display:inline-block;background:#3b82f6;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Log in to dashboard</a></div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin:0 0 24px"><p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#166534">View in your dashboard</p><a href="${BASE}/login?email=${encodeURIComponent(lEmail)}" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Go to dashboard</a></div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0"><tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px"><div style="font-weight:700;font-size:17px;color:white;margin-bottom:16px">Compliant<span style="color:#60a5fa">UK</span></div><h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#fff">You're compliant.</h1><p style="margin:0;color:#93c5fd;font-size:15px">Payment confirmed. Documents delivered to your tenants.</p></td></tr><tr><td style="background:#fff;padding:36px"><p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7">Hi ${lFirst}, the Renters' Rights Act 2025 Information Sheet has been emailed to each of your tenants.</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px 28px;margin:0 0 24px"><p style="margin:0 0 16px;font-size:13px;font-weight:700;text-transform:uppercase;color:#94a3b8">Order Summary</p><table cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;width:40%">Reference</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600;font-family:monospace">${ref}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Date</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${date}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Property</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">${addr}</td></tr><tr><td style="padding:8px 0;font-size:13px;color:#64748b">Amount paid</td><td style="padding:8px 0;font-size:15px;color:#0f172a;font-weight:700">${amount}</td></tr></table></div>${rows.length?`<div style="margin:0 0 28px"><p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;color:#94a3b8">Tenant Delivery Status</p><table cellpadding="0" cellspacing="0" width="100%">${rows}</table></div>`:''} ${acct}</td></tr><tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center"><p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK</p></td></tr></table></td></tr></table></body></html>`;
}
