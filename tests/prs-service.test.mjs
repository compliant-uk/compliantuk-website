// Tests for the paid Rental Property Register service: pricing, alert scheduling, certificate parsing, digest alerts.
import { readFileSync } from 'fs';
import vm from 'vm';
import assert from 'assert/strict';
import { prsQuote, dueAlert, addDays, daysBetween } from '../lib/prs-pricing.js';
import { runPrsAlerts } from '../lib/prs-alerts.js';

const ctx = { globalThis: {}, module: { exports: {} } }; ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL('../cert-parse.js', import.meta.url), 'utf8'), ctx);
const CP = ctx.CertParse || ctx.module.exports;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ✅ ' + name); };
console.log('PRS service tests');

await t('Register-Ready quote: £29 × 3 one-off', () => { const q = prsQuote('register_ready', 3); assert.equal(q.setup, 8700); assert.equal(q.monthly, 0); });
await t('Monitor quote: £29 + £2.50/mo × 4', () => { const q = prsQuote('monitor', 4); assert.equal(q.setup, 11600); assert.equal(q.monthly, 1000); });
await t('Invalid quotes rejected', () => { assert.equal(prsQuote('monitor', 0), null); assert.equal(prsQuote('monitor', 501), null); assert.equal(prsQuote('gold', 1), null); assert.equal(prsQuote('monitor', 1.5), null); });
await t('Date helpers', () => { assert.equal(addDays('2026-12-15', 28), '2027-01-12'); assert.equal(daysBetween('2026-11-26', '2026-12-15'), 19); });
await t('dueAlert picks smallest reached threshold once', () => {
  assert.equal(dueAlert('2026-11-26', '2027-03-01'), null);
  assert.deepEqual(dueAlert('2026-11-26', '2026-12-20'), { threshold: 30, daysLeft: 24 });
  assert.equal(dueAlert('2026-11-26', '2026-12-20', [30]), null);
  assert.equal(dueAlert('2026-11-26', '2026-11-20', [60, 30, 7], [60, 30, 7, 0]).threshold, 0);
});
await t('cert-parse: gas safety record with dd/mm/yyyy', () => {
  const r = CP.extract('LANDLORD GAS SAFETY RECORD\nGas Safe Register\nDate of inspection: 12/03/2026\nNext safety check due by: 11/03/2027');
  assert.equal(r.type, 'gas'); assert.equal(r.issued, '2026-03-12'); assert.equal(r.expires, '2027-03-11');
});
await t('cert-parse: EPC rating and valid-until long date', () => {
  const r = CP.extract('Energy performance certificate (EPC)\nEnergy rating C\nValid until: 4 June 2034\nDate of assessment: 5 June 2024');
  assert.equal(r.type, 'epc'); assert.equal(r.rating, 'C'); assert.equal(r.expires, '2034-06-04');
});
await t('cert-parse: EICR detected', () => {
  const r = CP.extract('ELECTRICAL INSTALLATION CONDITION REPORT\nDate of inspection 2025-01-10\nRecommended date of next inspection 2030-01-10');
  assert.equal(r.type, 'eicr'); assert.equal(r.expires, '2030-01-10');
});

// Digest alerts with a fake Supabase
function fakeSb(tables) {
  const updates = [];
  const q = (name) => {
    let rows = [...(tables[name] || [])];
    const api = {
      select() { return api; }, limit() { return api; },
      eq(k, v) { rows = rows.filter(r => r[k] === v); return api; },
      neq(k, v) { rows = rows.filter(r => r[k] !== v); return api; },
      in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return api; },
      not(k) { rows = rows.filter(r => r[k] != null); return api; },
      lte(k, v) { rows = rows.filter(r => r[k] <= v); return api; },
      gte(k, v) { rows = rows.filter(r => r[k] >= v); return api; },
      update(obj) { return { eq: async (k, v) => { updates.push({ name, obj, [k]: v }); return {}; } }; },
      then(res) { res({ data: rows, error: null }); },
    };
    return api;
  };
  return { from: q, updates, auth: { admin: { getUserById: async id => ({ data: { user: { email: id + '@example.com' } } }) } } };
}
await t('runPrsAlerts: groups cert + 28-day alerts per Monitor user, skips Register-Ready only', async () => {
  const sb = fakeSb({
    prs_entitlements: [{ user_id: 'u1', product: 'monitor', status: 'active' }, { user_id: 'u2', product: 'register_ready', status: 'active' }],
    prs_properties: [
      { id: 'p1', user_id: 'u1', address: '1 High St', record_started_on: '2026-12-15', record_completed: false, deadline_alerts_sent: [] },
      { id: 'p2', user_id: 'u2', address: '2 Low St', record_started_on: '2026-12-15', record_completed: false, deadline_alerts_sent: [] },
    ],
    prs_certificates: [
      { id: 'c1', user_id: 'u1', property_id: 'p1', cert_type: 'gas', expires_on: '2027-01-05', alerts_sent: [] },
      { id: 'c2', user_id: 'u2', property_id: 'p2', cert_type: 'gas', expires_on: '2027-01-05', alerts_sent: [] },
    ],
  });
  const sent = [];
  const resend = { emails: { send: async m => { sent.push(m); return {}; } } };
  const out = await runPrsAlerts({ sb, resend, stripe: null, today: '2027-01-01' });
  assert.equal(out.emails, 1); assert.equal(out.items, 2);
  assert.equal(sent[0].to, 'u1@example.com'); assert.match(sent[0].html, /expires in 4 days/); assert.match(sent[0].html, /12 January 2027/);
  const cu = sb.updates.find(u => u.name === 'prs_certificates'); assert.deepEqual(cu.obj.alerts_sent.sort((a, b) => a - b), [7, 30, 60]);
  const pu = sb.updates.find(u => u.name === 'prs_properties'); assert.deepEqual(pu.obj.deadline_alerts_sent.sort((a, b) => a - b), [14]);
});
console.log(`\n${n} PRS service tests passed`);
