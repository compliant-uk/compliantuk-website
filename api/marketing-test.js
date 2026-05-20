// api/marketing-test.js
// Dedicated test script for MailerSend marketing/bulk emails
// This is separate from the transactional Resend service

import { sendEmail } from './mailersend-service.js';

export default async function handler(req, res) {
  // Only allow POST for testing
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { testEmail } = req.body || {};

  if (!testEmail || !testEmail.includes('@')) {
    return res.status(400).json({ error: 'Valid testEmail is required' });
  }

  try {
    console.log(`[marketing-test] Sending MailerSend test to: ${testEmail}`);
    
    const response = await sendEmail({
      to: testEmail,
      subject: 'MailerSend Marketing Test — CompliantUK',
      fromName: 'CompliantUK Marketing',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="margin:0;padding:0;background:#f4f7f9;font-family:sans-serif;">
          <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <div style="background:#080c14;padding:30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;">Marketing Test</h1>
            </div>
            <div style="padding:40px;color:#333333;line-height:1.6;">
              <p>Hello,</p>
              <p>This is a test email sent via <strong>MailerSend</strong>, which is now configured for your marketing and bulk campaigns.</p>
              <p>Your transactional emails (contact forms, order receipts) continue to run through <strong>Resend</strong> to ensure stability.</p>
              <div style="background:#eef2f5;padding:20px;border-radius:6px;margin:25px 0;">
                <p style="margin:0;font-weight:bold;">Verification Details:</p>
                <ul style="margin:10px 0 0;padding-left:20px;">
                  <li>Service: MailerSend</li>
                  <li>Domain: compliantuk.co.uk</li>
                  <li>Purpose: Marketing & Bulk</li>
                </ul>
              </div>
              <p>If you received this, your MailerSend integration is fully operational.</p>
            </div>
            <div style="background:#f4f7f9;padding:20px;text-align:center;font-size:12px;color:#999999;">
              © 2026 CompliantUK · Marketing Department
            </div>
          </div>
        </body>
        </html>
      `
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Marketing test email sent successfully via MailerSend',
      mailerSendResponse: response 
    });
  } catch (error) {
    console.error('[marketing-test] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to send marketing test email', 
      details: error.message 
    });
  }
}
