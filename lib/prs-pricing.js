// lib/prs-pricing.js
// Shared pricing + date rules for the Rental Property Register service (Phase 2).
// Used by api/create-checkout.js, api/stripe-webhook.js, api/send-reminders.js and tests.

// register_ready: £29 per property, one-off.
// monitor: £29 per property set-up + £2.50 per property per month.
export const PRS_PRODUCTS = {
  register_ready: { setupPence: 2900, monthlyPence: 0, label: 'Register-Ready' },
  monitor: { setupPence: 2900, monthlyPence: 250, label: 'Ready + Monitor' },
};

export const MAX_PROPERTIES = 500;

export function prsQuote(product, properties) {
  const p = PRS_PRODUCTS[product];
  const n = Number(properties);
  if (!p || !Number.isInteger(n) || n < 1 || n > MAX_PROPERTIES) return null;
  return { product, label: p.label, properties: n, setup: p.setupPence * n, monthly: p.monthlyPence * n };
}

// Days before expiry at which alerts are sent (Monitor plan)
export const ALERT_DAYS = [60, 30, 7];

// The GOV.UK service requires records to be completed / updated within 28 days
export const RECORD_DEADLINE_DAYS = 28;
export const DEADLINE_ALERT_DAYS = [14, 7, 2];

export function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...ymd(fromIso));
  const b = Date.UTC(...ymd(toIso));
  return Math.round((b - a) / 86400000);
}

function ymd(d) {
  const s = typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  return [y, m - 1, day];
}

export function addDays(iso, days) {
  const [y, m, d] = ymd(iso);
  return new Date(Date.UTC(y, m, d + days)).toISOString().slice(0, 10);
}

// Which alert threshold (if any) is due for an item expiring on `expiresOn`,
// given thresholds already sent. Returns the smallest threshold reached that
// has not yet been sent, so a late-uploaded certificate gets one alert, not three.
export function dueAlert(todayIso, expiresOn, alreadySent = [], thresholds = ALERT_DAYS) {
  if (!expiresOn) return null;
  const left = daysBetween(todayIso, expiresOn);
  const reached = thresholds.filter(t => left <= t);
  if (!reached.length) return null;
  const threshold = Math.min(...reached);
  if (alreadySent.includes(threshold)) return null;
  return { threshold, daysLeft: left };
}
