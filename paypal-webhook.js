// api/paypal-webhook.js
import { generateComplianceCertificate } from './generate-certificate.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const INFO_SHEET_URL = 'https://raw.githubusercontent.com/compliant-uk/compliantuk-website/main/The_Renters__Rights_Act_Information_Sheet_2026.pdf';

async function fetchPdfAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Email service not configured' });

  try {
    const { orderId, customerName, customerEmail, propertyAddress, tenants, amount } = req.body;
    if (!customerEmail || !propertyAddress) return res.status(400).json({ error: 'Missing required fields' });

    // Process each tenant
    for (const tenant of tenants) {
      const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
        landlordName: customerName,
        propertyAddress,
        tenantName: tenant.name,
        plan: 'starter',
        paymentReference: orderId,
      });

      const certificateBase64 = Buffer.from(pdfBytes).toString('base64');
      let infoSheetBase64 = null;
      try {
        infoSheetBase64 = await fetchPdfAsBase64(INFO_SHEET_URL);
      } catch(e) { console.error('Info sheet fetch failed:', e.message); }

      // Send to landlord and tenant
      const attachments = [
        { filename: `CompliantUK-Certificate-${referenceNumber}.pdf`, content: certificateBase64 }
      ];
      if (infoSheetBase64) {
        attachments.push({ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: infoSheetBase64 });
      }

      // Landlord email
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CompliantUK <noreply@compliantuk.co.uk>',
          to: customerEmail,
          subject: `Your Compliance Documents - ${propertyAddress}`,
          html: `<p>Dear ${customerName},</p><p>Your compliance documents are attached.</p>`,
          attachments: attachments
        })
      });

      // Tenant email
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CompliantUK <noreply@compliantuk.co.uk>',
          to: tenant.email,
          subject: 'Renters Rights Act Information Sheet',
          html: `<p>Dear ${tenant.name},</p><p>Please find the Information Sheet attached.</p>`,
          attachments: [{ filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf', content: infoSheetBase64 }]
        })
      });
    }

    return res.status(200).json({ success: true, orderId });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return res.status(500).json({ error: 'Payment processing failed' });
  }
}
