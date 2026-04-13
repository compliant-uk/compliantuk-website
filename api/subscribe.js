// api/subscribe.js
// Saves subscriber email and sends a welcome/notification email via Resend

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

  // Save to Supabase subscribers table (create if needed)
  try {
    await supabase.from('subscribers').upsert({ email, subscribed_at: new Date().toISOString() }, { onConflict: 'email' });
  } catch (err) {
    console.error('Subscriber save error:', err.message);
  }

  // Send welcome email to subscriber
  try {
    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      reply_to: 'support@compliantuk.co.uk',
      to: email,
      subject: 'You\'re subscribed — Renters Rights Act updates from CompliantUK',
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f8fafc"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-weight:700;font-size:17px;color:white">Compliant<span style="color:#60a5fa">UK</span></div>
    <h1 style="margin:12px 0 0;font-size:22px;font-weight:800;color:#fff">You're subscribed ✓</h1>
  </td></tr>
  <tr><td style="background:#fff;padding:36px">
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px">Thank you for subscribing to CompliantUK updates.</p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px">We'll keep you informed about the Renters' Rights Act 2025 — deadlines, changes, enforcement updates and new guides as they're published.</p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 24px"><strong>The 31 May 2026 deadline is approaching.</strong> If you haven't yet served your Information Sheet to all tenants, you can do so in minutes from £49.</p>
    <a href="https://www.compliantuk.co.uk" style="display:inline-block;background:#3b82f6;color:white;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px">Become compliant now →</a>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:20px;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">© 2026 CompliantUK · <a href="https://www.compliantuk.co.uk/privacy" style="color:#94a3b8">Unsubscribe</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`,
    });
  } catch (err) {
    console.error('Welcome email error:', err.message);
  }

  // Notify admin
  try {
    await resend.emails.send({
      from: 'CompliantUK <noreply@compliantuk.co.uk>',
      to: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
      subject: `New subscriber: ${email}`,
      html: `<p>New blog subscriber: <strong>${email}</strong></p><p>Time: ${new Date().toLocaleString('en-GB')}</p>`,
    });
  } catch (err) {
    console.error('Admin notify error:', err.message);
  }

  return res.status(200).json({ success: true });
}
