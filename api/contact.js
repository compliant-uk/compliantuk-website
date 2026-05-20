// api/contact.js
// Real backend for contact form submissions using Resend email service
// Stores submissions in Supabase and sends notifications to support

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, subject, message } = req.body || {};

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields: name, email, message' });
    }

    // Basic email validation
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Store submission in Supabase (optional, for record-keeping)
    try {
      await supabase.from('contact_submissions').insert({
        name,
        email,
        subject: subject || 'Website enquiry',
        message,
        submitted_at: new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error('Failed to store contact submission:', dbErr.message);
      // Don't fail the request if database insert fails
    }

    // Send confirmation email to user
    try {
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: email,
        subject: 'We received your message — CompliantUK',
        html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.15);padding:8px 16px;border-radius:8px;margin-bottom:16px">
      <span style="font-size:18px;font-weight:800;color:white">✓ CompliantUK</span>
    </div>
    <h1 style="color:white;font-size:22px;font-weight:700;margin:0;line-height:1.3">We received your message</h1>
  </div>

  <div style="padding:36px 40px">
    <p style="font-size:16px;color:#1e293b;margin:0 0 16px">Hi ${name},</p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 16px">
      Thank you for getting in touch with CompliantUK. We've received your message and our support team will review it shortly.
    </p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px">
      We typically respond to enquiries within 4 hours during business hours (Mon–Fri, 9am–6pm GMT). If your issue is urgent, please reply to this email with "URGENT" in the subject line.
    </p>

    <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin:0 0 28px;border-left:4px solid #3b82f6">
      <p style="font-size:14px;color:#64748b;margin:0 0 8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Your message</p>
      <p style="font-size:14px;color:#1e293b;margin:0;line-height:1.6"><strong>${subject || 'Website enquiry'}</strong></p>
      <p style="font-size:13px;color:#475569;margin:8px 0 0;line-height:1.6">${message.replace(/\n/g, '<br>')}</p>
    </div>

    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0">
      In the meantime, you can find answers to common questions on our <a href="https://www.compliantuk.co.uk" style="color:#3b82f6;text-decoration:none">website</a> or <a href="https://www.compliantuk.co.uk/blog" style="color:#3b82f6;text-decoration:none">blog</a>.
    </p>
  </div>

  <div style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
      © 2026 CompliantUK · <a href="https://www.compliantuk.co.uk/privacy" style="color:#94a3b8">Privacy Policy</a>
    </p>
  </div>
</div>
</body>
</html>`,
      });
    } catch (emailErr) {
      console.error('Failed to send confirmation email:', emailErr.message);
      // Don't fail the request if confirmation email fails
    }

    // Send notification email to support
    try {
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: process.env.ADMIN_BCC_EMAIL || 'support@compliantuk.co.uk',
        subject: `New contact form submission: ${subject || 'Website enquiry'}`,
        html: `<p><strong>New contact form submission</strong></p>
<p><strong>Name:</strong> ${name}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Subject:</strong> ${subject || 'Website enquiry'}</p>
<p><strong>Message:</strong></p>
<p style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">${message}</p>
<p><strong>Submitted:</strong> ${new Date().toLocaleString('en-GB')}</p>`,
      });
    } catch (emailErr) {
      console.error('Failed to send admin notification:', emailErr.message);
      // Don't fail the request if admin notification fails
    }

    return res.status(200).json({ success: true, message: 'Your message has been sent successfully' });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Failed to process your message. Please try again later.' });
  }
}
