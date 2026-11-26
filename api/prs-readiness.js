// api/prs-readiness.js
// Lead capture for the Renters' Rights Act 2025 "Register your rental property" (PRS Database) pivot.
// Handles three submission types from the website:
//   type: 'check'   — free readiness checker on the homepage (emails the landlord their result)
//   type: 'reserve' — early-access reservation for a paid plan (no payment taken)
//   type: 'agent'   — portfolio / letting agent quote request from /agents
// Stores rows in Supabase `prs_leads` (see migrations/2026-11-prs-leads.sql). If that table is missing,
// falls back to the existing `subscribers` table for opted-in emails so no lead is lost.
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Region windows — keep in sync with /prs-regions.js (source: GOV.UK guidance, 29 Oct 2026)
const REGIONS = {
  'West Midlands':            ['15 December 2026', '14 March 2027'],
  'East of England':          ['15 January 2027',  '14 April 2027'],
  'East Midlands':            ['15 February 2027', '14 May 2027'],
  'South East':               ['15 March 2027',    '14 June 2027'],
  'Yorkshire and Humberside': ['15 April 2027',    '14 July 2027'],
  'North West':               ['15 May 2027',      '14 August 2027'],
  'North East':               ['15 June 2027',     '14 September 2027'],
  'London':                   ['15 July 2027',     '14 October 2027'],
  'South West':               ['15 August 2027',   '14 November 2027'],
};
const PLANS = {
  'register-ready': 'Register-Ready — £29 per property (one-off)',
  'monitor': 'Ready + Monitor — £29 + £2.50 per property per month',
  'agency': 'Portfolio & Agency — from £1.50 per property per month',
};
const TYPES = ['check', 'reserve', 'agent'];

// Must match api/unsubscribe.js exactly so unsubscribe links validate.
function generateUnsubscribeToken(email) {
  return crypto.createHash('sha256').update(email + process.env.UNSUBSCRIBE_SECRET || 'default-secret').digest('hex');
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clip(v, n = 200) { return v == null ? null : String(v).trim().slice(0, n); }
function validEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254; }

function shell(title, inner, unsubscribeUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f8fafc"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
<div style="font-weight:700;font-size:17px;color:white">Compliant<span style="color:#60a5fa">UK</span></div>
<h1 style="margin:12px 0 0;font-size:22px;font-weight:800;color:#fff">${title}</h1></td></tr>
<tr><td style="background:#fff;padding:32px 36px;color:#334155;font-size:15px;line-height:1.7">${inner}</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px;text-align:center">
<p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6">CompliantUK is an independent service and is not affiliated with GOV.UK. Landlords must register directly on the government's Register your rental property service. Not legal advice.<br>© 2026 CompliantUK${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:#94a3b8">Unsubscribe</a>` : ''}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function checkEmail(d) {
  const win = REGIONS[d.region];
  let inner;
  if (d.country && d.country !== 'England') {
    inner = `<p>The postcode you checked (<strong>${esc(d.postcode)}</strong>) is in ${esc(d.country)}. The Register your rental property service applies to <strong>England only</strong>.</p>`;
  } else if (d.tenancy_type === 'exempt') {
    inner = `<p>You told us the tenancy at <strong>${esc(d.postcode)}</strong> is supported exempt accommodation. Tenancies within section 12 of the Supported Housing (Regulatory Oversight) Act 2023 do not need to be registered. If you're unsure, reply to this email and we'll help.</p>`;
  } else if (win) {
    inner = `<p>Here's your result for <strong>${esc(d.postcode)}</strong>${d.council ? ` (${esc(d.council)})` : ''}:</p>
<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0 20px">
<tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0">Region</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:right"><strong>${esc(d.region)}</strong></td></tr>
<tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0">Registration opens</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:right"><strong>${win[0]}</strong></td></tr>
<tr><td style="padding:10px 14px;${d.fee_estimate ? 'border-bottom:1px solid #e2e8f0' : ''}">Deadline (before midnight)</td><td style="padding:10px 14px;${d.fee_estimate ? 'border-bottom:1px solid #e2e8f0;' : ''}text-align:right"><strong>${win[1]}</strong></td></tr>
${d.fee_estimate ? `<tr><td style="padding:10px 14px">Estimated government fee (registering ${esc(d.fee_date)})</td><td style="padding:10px 14px;text-align:right"><strong>£${esc(d.fee_estimate)}</strong></td></tr>` : ''}
</table>
<p style="margin:0 0 8px"><strong>Get these ready before you register:</strong></p>
<ul style="margin:0 0 20px;padding-left:20px">
${d.gas === 'no' ? '' : '<li>Gas safety certificate</li>'}<li>EICR or EIC (electrical)</li><li>Energy Performance Certificate</li><li>Rent and tenancy details</li><li>${d.hmo === 'no' ? 'Any selective or additional licence' : 'HMO licence (one registration for the whole property)'}</li><li>A GOV.UK One Login account</li></ul>
<p>Remember: once you register a property you have <strong>28 days</strong> to supply anything outstanding, and any later change (rent, occupants, a renewed certificate) must be updated within 28 days.</p>`;
  } else {
    inner = `<p>Thanks for checking <strong>${esc(d.postcode)}</strong>. We couldn't match it to a region automatically — please confirm your council's region using GOV.UK's regions and councils list, or reply to this email and we'll check for you.</p>`;
  }
  inner += `<p style="margin:24px 0 0"><a href="https://www.compliantuk.co.uk/#pricing" style="display:inline-block;background:#3b82f6;color:white;padding:13px 26px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px">Get Register-Ready →</a></p>`;
  return inner;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};

  // Honeypot: bots fill hidden "website" fields
  if (b.website) return res.status(200).json({ success: true });

  const type = TYPES.includes(b.type) ? b.type : null;
  const email = clip(b.email, 254);
  if (!type) return res.status(400).json({ error: 'Invalid submission type' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if ((type === 'reserve' || type === 'agent') && !clip(b.name)) return res.status(400).json({ error: 'Name is required' });

  const lead = {
    type,
    email: email.toLowerCase(),
    name: clip(b.name, 120),
    company: clip(b.company, 160),
    role: clip(b.role, 60),
    postcode: clip(b.postcode, 10),
    country: clip(b.country, 40),
    region: clip(b.region, 60),
    council: clip(b.council, 120),
    let_status: clip(b.let_status, 20),
    tenancy_type: clip(b.tenancy_type, 20),
    gas: clip(b.gas, 10),
    hmo: clip(b.hmo, 10),
    plan: clip(b.plan, 40),
    properties: Number.isFinite(+b.properties) ? Math.max(0, Math.min(100000, Math.round(+b.properties))) : null,
    fee_estimate: clip(b.fee_estimate, 12),
    message: clip(b.message, 2000),
    optin: b.optin !== false,
    created_at: new Date().toISOString(),
  };

  // 1) Store the lead
  let stored = false;
  try {
    const { error } = await supabase.from('prs_leads').insert(lead);
    if (error) throw error;
    stored = true;
  } catch (err) {
    console.error('prs_leads insert failed:', err.message);
  }
  // Keep the newsletter list in sync for opted-in emails (and as a fallback if prs_leads is missing)
  if (lead.optin) {
    try {
      const { error } = await supabase.from('subscribers').upsert({ email: lead.email, subscribed_at: lead.created_at, subscribed: true }, { onConflict: 'email' });
      if (error) throw error;
    } catch (err) {
      console.error('subscribers upsert failed:', err.message);
    }
  }

  const unsubscribeUrl = `https://www.compliantuk.co.uk/api/unsubscribe?email=${encodeURIComponent(lead.email)}&token=${generateUnsubscribeToken(lead.email)}`;

  // 2) Email the landlord / agent
  try {
    let subject, title, inner;
    if (type === 'check') {
      if (!lead.optin) throw new Error('skip: no opt-in for result email');
      subject = lead.region && REGIONS[lead.region]
        ? `Your rental property register date: ${lead.region} opens ${REGIONS[lead.region][0]}`
        : 'Your rental property register check';
      title = 'Your registration check';
      inner = checkEmail({ ...lead, fee_date: clip(b.fee_date, 12) });
    } else if (type === 'reserve') {
      subject = "You're on the list — CompliantUK Register-Ready early access";
      title = "You're on the list ✓";
      inner = `<p>Hi ${esc(lead.name.split(' ')[0])},</p>
<p>Thanks for reserving early access to <strong>${esc(PLANS[lead.plan] || 'CompliantUK Register-Ready')}</strong>${lead.properties ? ` for ${lead.properties} propert${lead.properties === 1 ? 'y' : 'ies'}` : ''}. No payment has been taken.</p>
<p>We'll email you as soon as your account is ready — in time for your region's registration window${lead.region && REGIONS[lead.region] ? ` (${esc(lead.region)}: ${REGIONS[lead.region][0]} – ${REGIONS[lead.region][1]})` : ''}.</p>
<p>In the meantime, set up a GOV.UK One Login and start gathering your gas safety, EICR/EIC and EPC certificates.</p>`;
    } else {
      subject = 'Thanks — your CompliantUK portfolio quote request';
      title = 'Quote request received';
      inner = `<p>Hi ${esc(lead.name.split(' ')[0])},</p>
<p>Thanks for your enquiry${lead.company ? ` on behalf of <strong>${esc(lead.company)}</strong>` : ''}. We'll reply within one working day with a tailored quote${lead.properties ? ` for ${lead.properties} properties` : ''}.</p>
<p>If you'd like to talk sooner, just reply to this email.</p>`;
    }
    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      reply_to: 'support@compliantuk.co.uk',
      to: lead.email,
      subject,
      html: shell(title, inner, lead.optin ? unsubscribeUrl : null),
    });
  } catch (err) {
    if (!String(err.message).startsWith('skip')) console.error('Lead email error:', err.message);
  }

  // 3) Notify admin
  try {
    const rows = Object.entries(lead).filter(([, v]) => v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => `<tr><td style="padding:4px 10px;color:#64748b">${esc(k)}</td><td style="padding:4px 10px"><strong>${esc(v)}</strong></td></tr>`).join('');
    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      to: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
      reply_to: lead.email,
      subject: `PRS lead (${type}): ${lead.email}${lead.region ? ` — ${lead.region}` : ''}${lead.properties ? ` — ${lead.properties} props` : ''}`,
      html: `<table>${rows}</table><p style="color:#94a3b8;font-size:12px">Stored in prs_leads: ${stored ? 'yes' : 'NO — check Supabase table exists'}</p>`,
    });
  } catch (err) {
    console.error('Admin notify error:', err.message);
  }

  return res.status(200).json({ success: true });
}
