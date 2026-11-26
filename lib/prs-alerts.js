// lib/prs-alerts.js
// Daily Monitor-plan alerts for the Rental Property Register service, called from api/send-reminders.js.
//  - certificate expiry alerts at 60, 30 and 7 days, plus an "expired — update within 28 days" alert
//  - 28-day record completion reminders at 14, 7 and 2 days, plus a missed-deadline alert
//  - annual government fee renewal reminder 30 days before
//  - daily re-sync of Stripe subscription status (fallback if webhook events are not enabled)
import { dueAlert, addDays, ALERT_DAYS } from './prs-pricing.js';

const LABEL = { gas: 'Gas safety certificate', eicr: 'Electrical safety report (EICR)', epc: 'Energy Performance Certificate', licence: 'Property / HMO licence', deposit: 'Deposit protection certificate', how_to_rent: 'Tenancy document', other: 'Document' };
const CERT_THRESHOLDS = [...ALERT_DAYS, 0];
const DEADLINE_THRESHOLDS = [14, 7, 2, 0];
const BASE = 'https://www.compliantuk.co.uk';

function esc(s) { return `${s ?? ''}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmt(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function mapSub(s) { return s === 'active' || s === 'trialing' ? 'active' : (s === 'past_due' || s === 'unpaid' || s === 'incomplete') ? 'past_due' : 'canceled'; }

export async function runPrsAlerts({ sb, resend, stripe, today = new Date().toISOString().slice(0, 10), dryRun = false }) {
  const out = { synced: 0, emails: 0, items: 0, errors: [] };

  // 1. Re-sync subscription status
  if (stripe) {
    const { data: subs } = await sb.from('prs_entitlements').select('id, stripe_subscription_id, status').not('stripe_subscription_id', 'is', null).neq('status', 'canceled').limit(500);
    for (const e of subs || []) {
      try {
        const sub = await stripe.subscriptions.retrieve(e.stripe_subscription_id);
        const status = mapSub(sub.status);
        const t = sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
        if (status !== e.status || t) {
          await sb.from('prs_entitlements').update({ status, current_period_end: t ? new Date(t * 1000).toISOString() : null, updated_at: new Date().toISOString() }).eq('id', e.id);
          out.synced++;
        }
      } catch (err) { out.errors.push(`sub ${e.id}: ${err.message}`); }
    }
  }

  // 2. Who has an active Monitor plan
  const { data: mons } = await sb.from('prs_entitlements').select('user_id').eq('product', 'monitor').eq('status', 'active').limit(5000);
  const users = [...new Set((mons || []).map(m => m.user_id))];
  if (!users.length) return out;

  const { data: props } = await sb.from('prs_properties').select('id, user_id, address, postcode, record_started_on, record_completed, deadline_alerts_sent').in('user_id', users).limit(10000);
  const propById = Object.fromEntries((props || []).map(p => [p.id, p]));
  const { data: certs } = await sb.from('prs_certificates').select('id, user_id, property_id, cert_type, expires_on, alerts_sent').in('user_id', users).not('expires_on', 'is', null).lte('expires_on', addDays(today, 60)).gte('expires_on', addDays(today, -28)).limit(10000);

  const perUser = {};
  const push = (uid, item) => { (perUser[uid] ||= []).push(item); };
  const certUpdates = [], propUpdates = [];

  for (const c of certs || []) {
    const due = dueAlert(today, c.expires_on, c.alerts_sent || [], CERT_THRESHOLDS);
    if (!due) continue;
    const p = propById[c.property_id];
    const what = LABEL[c.cert_type] || 'Certificate';
    const text = due.daysLeft < 0 || due.threshold === 0
      ? `${what} expired on ${fmt(c.expires_on)}. Renew it and update the register by ${fmt(addDays(c.expires_on, 28))}.`
      : `${what} expires in ${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'} (${fmt(c.expires_on)}). Book the renewal now.`;
    push(c.user_id, { address: p?.address || 'Your property', text, urgent: due.threshold <= 7 });
    certUpdates.push({ id: c.id, alerts_sent: [...new Set([...(c.alerts_sent || []), ...CERT_THRESHOLDS.filter(t => t >= due.threshold)])] });
  }

  for (const p of props || []) {
    if (!p.record_started_on || p.record_completed) continue;
    const deadline = addDays(p.record_started_on, 28);
    const due = dueAlert(today, deadline, p.deadline_alerts_sent || [], DEADLINE_THRESHOLDS);
    if (!due || due.daysLeft < -14) continue;
    const text = due.daysLeft < 0
      ? `The 28-day deadline to complete this property record was ${fmt(deadline)}. Add the outstanding information on GOV.UK now to avoid deactivation.`
      : `Complete this property record on GOV.UK by ${fmt(deadline)} (${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'} left): certificates, tenancy and rent details, and any licence.`;
    push(p.user_id, { address: p.address, text, urgent: due.threshold <= 2 });
    propUpdates.push({ id: p.id, deadline_alerts_sent: [...new Set([...(p.deadline_alerts_sent || []), ...DEADLINE_THRESHOLDS.filter(t => t >= due.threshold)])] });
  }

  // Annual renewal: 1 year from the first property registration, reminder 30 days before
  const firstReg = {};
  for (const p of props || []) if (p.record_started_on && (!firstReg[p.user_id] || p.record_started_on < firstReg[p.user_id])) firstReg[p.user_id] = p.record_started_on;
  for (const [uid, first] of Object.entries(firstReg)) {
    const [y, m, d] = first.split('-').map(Number);
    let renewal = new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
    while (renewal < today) { const [ry, rm, rd] = renewal.split('-').map(Number); renewal = new Date(Date.UTC(ry + 1, rm - 1, rd)).toISOString().slice(0, 10); }
    const left = Math.round((Date.parse(renewal) - Date.parse(today)) / 86400000);
    if (left === 30 || left === 7) push(uid, { address: 'All properties', text: `Your annual Register your rental property renewal is due on ${fmt(renewal)} (£65 per property, paid on GOV.UK).`, urgent: left === 7 });
  }

  // 3. One digest email per user
  for (const [uid, items] of Object.entries(perUser)) {
    out.items += items.length;
    if (dryRun) { out.emails++; continue; }
    try {
      const { data: u } = await sb.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) continue;
      const urgent = items.some(i => i.urgent);
      await resend.emails.send({
        from: 'CompliantUK <noreply@compliantuk.co.uk>', reply_to: 'support@compliantuk.co.uk', to: email,
        subject: `${urgent ? 'Action needed: ' : ''}${items.length} rental register reminder${items.length === 1 ? '' : 's'}`,
        html: digestHtml(items),
      });
      out.emails++;
    } catch (err) { out.errors.push(`email ${uid}: ${err.message}`); continue; }
  }
  if (!dryRun) {
    for (const u of certUpdates) await sb.from('prs_certificates').update({ alerts_sent: u.alerts_sent }).eq('id', u.id);
    for (const u of propUpdates) await sb.from('prs_properties').update({ deadline_alerts_sent: u.deadline_alerts_sent }).eq('id', u.id);
  }
  return out;
}

export function digestHtml(items) {
  const rows = items.map(i => `<tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:14px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${i.urgent ? '#ef4444' : '#f59e0b'}"></span></td><td style="padding:12px 0 12px 8px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155;line-height:1.6"><strong style="color:#0f172a">${esc(i.address)}</strong><br>${esc(i.text)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="background:#080c14;border-radius:12px 12px 0 0;padding:24px 32px"><div style="font-weight:700;font-size:17px;color:#fff;margin-bottom:10px">Compliant<span style="color:#60a5fa">UK</span> Monitor</div><h1 style="margin:0;font-size:21px;color:#fff">Your rental register reminders</h1></td></tr><tr><td style="background:#fff;padding:24px 32px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table><p style="margin:22px 0 0"><a href="${BASE}/login?next=register" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open your Register workspace</a></p><p style="margin:18px 0 0;font-size:12px;color:#64748b">GOV.UK requires changes and expired certificates to be updated on the register within 28 days. You're receiving this because your CompliantUK Ready + Monitor plan is active.</p></td></tr></table></td></tr></table></body></html>`;
}
