// api/paypal-webhook.js
// Fixed: null-guard on infoSheetBase64 before tenant email attachment
import { generateComplianceCertificate } from './generate-certificate.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const INFO_SHEET_URL = 'https://raw.githubusercontent.com/compliant-uk/compliantuk-website/main/The_Renters__Rights_Act_Information_Sheet_2026.pdf';

async function fetchPdfAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

async function sendEmail({ to, from, subject, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, attachments }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Email service not configured' });

  try {
    const { orderId, customerName, customerEmail, propertyAddress, tenants, amount } = req.body;

    if (!customerEmail || !propertyAddress) {
      return res.status(400).json({ error: 'Missing required fields: customerEmail and propertyAddress' });
    }
    if (!Array.isArray(tenants) || tenants.length === 0) {
      return res.status(400).json({ error: 'Missing tenants array' });
    }

    // Fetch the Info Sheet once — fail gracefully if unavailable
    let infoSheetBase64 = null;
    try {
      infoSheetBase64 = await fetchPdfAsBase64(INFO_SHEET_URL);
    } catch (e) {
      console.error('Info sheet fetch failed (non-fatal):', e.message);
    }

    const results = [];

    for (const tenant of tenants) {
      if (!tenant.email || !tenant.name) {
        console.warn('Skipping tenant with missing name/email:', tenant);
        continue;
      }

      const { pdfBytes, referenceNumber } = await generateComplianceCertificate({
        landlordName: customerName,
        propertyAddress,
        tenantName: tenant.name,
        plan: 'starter',
        paymentReference: orderId,
      });

      const certificateBase64 = Buffer.from(pdfBytes).toString('base64');

      // ── LANDLORD EMAIL ─────────────────────────────────────────────────
      const landlordAttachments = [
        { filename: `CompliantUK-Certificate-${referenceNumber}.pdf`, content: certificateBase64 },
      ];
      if (infoSheetBase64) {
        landlordAttachments.push({
          filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf',
          content: infoSheetBase64,
        });
      }

      await sendEmail({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: customerEmail,
        subject: `Your Compliance Documents — ${propertyAddress} (${tenant.name})`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a2e;">
          <p>Dear ${customerName || 'Landlord'},</p>
          <p>Your compliance documents for <strong>${propertyAddress}</strong> are attached.</p>
          <p><strong>Tenant:</strong> ${tenant.name} &nbsp;|&nbsp; <strong>Reference:</strong> ${referenceNumber}</p>
          <p>Please ask your tenant to sign and date the Proof of Service Certificate and return a copy to you.</p>
          ${!infoSheetBase64 ? '<p style="color:#b45309;"><strong>Note:</strong> The Information Sheet could not be auto-attached. Please download from GOV.UK and forward to your tenant.</p>' : ''}
          <p>Regards,<br>CompliantUK</p>
        </div>`,
        attachments: landlordAttachments,
      });

      // ── TENANT EMAIL ───────────────────────────────────────────────────
      // Only include attachments that are non-null
      const tenantAttachments = [];
      if (infoSheetBase64) {
        tenantAttachments.push({
          filename: 'Renters-Rights-Act-Information-Sheet-2026.pdf',
          content: infoSheetBase64,
        });
      }

      await sendEmail({
        from: 'CompliantUK <noreply@compliantuk.co.uk>',
        to: tenant.email,
        subject: "Renters' Rights Act 2025 — Information Sheet from your landlord",
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a2e;">
          <p>Dear ${tenant.name},</p>
          <p>Your landlord <strong>${customerName || 'your landlord'}</strong> has used CompliantUK to provide you with the official Renters' Rights Act 2025 Information Sheet for the property at <strong>${propertyAddress}</strong>.</p>
          ${infoSheetBase64
            ? "<p>The official Information Sheet is attached as a PDF. Please read it carefully — it explains your rights under the Renters' Rights Act 2025.</p>"
            : "<p>Your landlord will provide you with the official Information Sheet separately. If you have not received it within 24 hours, please contact your landlord.</p>"
          }
          <p>Regards,<br>CompliantUK &mdash; <a href="https://compliantuk.co.uk">compliantuk.co.uk</a></p>
        </div>`,
        attachments: tenantAttachments,
      });

      results.push({ tenant: tenant.name, referenceNumber });
    }

    return res.status(200).json({ success: true, orderId, processed: results });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return res.status(500).json({ error: 'Payment processing failed', detail: error.message });
  }
}
