// api/send-documents.js
import { generateComplianceCertificate } from './generate-certificate.js';

const INFO_SHEET_URL = 'https://raw.githubusercontent.com/compliant-uk/compliantuk-website/main/The_Renters__Rights_Act_Information_Sheet_2026.pdf';
const TENANCY_URL = 'https://assets.publishing.service.gov.uk/media/62b17a918fa8f53571e130a9/Model_agreement_for_a_shorthold_assured_tenancy.pdf';

async function fetchPdfAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Email service not configured' });

  try {
    const { customerEmail, customerName, propertyAddress, plan, paymentReference } = req.body;
    if (!customerEmail || !propertyAddress) return res.status(400).json({ error: 'Missing required fields' });

    const isBundle = plan === 'bundle';

    // 1. Generate compliance certificate
    const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
      landlordName: customerName,
      propertyAddress,
      tenantName: null,
      plan,
      paymentReference,
    });

    // 2. Build attachments
    const attachments = [
      { filename: `CompliantUK-Certificate-${referenceNumber}.pdf`, content: Buffer.from(pdfBytes).toString('base64') }
    ];

    try {
      attachments.push({ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: await fetchPdfAsBase64(INFO_SHEET_URL) });
    } catch(e) { console.error('Info sheet fetch failed:', e.message); }

    if (isBundle) {
      try {
        attachments.push({ filename: 'Model-Tenancy-Agreement-2026.pdf', content: await fetchPdfAsBase64(TENANCY_URL) });
      } catch(e) { console.error('Tenancy agreement fetch failed:', e.message); }
    }

    // 3. Email HTML
    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;color:#1a1a2e;background:#f5f5f5;margin:0;padding:0}
.container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden}
.header{background:linear-gradient(135deg,#1a1a2e,#3b82f6);padding:40px 32px;text-align:center}
.header h1{color:#fff;margin:0;font-size:22px}
.header p{color:#93c5fd;margin:8px 0 0;font-size:13px}
.body{padding:32px}
.ref-box{background:#eff6ff;border:1px solid #3b82f6;border-radius:6px;padding:12px 16px;margin:0 0 20px}
.ref-box span{color:#1d4ed8;font-size:13px;font-weight:bold;display:block;margin-bottom:4px}
.alert-box{background:#fefce8;border:1px solid #eab308;border-radius:6px;padding:16px;margin:20px 0}
.alert-box p{margin:0;color:#713f12;font-size:13px}
.doc-list{background:#f8fafc;border-radius:6px;padding:20px;margin:20px 0}
.doc-item{padding:10px 0;border-bottom:1px solid #e2e8f0}
.doc-item:last-child{border-bottom:none}
.doc-name{font-weight:bold;color:#1a1a2e;font-size:13px}
.doc-desc{color:#64748b;font-size:12px;margin-top:3px}
.step{margin-bottom:12px;font-size:13px;color:#1a1a2e;padding-left:8px;border-left:3px solid #3b82f6}
.btn{display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;margin:8px 0;font-size:14px}
.footer{background:#f8fafc;padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0}
.footer p{color:#64748b;font-size:12px;margin:4px 0}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Your Compliance Documents Are Ready</h1>
    <p>CompliantUK — Renters Rights Act Compliance</p>
  </div>
  <div class="body">
    <p>Dear ${customerName || 'Landlord'},</p>
    <div class="ref-box">
      <span>Reference: ${referenceNumber}</span>
      <span>Property: ${propertyAddress}</span>
    </div>
    <p>Your compliance documents are <strong>attached to this email as PDFs</strong>. Please download and keep them safely.</p>
    <div class="alert-box">
      <p><strong>Important deadline:</strong> The Renters Rights Act comes into force May 2026. You must serve the Information Sheet on your tenant before this date to avoid fines of up to <strong>£7,000 per tenant</strong>. If you have 3 tenants, that is up to <strong>£21,000</strong> in fines.</p>
    </div>
    <div class="doc-list">
      <p style="margin:0 0 12px;font-weight:bold;color:#1a1a2e">Documents attached to this email:</p>
      <div class="doc-item">
        <div class="doc-name">1. Proof of Compliance Certificate (CompliantUK)</div>
        <div class="doc-desc">Your legal record — get your tenant to sign and date this. Keep the signed copy safely.</div>
      </div>
      <div class="doc-item">
        <div class="doc-name">2. Renters Rights Act Information Sheet (Official Government Document)</div>
        <div class="doc-desc">Print and hand to your tenant in person, or send via recorded post before May 2026.</div>
      </div>
      ${isBundle ? `<div class="doc-item">
        <div class="doc-name">3. Model Tenancy Agreement 2026 (Official Government Template)</div>
        <div class="doc-desc">Complete with your tenancy details and send to your tenant for signing before 1 May 2026.</div>
      </div>` : ''}
    </div>
    <p style="font-weight:bold;margin-bottom:12px">What to do now:</p>
    <div class="step">1. Print the <strong>Information Sheet</strong> and hand to your tenant in person, or send via recorded post</div>
    <div class="step">2. Get your tenant to sign and date the <strong>Proof of Service Certificate</strong></div>
    <div class="step">3. Keep the signed certificate safely — you will need it as legal proof if challenged</div>
    ${isBundle ? '<div class="step">4. Complete the <strong>Tenancy Agreement</strong> with your property details and send to your tenant for signing</div>' : ''}
    <br>
    <a href="https://www.compliantuk.co.uk/dashboard.html" class="btn">View Your Dashboard</a>
    <p style="color:#64748b;font-size:13px;margin-top:24px">Questions? Contact <a href="mailto:support@compliantuk.co.uk">support@compliantuk.co.uk</a></p>
  </div>
  <div class="footer">
    <p><strong>CompliantUK</strong> — The UK landlord compliance platform</p>
    <p>compliantuk.co.uk | support@compliantuk.co.uk</p>
    <p style="margin-top:8px;font-size:11px">Ref: ${referenceNumber}</p>
  </div>
</div>
</body>
</html>`;

    // 4. Send via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CompliantUK Documents <documents@compliantuk.co.uk>',
        to: [customerEmail],
        bcc: ['huseyin.turkay@compliantuk.co.uk'],
        subject: `Your Compliance Documents — ${propertyAddress} [${referenceNumber}]`,
        html: emailHtml,
        attachments,
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
