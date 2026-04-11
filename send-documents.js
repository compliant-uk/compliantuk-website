import { generateComplianceCertificate } from './generate-certificate.js';

const INFO_SHEET_URL = 'https://raw.githubusercontent.com/compliant-uk/compliantuk-website/main/The_Renters__Rights_Act_Information_Sheet_2026.pdf';

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
    const { customerEmail, customerName, propertyAddress, tenantName, tenantEmail, plan, paymentReference } = req.body;
    if (!customerEmail || !propertyAddress) return res.status(400).json({ error: 'Missing required fields' });

    // 1. Generate compliance certificate
    const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
      landlordName: customerName,
      propertyAddress,
      tenantName: tenantName || null,
      plan,
      paymentReference,
    });
    const certificateBase64 = Buffer.from(pdfBytes).toString('base64');

    // 2. Fetch Information Sheet
    let infoSheetBase64 = null;
    try {
      infoSheetBase64 = await fetchPdfAsBase64(INFO_SHEET_URL);
    } catch(e) { console.error('Info sheet fetch failed:', e.message); }

    // ── LANDLORD EMAIL ────────────────────────────────────────────────────
    const landlordAttachments = [
      { filename: `CompliantUK-Certificate-${referenceNumber}.pdf`, content: certificateBase64 }
    ];
    if (infoSheetBase64) {
      landlordAttachments.push({ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: infoSheetBase64 });
    }

    const landlordHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
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
      ${tenantName ? `<span>Tenant: ${tenantName}</span>` : ''}
    </div>
    <p>Your compliance documents are <strong>attached to this email as PDFs</strong>. Please download and keep them safely.</p>
    <div class="alert-box">
      <p><strong>Important deadline:</strong> The Renters Rights Act comes into force May 2026. You must serve the Information Sheet on your tenant before this date to avoid fines of up to <strong>£7,000 per tenant</strong>.</p>
    </div>
    <div class="doc-list">
      <p style="margin:0 0 12px;font-weight:bold;color:#1a1a2e">Documents attached:</p>
      <div class="doc-item">
        <div class="doc-name">1. Proof of Compliance Certificate</div>
        <div class="doc-desc">Your legal record — get your tenant to sign and date this. Keep the signed copy safely.</div>
      </div>
      <div class="doc-item">
        <div class="doc-name">2. Renters Rights Act Information Sheet (Official Government Document)</div>
        <div class="doc-desc">${tenantName && tenantEmail ? `This has also been sent directly to your tenant (${tenantName}) by email.` : 'Please forward or print and hand to your tenant.'}</div>
      </div>
    </div>
    <p style="font-weight:bold;margin-bottom:12px">What to do now:</p>
    <div class="step">1. Ask your tenant to sign and date the <strong>Proof of Service Certificate</strong></div>