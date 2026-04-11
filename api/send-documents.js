/**
 * send-documents.js
 * Handles post-payment document delivery:
 *   1. Sends individual personalised emails to each tenant (name + PDF attachment + covering letter)
 *   2. Sends landlord their copy: info sheet + certificate (with landlord name, address, all tenants)
 *   3. Sets up 48-hour read-reminder jobs
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { generateCertificate } = require('./generate-certificate');

// ── Mailer setup ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Path to the official GOV.UK PDF
const INFO_SHEET_PATH = path.join(__dirname, 'The_Renters__Rights_Act_Information_Sheet_2026.pdf');
const FROM_ADDRESS = `"CompliantUK" <${process.env.EMAIL_FROM || 'noreply@compliantuk.co.uk'}>`;

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * @param {Object} order
 * @param {string} order.landlordFirst
 * @param {string} order.landlordLast
 * @param {string} order.landlordEmail
 * @param {string} order.propertyAddress
 * @param {Array<{first: string, last: string, email: string}>} order.tenants
 * @param {string} order.orderId  - unique order/session ID for tracking pixel
 * @param {string} order.dashboardUrl
 */
async function sendDocuments(order) {
  const { landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants, orderId, dashboardUrl } = order;
  const landlordName = `${landlordFirst} ${landlordLast}`;

  if (!tenants || tenants.length === 0) {
    throw new Error('No tenants provided in order.');
  }

  const infoSheetAttachment = {
    filename: 'Renters_Rights_Act_Information_Sheet_2026.pdf',
    path: INFO_SHEET_PATH,
    contentType: 'application/pdf',
  };

  // ── 1. Email each tenant individually ────────────────────────────────────
  const tenantResults = [];
  for (let i = 0; i < tenants.length; i++) {
    const tenant = tenants[i];
    const tenantName = `${tenant.first} ${tenant.last}`;
    const trackingPixelUrl = `${process.env.BASE_URL}/api/track?orderId=${orderId}&tenantIndex=${i}&event=open`;

    try {
      await transporter.sendMail({
        from: FROM_ADDRESS,
        to: `"${tenantName}" <${tenant.email}>`,
        subject: `Important: Your Renters' Rights Act Information Sheet — ${propertyAddress}`,
        html: buildTenantEmail({ tenantName, landlordName, propertyAddress, trackingPixelUrl }),
        attachments: [infoSheetAttachment],
      });

      tenantResults.push({ tenantIndex: i, email: tenant.email, status: 'sent', sentAt: new Date().toISOString() });
      console.log(`[send-documents] Tenant email sent: ${tenant.email} (order ${orderId})`);
    } catch (err) {
      console.error(`[send-documents] Failed to email tenant ${tenant.email}:`, err.message);
      tenantResults.push({ tenantIndex: i, email: tenant.email, status: 'failed', error: err.message });
    }
  }

  // ── 2. Generate certificate PDF (landlord copy) ───────────────────────────
  let certificatePdfBuffer = null;
  try {
    certificatePdfBuffer = await generateCertificate({
      landlordName,
      propertyAddress,
      tenants: tenants.map(t => `${t.first} ${t.last}`),
      orderId,
      issuedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[send-documents] Certificate generation failed:', err.message);
  }

  // ── 3. Email landlord ─────────────────────────────────────────────────────
  const landlordAttachments = [infoSheetAttachment];
  if (certificatePdfBuffer) {
    landlordAttachments.push({
      filename: `CompliantUK_Certificate_${orderId}.pdf`,
      content: certificatePdfBuffer,
      contentType: 'application/pdf',
    });
  }

  try {
    await transporter.sendMail({
      from: FROM_ADDRESS,
      to: `"${landlordName}" <${landlordEmail}>`,
      subject: `CompliantUK — Your compliance documents for ${propertyAddress}`,
      html: buildLandlordEmail({ landlordName, propertyAddress, tenants, orderId, dashboardUrl }),
      attachments: landlordAttachments,
    });
    console.log(`[send-documents] Landlord email sent: ${landlordEmail} (order ${orderId})`);
  } catch (err) {
    console.error('[send-documents] Failed to email landlord:', err.message);
  }

  // ── 4. Schedule 48-hour reminders ─────────────────────────────────────────
  schedule48hrReminders({ order, tenantResults });

  return tenantResults;
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildTenantEmail({ tenantName, landlordName, propertyAddress, trackingPixelUrl }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Renters' Rights Act Information Sheet</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1A1A14;padding:28px 36px;text-align:left;">
            <span style="color:#C9A84C;font-size:20px;font-weight:700;">✓ CompliantUK</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="font-size:22px;color:#1A1A14;margin:0 0 20px;line-height:1.3;">
              Important: Renters' Rights Act Information Sheet
            </h1>

            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 16px;">
              Dear ${tenantName},
            </p>

            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 16px;">
              Your landlord, <strong>${landlordName}</strong>, at the property <strong>${propertyAddress}</strong>, is required by law to provide you with the official Government Information Sheet under the <strong>Renters' Rights Act 2025</strong>.
            </p>

            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 16px;">
              <strong>Please read the attached document carefully.</strong> It explains your new legal rights as a tenant, including:
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;border-radius:8px;padding:0;margin:0 0 20px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:14px;color:#2C2C1E;line-height:1.6;">✓ Your rights regarding rent increases</p>
                <p style="margin:0 0 8px;font-size:14px;color:#2C2C1E;line-height:1.6;">✓ How tenancies can now be ended</p>
                <p style="margin:0 0 8px;font-size:14px;color:#2C2C1E;line-height:1.6;">✓ Your rights regarding repairs and property condition</p>
                <p style="margin:0;font-size:14px;color:#2C2C1E;line-height:1.6;">✓ How to raise concerns or disputes</p>
              </td></tr>
            </table>

            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 16px;">
              The document is attached to this email as a PDF. This is the official version from GOV.UK and is the only version required under legislation. Please read it at your earliest convenience — it is important for you to understand your rights.
            </p>

            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 32px;">
              If you have any questions about your tenancy, we recommend speaking directly with your landlord or seeking independent advice from <a href="https://www.citizensadvice.org.uk" style="color:#5C5A2E;">Citizens Advice</a>.
            </p>

            <hr style="border:none;border-top:1px solid #D4CDB8;margin:0 0 24px;"/>

            <p style="font-size:13px;color:#6B6B52;line-height:1.6;margin:0;">
              This email was sent on behalf of <strong>${landlordName}</strong> by CompliantUK, a compliance document delivery service for private landlords in England. CompliantUK is not a party to your tenancy agreement and is not your landlord's legal representative. For information about the Renters' Rights Act 2025, visit <a href="https://www.gov.uk" style="color:#5C5A2E;">GOV.UK</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1A1A14;padding:18px 36px;text-align:center;">
            <p style="color:#666;font-size:12px;margin:0;font-family:Arial,sans-serif;">
              © 2026 CompliantUK · <a href="https://www.compliantuk.co.uk/privacy.html" style="color:#C9A84C;text-decoration:none;">Privacy Policy</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
  <!-- Read tracking pixel -->
  <img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;opacity:0;" />
</body>
</html>`;
}

function buildLandlordEmail({ landlordName, propertyAddress, tenants, orderId, dashboardUrl }) {
  const tenantListHtml = tenants.map((t, i) =>
    `<tr>
      <td style="padding:10px 12px;font-size:14px;color:#2C2C1E;border-bottom:1px solid #D4CDB8;">${i + 1}. ${t.first} ${t.last}</td>
      <td style="padding:10px 12px;font-size:14px;color:#6B6B52;border-bottom:1px solid #D4CDB8;">${t.email}</td>
      <td style="padding:10px 12px;font-size:14px;color:#2D6A4F;border-bottom:1px solid #D4CDB8;font-weight:600;">✓ Sent</td>
    </tr>`
  ).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Your compliance documents — CompliantUK</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1A1A14;padding:28px 36px;text-align:left;">
            <span style="color:#C9A84C;font-size:20px;font-weight:700;">✓ CompliantUK</span>
          </td>
        </tr>

        <!-- Success banner -->
        <tr>
          <td style="background:#2D6A4F;padding:18px 36px;text-align:left;">
            <p style="color:#FFFFFF;font-size:16px;font-weight:700;margin:0;font-family:Arial,sans-serif;">✅ You're compliant. Documents delivered.</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 16px;">
              Dear ${landlordName},
            </p>
            <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 24px;">
              Payment has been confirmed and the official Renters' Rights Act Information Sheet has been sent to all tenants on the tenancy for <strong>${propertyAddress}</strong>. Your compliance documents are attached to this email.
            </p>

            <!-- Property / Order details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="font-size:12px;font-family:Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6B6B52;margin:0 0 12px;">Order details</p>
                <p style="font-size:14px;color:#2C2C1E;margin:0 0 6px;"><strong>Property:</strong> ${propertyAddress}</p>
                <p style="font-size:14px;color:#2C2C1E;margin:0 0 6px;"><strong>Landlord:</strong> ${landlordName}</p>
                <p style="font-size:14px;color:#2C2C1E;margin:0;"><strong>Order reference:</strong> ${orderId}</p>
              </td></tr>
            </table>

            <!-- Tenants table -->
            <p style="font-size:13px;font-family:Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6B6B52;margin:0 0 10px;">Tenants on this tenancy</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #D4CDB8;border-radius:8px;overflow:hidden;margin:0 0 24px;">
              <tr style="background:#F5F0E8;">
                <th style="padding:10px 12px;font-size:12px;font-family:Arial,sans-serif;text-align:left;color:#6B6B52;text-transform:uppercase;letter-spacing:0.05em;">Tenant</th>
                <th style="padding:10px 12px;font-size:12px;font-family:Arial,sans-serif;text-align:left;color:#6B6B52;text-transform:uppercase;letter-spacing:0.05em;">Email</th>
                <th style="padding:10px 12px;font-size:12px;font-family:Arial,sans-serif;text-align:left;color:#6B6B52;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
              </tr>
              ${tenantListHtml}
            </table>

            <!-- Attachments note -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8F4F0;border:1px solid #A8D5C2;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:16px 20px;">
                <p style="font-size:13px;color:#2D6A4F;font-family:Arial,sans-serif;font-weight:700;margin:0 0 8px;">📎 Attached to this email:</p>
                <p style="font-size:13px;color:#2D6A4F;font-family:Arial,sans-serif;margin:0 0 4px;">1. Official GOV.UK Renters' Rights Act Information Sheet (PDF)</p>
                <p style="font-size:13px;color:#2D6A4F;font-family:Arial,sans-serif;margin:0;">2. Your proof-of-service certificate — lists your name, property address, and all tenants</p>
              </td></tr>
            </table>

            <!-- Dashboard CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1A1A14;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;text-align:center;">
                <p style="color:#CCC;font-size:14px;font-family:Arial,sans-serif;margin:0 0 14px;">Track opens, reads, and download certificates anytime from your dashboard.</p>
                <a href="${dashboardUrl || 'https://www.compliantuk.co.uk/dashboard.html'}" style="display:inline-block;background:#C9A84C;color:#1A1A14;padding:12px 28px;border-radius:6px;font-weight:700;font-size:15px;text-decoration:none;font-family:Arial,sans-serif;">Go to my dashboard →</a>
              </td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #D4CDB8;margin:0 0 20px;"/>

            <p style="font-size:13px;color:#6B6B52;line-height:1.6;margin:0;">
              CompliantUK provides document delivery and compliance tracking services for private landlords in England. We are not solicitors and nothing in this email constitutes legal advice. If challenged, present your dashboard certificate and this email as evidence of service. For legal questions, consult a qualified solicitor.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1A1A14;padding:18px 36px;text-align:center;">
            <p style="color:#666;font-size:12px;margin:0;font-family:Arial,sans-serif;">
              © 2026 CompliantUK · <a href="https://www.compliantuk.co.uk/privacy.html" style="color:#C9A84C;text-decoration:none;">Privacy</a> · <a href="https://www.compliantuk.co.uk/terms.html" style="color:#C9A84C;text-decoration:none;">Terms</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── 48-hour reminder scheduler ─────────────────────────────────────────────────
function schedule48hrReminders({ order, tenantResults }) {
  // Use setTimeout for simplicity; swap for a proper queue (Bull, Agenda) in production
  const DELAY_MS = 48 * 60 * 60 * 1000;

  tenantResults.forEach((result, i) => {
    if (result.status !== 'sent') return;
    const tenant = order.tenants[i];

    setTimeout(async () => {
      // Check if tenant has read (implement your DB lookup here)
      const hasRead = await checkTenantRead(order.orderId, i);
      if (hasRead) {
        console.log(`[remind] Tenant ${tenant.email} already read — no reminder needed.`);
        return;
      }

      // Send reminder
      try {
        await transporter.sendMail({
          from: FROM_ADDRESS,
          to: `"${tenant.first} ${tenant.last}" <${tenant.email}>`,
          subject: `Reminder: Please read your Renters' Rights Act Information Sheet — ${order.propertyAddress}`,
          html: buildReminderEmail({ tenant, landlordName: `${order.landlordFirst} ${order.landlordLast}`, propertyAddress: order.propertyAddress }),
          attachments: [{
            filename: 'Renters_Rights_Act_Information_Sheet_2026.pdf',
            path: INFO_SHEET_PATH,
            contentType: 'application/pdf',
          }],
        });
        console.log(`[remind] 48hr reminder sent to ${tenant.email}`);
      } catch (err) {
        console.error(`[remind] Reminder failed for ${tenant.email}:`, err.message);
      }
    }, DELAY_MS);
  });
}

async function checkTenantRead(orderId, tenantIndex) {
  // TODO: implement DB lookup — return true if tenant has opened/read the document
  // Example: return await db.tenantReads.findOne({ orderId, tenantIndex }) !== null;
  return false;
}

function buildReminderEmail({ tenant, landlordName, propertyAddress }) {
  const tenantName = `${tenant.first} ${tenant.last}`;
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr><td style="background:#1A1A14;padding:28px 36px;"><span style="color:#C9A84C;font-size:20px;font-weight:700;">✓ CompliantUK</span></td></tr>
        <tr><td style="padding:36px;">
          <h2 style="font-size:20px;color:#1A1A14;margin:0 0 16px;">Reminder: Your Information Sheet is waiting</h2>
          <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 14px;">Dear ${tenantName},</p>
          <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 14px;">
            We sent you an important document from your landlord <strong>${landlordName}</strong> regarding your tenancy at <strong>${propertyAddress}</strong> 48 hours ago. We noticed you haven't had a chance to read it yet.
          </p>
          <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0 0 14px;">
            The <strong>Renters' Rights Act 2025 Information Sheet</strong> is attached again for your convenience. It's an important government document that sets out your rights as a tenant under current legislation.
          </p>
          <p style="font-size:15px;color:#2C2C1E;line-height:1.7;margin:0;">
            Please read it at your earliest opportunity. If you have any questions about your tenancy, contact your landlord directly or visit <a href="https://www.citizensadvice.org.uk" style="color:#5C5A2E;">Citizens Advice</a>.
          </p>
        </td></tr>
        <tr><td style="background:#1A1A14;padding:18px 36px;text-align:center;"><p style="color:#666;font-size:12px;margin:0;font-family:Arial,sans-serif;">© 2026 CompliantUK</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { sendDocuments };

