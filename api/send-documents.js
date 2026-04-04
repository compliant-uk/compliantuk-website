// api/send-documents.js
// Called by Stripe webhook after successful payment
// Generates PDF certificate and sends it to the landlord via Resend

import { generateComplianceCertificate } from './generate-certificate.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
    const { customerEmail, customerName, propertyAddress, plan, paymentReference } = req.body;

    if (!customerEmail || !propertyAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const isBundle = plan === 'bundle';

    // Generate PDF certificate
    const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
      landlordName:    customerName,
      propertyAddress,
      tenantName:      null,
      plan,
      paymentReference,
    });

    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

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
    .ref-box { background: #eff6ff; border: 1px solid #3b82f6; border-radius: 6px; padding: 12px 16px; margin: 0 0 20px; }
    .ref-box span { color: #1d4ed8; font-size: 13px; font-weight: bold; display: block; margin-bottom: 4px; }
    .alert-box { background: #fefce8; border: 1px solid #eab308; border-radius: 6px; padding: 16px; margin: 20px 0; }
    .alert-box p { margin: 0; color: #713f12; font-size: 13px; }
    .doc-list { background: #f8fafc; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .doc-item { padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
    .doc-item:last-child { border-bottom: none; }
    .doc-name { font-weight: bold; color: #1a1a2e; font-size: 13px; }
    .doc-desc { color: #64748b; font-size: 12px; margin-top: 3px; }
    .step { margin-bottom: 12px; font-size: 13px; color: #1a1a2e; padding-left: 8px; border-left: 3px solid #3b82f6; }
    .btn { display: inline-block; background: #3b82f6; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 8px 0; font-size: 14px; }
    .footer { background: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #64748b; font-size: 12px; margin: 4px 0; }
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

      <div class="ref-box">
        <span>📋 Reference: ${referenceNumber}</span>
        <span>📍 Property: ${propertyAddress}</span>
      </div>

      <p>Your compliance documents are <strong>attached to this email as a PDF</strong>. Please download and keep them safely.</p>

      <div class="alert-box">
        <p>⚠️ <strong>Deadline reminder:</strong> The Renters Rights Act comes into force May 2026. Serve the Information Sheet on your tenant before this date to avoid fines of up to <strong>£7,000</strong>.</p>
      </div>

      <div class="doc-list">
        <p style="margin: 0 0 12px; font-weight: bold; color: #1a1a2e;">Documents attached:</p>
        <div class="doc-item">
          <div class="doc-name">✓ Proof of Compliance Certificate</div>
          <div class="doc-desc">Your legal record — contains signature fields for tenant acknowledgement. Keep the signed copy.</div>
        </div>
        <div class="doc-item">
          <div class="doc-name">✓ Renters Rights Act Information Sheet</div>
          <div class="doc-desc">Print and hand to your tenant, or send via recorded post</div>
        </div>
        ${isBundle ? `
        <div class="doc-item">
          <div class="doc-name">✓ Updated Tenancy Agreement (2026)</div>
          <div class="doc-desc">Section 21-compliant template — complete and send to tenant for signing</div>
        </div>` : ''}
      </div>

      <p style="font-weight: bold; margin-bottom: 12px;">What to do now:</p>
      <div class="step">1. Print the <strong>Information Sheet</strong> and hand to your tenant in person, or send via recorded post</div>
      <div class="step">2. Get your tenant to sign and date the <strong>Proof of Service Certificate</strong></div>
      <div class="step">3. Keep the signed certificate — you will need it as legal proof if challenged</div>
      ${isBundle ? '<div class="step">4. Complete and send the <strong>Tenancy Agreement</strong> to your tenant for e-signature</div>' : ''}

      <br>
      <a href="https://www.compliantuk.co.uk/dashboard.html" class="btn">View Your Dashboard →</a>

      <p style="color: #64748b; font-size: 13px; margin-top: 24px;">Questions? Contact <a href="mailto:support@compliantuk.co.uk">support@compliantuk.co.uk</a></p>
    </div>
    <div class="footer">
      <p><strong>CompliantUK</strong> — The UK's landlord compliance platform</p>
      <p>compliantuk.co.uk | support@compliantuk.co.uk</p>
      <p style="margin-top: 8px; font-size: 11px;">Ref: ${referenceNumber}</p>
    </div>
  </div>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CompliantUK Documents <documents@compliantuk.co.uk>',
        to: [customerEmail],
        bcc: ['huseyin.turkay@compliantuk.co.uk'],
        subject: `Your Compliance Certificate — ${propertyAddress} [${referenceNumber}]`,
        html: emailHtml,
        attachments: [
          {
            filename: `CompliantUK-Certificate-${referenceNumber}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Failed to send email', details: data });
    }

    return res.status(200).json({ success: true, emailId: data.id, referenceNumber });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
