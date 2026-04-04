// api/send-documents.js
// Called by Stripe webhook after successful payment
// Sends the compliance documents to the landlord via Resend

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
    const { customerEmail, customerName, propertyAddress, plan } = req.body;

    if (!customerEmail || !propertyAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const isBundle = plan === 'bundle';

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e, #3b82f6); padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
    .header p { color: #93c5fd; margin: 8px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .alert-box { background: #eff6ff; border: 1px solid #3b82f6; border-radius: 6px; padding: 16px; margin: 20px 0; }
    .alert-box p { margin: 0; color: #1d4ed8; font-size: 14px; }
    .doc-list { background: #f8fafc; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .doc-item { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .doc-item:last-child { border-bottom: none; }
    .checkmark { color: #22c55e; font-weight: bold; margin-right: 12px; }
    .footer { background: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #64748b; font-size: 12px; margin: 4px 0; }
    .btn { display: inline-block; background: #3b82f6; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Your Compliance Documents Are Ready</h1>
      <p>CompliantUK — Renters Rights Act Compliance</p>
    </div>
    <div class="body">
      <p>Dear ${customerName || 'Landlord'},</p>
      <p>Thank you for your order. Your compliance documents for <strong>${propertyAddress}</strong> have been generated and are attached to this email.</p>

      <div class="alert-box">
        <p>⚠️ <strong>Important:</strong> The Renters Rights Act comes into force May 2026. You must serve the Information Sheet on your tenant before this date to avoid fines of up to £7,000.</p>
      </div>

      <div class="doc-list">
        <p style="margin: 0 0 12px; font-weight: bold; color: #1a1a2e;">Documents included in your order:</p>
        <div class="doc-item">
          <span class="checkmark">✓</span>
          <span>Renters Rights Act Information Sheet (tenant copy)</span>
        </div>
        <div class="doc-item">
          <span class="checkmark">✓</span>
          <span>Proof of Service Certificate (your legal record)</span>
        </div>
        ${isBundle ? `
        <div class="doc-item">
          <span class="checkmark">✓</span>
          <span>Section 21-Compliant Tenancy Agreement (updated 2026)</span>
        </div>` : ''}
      </div>

      <p><strong>What to do next:</strong></p>
      <ol>
        <li>Print and hand the Information Sheet to your tenant in person, or send via recorded post</li>
        <li>Ask your tenant to sign and date the Proof of Service Certificate</li>
        <li>Keep the signed certificate safely — you will need it if challenged</li>
      </ol>

      <p>Your compliance dashboard is available at:</p>
      <a href="https://www.compliantuk.co.uk/dashboard.html" class="btn">View Your Dashboard</a>

      <p style="color: #64748b; font-size: 13px;">If you have any questions, reply to this email or contact us at <a href="mailto:support@compliantuk.co.uk">support@compliantuk.co.uk</a></p>
    </div>
    <div class="footer">
      <p><strong>CompliantUK</strong> — The UK's landlord compliance platform</p>
      <p>compliantuk.co.uk | support@compliantuk.co.uk</p>
      <p style="margin-top: 12px;">You received this because you purchased a compliance package from CompliantUK.</p>
    </div>
  </div>
</body>
</html>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CompliantUK Documents <documents@compliantuk.co.uk>',
        to: [customerEmail],
        bcc: ['huseyin.turkay@compliantuk.co.uk'], // keep a copy for your records
        subject: `Your Compliance Documents — ${propertyAddress}`,
        html: emailHtml,
        // attachments: [] // Add PDF attachments here when PDF generation is ready
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Failed to send email', details: data });
    }

    return res.status(200).json({ success: true, emailId: data.id });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
