import { readFileSync } from 'fs';
import vm from 'vm';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  ✅ ${name}`);
      passed++;
      results.push({ name, status: 'PASS' });
    } else {
      console.log(`  ❌ ${name}: ${result}`);
      failed++;
      results.push({ name, status: 'FAIL', detail: result });
    }
  } catch (error) {
    console.log(`  ❌ ${name}: ${error.message}`);
    failed++;
    results.push({ name, status: 'FAIL', detail: error.message });
  }
}

function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines.shift().split(',').map(h => h.trim());
  return lines.map(line => {
    const values = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { values.push(current); current = ''; continue; }
      current += ch;
    }
    values.push(current);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function extractFunction(code, functionName) {
  const start = code.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`${functionName} not found`);
  let brace = code.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') depth--;
    if (depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`${functionName} body not closed`);
}

const bulkUploadHtml = readFileSync('bulk-upload.html', 'utf8');
const parsePropertyDataSource = extractFunction(bulkUploadHtml, 'parsePropertyData');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${parsePropertyDataSource}; this.parsePropertyData = parsePropertyData;`, sandbox);
const parsePropertyData = sandbox.parsePropertyData;

console.log('\n📥 BULK TEMPLATE AND PARSER FLOW TESTS');
const csvText = readFileSync('templates/compliantuk-portfolio-template.csv', 'utf8');
const csvRows = parseCsv(csvText);
const templateResult = parsePropertyData(csvRows);

const friendlyHeadingRows = [
  {
    'Property Address': '10 Browser Upload Road',
    'Landlord First': 'Acceptance',
    'Landlord Last': 'Tester',
    'Landlord Email': 'acceptance.landlord@example.com',
    'Tenant 1 First': 'Taylor',
    'Tenant 1 Last': 'Resident',
    'Tenant 1 Email': 'taylor.resident@example.com',
  },
];
const friendlyHeadingResult = parsePropertyData(friendlyHeadingRows);

test('Bulk upload page uses the vendored SheetJS parser bundle instead of a fragile CDN path', () => {
  const vendorSource = readFileSync('assets/vendor/xlsx.full.min.js', 'utf8');
  return bulkUploadHtml.includes('src="/assets/vendor/xlsx.full.min.js"')
    && vendorSource.includes('xlsx.js')
    && bulkUploadHtml.includes('hasSpreadsheetParser()')
    || 'Vendored XLSX parser bundle or load guard missing';
});

test('Parser accepts friendly spreadsheet headings with spaces and title case', () => {
  return friendlyHeadingResult.properties.length === 1
    && friendlyHeadingResult.report.processedTenants === 1
    && friendlyHeadingResult.report.skippedCount === 0
    || JSON.stringify(friendlyHeadingResult);
});

test('CSV template includes tenant columns up to tenant6 for extra-tenant pricing', () => {
  const header = csvText.split(/\r?\n/)[0];
  return header.includes('tenant6_first') && header.includes('tenant6_email') || 'tenant6 columns missing';
});

test('CSV template parses into processable properties', () => templateResult.properties.length >= 2 || `Got ${templateResult.properties.length}`);

test('CSV template first property carries tenant first/last/email fields for webhook', () => {
  const tenant = templateResult.properties[0]?.tenants?.[0];
  return !!tenant?.first && !!tenant?.last && !!tenant?.email || JSON.stringify(tenant);
});

test('CSV template supports more than four tenants on a property', () => {
  const maxTenants = Math.max(...templateResult.properties.map(property => property.tenants.length));
  return maxTenants > 4 || `Expected >4 tenants, got ${maxTenants}`;
});

test('Valid template produces no skipped-row errors', () => templateResult.report.skippedCount === 0 || JSON.stringify(templateResult.report));

const dirtyRows = [
  { property_address: '1 Test Street', landlord_first: 'Owner', landlord_last: 'One', landlord_email: 'owner@example.com', tenant1_first: 'Valid', tenant1_last: 'Person', tenant1_email: 'valid.person@example.com', tenant2_first: 'Invalid', tenant2_last: 'Email', tenant2_email: 'bad-email' },
  { property_address: '', landlord_first: 'Owner', landlord_last: 'Two', landlord_email: 'owner2@example.com', tenant1_first: 'No', tenant1_last: 'Address', tenant1_email: 'no.address@example.com' },
  { property_address: '3 Test Street', landlord_first: 'Owner', landlord_last: 'Three', landlord_email: 'owner3@example.com', tenant1_first: '', tenant1_last: '', tenant1_email: '' },
];
const dirtyResult = parsePropertyData(dirtyRows);

test('Dirty upload processes valid tenants while omitting invalid rows', () => dirtyResult.properties.length === 1 && dirtyResult.report.processedTenants === 1 || JSON.stringify(dirtyResult));

test('Dirty upload reports skipped missing address, invalid email, and no-tenant rows before payment', () => {
  const reasons = dirtyResult.report.issues.map(issue => issue.reason).join(' | ');
  return dirtyResult.report.skippedCount >= 3 && reasons.includes('Missing property_address') && reasons.includes('invalid email') && reasons.includes('no valid tenants') || reasons;
});

console.log('\n💳 BULK CHECKOUT AND WEBHOOK STATIC CONTRACT TESTS');
const bulkCheckout = readFileSync('api/create-bulk-checkout.js', 'utf8');
const webhook = readFileSync('api/stripe-webhook.js', 'utf8');
const schema = readFileSync('SUPABASE_SCHEMA.sql', 'utf8');

test('Bulk checkout requires an array of properties', () => bulkCheckout.includes('Array.isArray(properties)') || 'Missing Array.isArray(properties) validation');
test('Bulk checkout rejects zero valid tenant uploads', () => bulkCheckout.includes('No valid tenants found in uploaded file') || 'Missing zero-tenant guard');
test('Bulk checkout persists processing_report for post-payment summary emails', () => bulkCheckout.includes('processing_report: processingReport') && schema.includes('processing_report JSONB') || 'Missing processing_report persistence');
test('Stripe metadata includes tenantCount for reconciliation', () => bulkCheckout.includes('tenantCount: String(tenantCount)') || 'Missing tenantCount metadata');
test('Webhook accepts JSONB properties_data as object/array or legacy string', () => webhook.includes('function safeJson') && webhook.includes('safeJson(bulk.properties_data, [])') || 'Webhook is missing safe JSONB/string normalisation');
test('Webhook normalises tenant name/email before sending', () => webhook.includes('function normaliseTenant') && webhook.includes('t?.firstName') && webhook.includes('t?.lastName') && webhook.includes("if (!t.email) throw new Error('Tenant email missing')") || 'Missing tenant normalisation/guard');
test('Webhook normalises processing_report for post-payment landlord email', () => webhook.includes('function normaliseProcessingReport') && webhook.includes('normaliseProcessingReport(bulk.processing_report, props)') || 'Missing processing report normalisation');
test('Webhook creates unique child order session references for each bulk property', () => webhook.includes('childSessionId') && webhook.includes('`${session.id}:bulk:${index + 1}`') && webhook.includes('stripe_session_id:childSessionId') || 'Bulk property orders reuse the unique checkout session ID');
test('Webhook treats duplicate completed bulk checkout webhooks as idempotent success', () => webhook.includes('existingChildOrderCount === childSessionIds.length') && webhook.includes("idempotent:true") && webhook.includes("update({status:'processed',stripe_session_id:session.id,paid_at:paidAt})") || 'Missing duplicate-webhook idempotency guard before child inserts');
test('Webhook fails bulk order status when child order insertion fails', () => webhook.includes('error:orderError') && webhook.includes('Bulk order insert failed for property') && webhook.includes("update({status:'failed'})") || 'Bulk insert errors are not surfaced to bulk_orders.status');
test('Landlord confirmation email highlights omitted rows needing immediate attention', () => webhook.includes('Bulk upload processing summary') && webhook.includes('need immediate attention') && webhook.includes('processingReport=null') || 'Missing skipped-row/immediate-attention email summary');

console.log('\n' + '='.repeat(60));
console.log(`BULK FLOW TEST SUMMARY: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\nFAILED BULK FLOW TESTS:');
  results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  FAIL: ${r.name}: ${r.detail || ''}`));
}

process.exit(failed > 0 ? 1 : 0);
