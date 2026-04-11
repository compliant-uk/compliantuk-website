// api/send-reminders.js
// Cron job: runs every hour, sends reminder to tenants who haven't read
// the Information Sheet within 48 hours and haven't yet received a reminder.
// Registered in vercel.json: "schedule": "0 * * * *"

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = 'https://www.compliantuk.co.uk';

export default async function handler(req, res) {
  // Allow GET (cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Find tenancies: status = 'sent', sent 48+ hours ago, no reminder yet
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: tenancies, error: fetchError } = await supabase
      .from('tenancies')
      .select('id, tenant_first, tenant_last, tenant_email, property_address, tracking_id, sent_at')
      .eq('status', 'sent')
      .eq('reminder_sent', false)
      .lt('sent_at', cutoff);

    if (fetchError) throw fetchError;

    if (!tenancies || tenancies.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No reminders due' });
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const tenancy of tenancies) {
      try {
        const trackingPixelUrl = `${BASE_URL}/api/track?id=${tenancy.tracking_id}`;

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;margin-top:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.15);padding:8px 16px;border-radius:8px;margin-bottom:16px">
      <span style="font-size:18px;font-weight:800;color:white">✓ CompliantUK</span>
    </div>
    <h1 style="color:white;font-size:22px;font-weight:700;margin:0;line-height:1.3">Reminder: Important document awaiting your attention</h1>
  </div>

  <div style="padding:36px 40px">
    <p style="font-size:16px;color:#1e293b;margin:0 0 16px">Dear ${tenancy.tenant_first},</p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 16px">
      We sent you an important legal document — the <strong>Renters' Rights Act 2025 Government Information Sheet</strong> — for your property at <strong>${tenancy.property_address}</strong>. This was sent over 48 hours ago but hasn't been opened yet.
    </p>

    <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px">
      Your landlord is required by law to provide you with this document. It explains your rights as a tenant under the Renters' Rights Act 2025 and is issued directly by the UK Government.
    </p>

    <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin:0 0 28px;border-left:4px solid #3b82f6">
      <p style="font-size:14px;color:#64748b;margin:0 0 8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Action required</p>
      <p style="font-size:15px;color:#1e293b;margin:0;line-height:1.6">Please open the original email we sent you and read the attached Government Information Sheet at your earliest convenience. Check your inbox (and spam/junk folder) for the earlier email from <strong>noreply@compliantuk.co.uk</strong>.</p>
    </div>

    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 8px">
      If you have any questions, please contact your landlord or letting agent directly. For technical issues, email <a href="mailto:support@compliantuk.co.uk" style="color:#3b82f6;text-decoration:none">support@compliantuk.co.uk</a>.
    </p>
  </div>

  <div style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
      This is an automated reminder sent on behalf of your landlord via CompliantUK.<br>
      © 2026 CompliantUK · <a href="${BASE_URL}/privacy" style="color:#94a3b8">Privacy Policy</a>
    </p>
  </div>
</div>
<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="">
</body>
</html>`;

        await resend.emails.send({
          from: 'CompliantUK <noreply@compliantuk.co.uk>',
          to: tenancy.tenant_email,
          subject: `Reminder: Important document for your tenancy at ${tenancy.property_address}`,
          html,
        });

        // Mark reminder sent
        const { error: updateError } = await supabase
          .from('tenancies')
          .update({ reminder_sent: true })
          .eq('id', tenancy.id);

        if (updateError) {
          console.error(`Failed to mark reminder_sent for tenancy ${tenancy.id}:`, updateError);
        }

        successCount++;
      } catch (emailErr) {
        console.error(`Failed to send reminder to ${tenancy.tenant_email}:`, emailErr);
        errors.push({ id: tenancy.id, email: tenancy.tenant_email, error: emailErr.message });
        failCount++;
      }
    }

    console.log(`Reminders: ${successCount} sent, ${failCount} failed`);

    return res.status(200).json({
      sent: successCount,
      failed: failCount,
      total: tenancies.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('send-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
