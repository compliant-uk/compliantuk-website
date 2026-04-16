// ============================================================
// COMPREHENSIVE PRE-FIX VALIDATION TESTS
// CompliantUK Website — Full Test Suite
// ============================================================

import { readFileSync, existsSync } from 'fs';

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
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
    results.push({ name, status: 'FAIL', detail: e.message });
  }
}

// ── FILE EXISTENCE TESTS ─────────────────────────────────────
console.log('\n📁 FILE EXISTENCE TESTS');
const requiredFiles = [
  'index.html', 'bulk.html', 'bulk-upload.html', 'about.html', 'contact.html',
  'blog.html', 'blog-post.html', 'success.html', 'login.html', 'register.html',
  'dashboard.html', 'privacy.html', 'terms.html',
  'api/contact.js', 'api/create-checkout.js', 'api/create-bulk-checkout.js',
  'api/stripe-webhook.js', 'api/subscribe.js', 'api/unsubscribe.js',
  'api/generate-certificate.js', 'api/send-documents.js', 'api/send-reminders.js',
  'api/track.js', 'vercel.json', 'package.json', 'SUPABASE_SCHEMA.sql'
];
requiredFiles.forEach(f => test(`File exists: ${f}`, () => existsSync(f) || `MISSING: ${f}`));

// ── PACKAGE.JSON TESTS ───────────────────────────────────────
console.log('\n📦 PACKAGE.JSON TESTS');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
test('type is module (ES modules)', () => pkg.type === 'module' || `Expected "module", got "${pkg.type}"`);
test('stripe dependency present', () => !!pkg.dependencies?.stripe || 'Missing stripe');
test('@supabase/supabase-js present', () => !!pkg.dependencies?.['@supabase/supabase-js'] || 'Missing supabase');
test('resend dependency present', () => !!pkg.dependencies?.resend || 'Missing resend');

// ── VERCEL.JSON TESTS ────────────────────────────────────────
console.log('\n⚙️  VERCEL.JSON TESTS');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
test('contact endpoint configured', () => !!vercel.functions?.['api/contact.js'] || 'Missing contact.js function config');
test('unsubscribe endpoint configured', () => !!vercel.functions?.['api/unsubscribe.js'] || 'Missing unsubscribe.js function config');
test('stripe-webhook configured', () => !!vercel.functions?.['api/stripe-webhook.js'] || 'Missing stripe-webhook.js function config');
test('create-checkout configured', () => !!vercel.functions?.['api/create-checkout.js'] || 'Missing create-checkout.js function config');
test('create-bulk-checkout configured', () => !!vercel.functions?.['api/create-bulk-checkout.js'] || 'Missing create-bulk-checkout.js function config');
test('cron job configured', () => vercel.crons?.length > 0 || 'No cron jobs configured');
test('cleanUrls enabled', () => vercel.cleanUrls === true || 'cleanUrls not enabled');

// ── API CODE QUALITY TESTS ───────────────────────────────────
console.log('\n🔍 API CODE QUALITY TESTS');
const apiFiles = ['api/contact.js','api/create-checkout.js','api/create-bulk-checkout.js',
  'api/stripe-webhook.js','api/subscribe.js','api/unsubscribe.js'];

apiFiles.forEach(f => {
  const code = readFileSync(f, 'utf8');
  test(`${f}: uses import (ES modules)`, () => code.includes('import ') || 'No import statements found');
  test(`${f}: no require() (CommonJS)`, () => !code.includes('require(') || 'CommonJS require() found');
  test(`${f}: has export default`, () => code.includes('export default') || 'No export default found');
});

// ── CONTACT API TESTS ────────────────────────────────────────
console.log('\n📧 CONTACT API TESTS');
const contactCode = readFileSync('api/contact.js', 'utf8');
test('Contact: Resend integration', () => contactCode.includes('resend') || 'No Resend integration');
test('Contact: Supabase integration', () => contactCode.includes('supabase') || 'No Supabase integration');
test('Contact: input validation', () => contactCode.includes('!name') || contactCode.includes('Missing') || 'No input validation');
test('Contact: contact_submissions table', () => contactCode.includes('contact_submissions') || 'No contact_submissions table reference');

// ── UNSUBSCRIBE API TESTS ────────────────────────────────────
console.log('\n🔕 UNSUBSCRIBE API TESTS');
const unsubCode = readFileSync('api/unsubscribe.js', 'utf8');
test('Unsubscribe: token validation', () => unsubCode.includes('token') || 'No token validation');
test('Unsubscribe: crypto/hashing', () => unsubCode.includes('crypto') || 'No crypto usage');
test('Unsubscribe: Supabase integration', () => unsubCode.includes('supabase') || 'No Supabase integration');
test('Unsubscribe: subscribers table', () => unsubCode.includes('subscribers') || 'No subscribers table reference');

// ── SUBSCRIBE API TESTS ──────────────────────────────────────
console.log('\n📬 SUBSCRIBE API TESTS');
const subCode = readFileSync('api/subscribe.js', 'utf8');
test('Subscribe: token generation', () => subCode.includes('generateUnsubscribeToken') || 'No token generation');
test('Subscribe: unsubscribe URL', () => subCode.includes('unsubscribeUrl') || 'No unsubscribe URL');
test('Subscribe: unsubscribe link in email', () => subCode.includes('unsubscribeUrl') && subCode.includes('Unsubscribe') || 'No unsubscribe link in email');

// ── BULK ORDER TESTS ─────────────────────────────────────────
console.log('\n📦 BULK ORDER TESTS');
const bulkCheckoutCode = readFileSync('api/create-bulk-checkout.js', 'utf8');
test('Bulk checkout: Supabase storage', () => bulkCheckoutCode.includes('bulk_orders') || 'No bulk_orders table reference');
test('Bulk checkout: insert operation', () => bulkCheckoutCode.includes('.insert(') || 'No insert operation');
test('Bulk checkout: Stripe metadata handling', () => bulkCheckoutCode.includes('bulkOrderId') || 'No bulkOrderId in metadata');

const webhookCode = readFileSync('api/stripe-webhook.js', 'utf8');
test('Webhook: bulk order handler', () => webhookCode.includes('handleBulkOrderProcessing') || 'No bulk order handler');
test('Webhook: bulk order detection', () => webhookCode.includes("orderType === 'bulk'") || 'No bulk order detection');
test('Webhook: Supabase data retrieval', () => webhookCode.includes('bulk_orders') || 'No bulk_orders retrieval');

// ── DATABASE SCHEMA TESTS ────────────────────────────────────
console.log('\n🗄️  DATABASE SCHEMA TESTS');
const schema = readFileSync('SUPABASE_SCHEMA.sql', 'utf8');
test('Schema: contact_submissions table', () => schema.includes('contact_submissions') || 'No contact_submissions table');
test('Schema: bulk_orders table', () => schema.includes('bulk_orders') || 'No bulk_orders table');
test('Schema: subscribers table', () => schema.includes('subscribers') || 'No subscribers table');
test('Schema: RLS enabled', () => schema.includes('ROW LEVEL SECURITY') || 'No RLS configuration');

// ── PRICING LOGIC TESTS (CRITICAL) ───────────────────────────
console.log('\n💰 PRICING LOGIC TESTS (CRITICAL)');

// Test current index.html pricing
const indexCode = readFileSync('index.html', 'utf8');
// Correct: uses PRICING.starter.included (which is 4) or literal n-4
const hasCorrectFrontendPricing = indexCode.includes('n - PRICING.starter.included') || indexCode.includes('n - 4') || indexCode.includes('n-4');
// Wrong: uses n-1 (charges from tenant 2 instead of tenant 5)
const hasWrongFrontendPricing = (indexCode.includes('n - 1') || indexCode.includes('n-1')) && indexCode.includes('updatePrice');
test('index.html: 4 tenants included in base price', () => hasCorrectFrontendPricing || 'WRONG: Not using correct 4-tenant inclusion formula');
test('index.html: NOT using wrong n-1 formula', () => !hasWrongFrontendPricing || 'WRONG: Uses n-1 formula (charges from tenant 2 instead of tenant 5)');

// Test current create-checkout.js pricing
const checkoutCode = readFileSync('api/create-checkout.js', 'utf8');
// Correct: uses pricing.includedTenants (which is 4) or literal tenantCount-4
const hasCorrectBackendPricing = checkoutCode.includes('tenantCount - pricing.includedTenants') || checkoutCode.includes('tenantCount - 4');
const hasWrongBackendPricing = checkoutCode.includes('tenantCount - 1');
test('create-checkout.js: 4 tenants included in base', () => hasCorrectBackendPricing || 'WRONG: Not using correct 4-tenant inclusion formula');
test('create-checkout.js: NOT using wrong tenantCount-1 formula', () => !hasWrongBackendPricing || 'WRONG: Uses tenantCount-1 formula');

// Test bulk pricing logic (should already be correct)
const bulkUploadCode = readFileSync('bulk-upload.html', 'utf8');
test('bulk-upload.html: per-property extra tenant calc', () => bulkUploadCode.includes('p.tenants.length > 4') || 'Missing per-property tenant check');
test('bulk-upload.html: extra tenants counted per property', () => bulkUploadCode.includes('p.tenants.length - 4') || 'Missing per-property extra tenant count');

// Test bulk.html calculator
const bulkHtmlCode = readFileSync('bulk.html', 'utf8');
test('bulk.html: calculator uses t-4 formula', () => bulkHtmlCode.includes('t-4') || bulkHtmlCode.includes('t - 4') || 'Calculator not using t-4 formula');

// Test pricing tier values
test('create-checkout.js: Starter base £49', () => checkoutCode.includes('4900') || 'Missing £49 base price');
test('create-checkout.js: Starter extra £8', () => checkoutCode.includes('800') || 'Missing £8 extra tenant price');

// ── PRICING CALCULATION SIMULATION ───────────────────────────
console.log('\n🧮 PRICING CALCULATION SIMULATION (Correct Logic)');

const PRICING_CORRECT = {
  starter:   { basePrice: 4900, extraTenantPrice: 800,  label: 'Starter',   included: 4 },
  essential: { basePrice: 3900, extraTenantPrice: 600,  label: 'Essential', included: 4 },
  portfolio: { basePrice: 2900, extraTenantPrice: 600,  label: 'Portfolio', included: 4 },
  scale:     { basePrice: 2200, extraTenantPrice: 500,  label: 'Scale',     included: 4 },
};

const BULK_PLANS = {
  silver:   { price: 44, extra: 8,  included: 4 },
  bronze:   { price: 34, extra: 7,  included: 4 },
  gold:     { price: 24, extra: 6,  included: 4 },
  platinum: { price: 19, extra: 5,  included: 4 },
};

function calcSinglePrice(pkg, tenantCount) {
  const p = PRICING_CORRECT[pkg];
  const extraCount = Math.max(0, tenantCount - p.included);
  return (p.basePrice + (extraCount * p.extraTenantPrice)) / 100;
}

function calcBulkPrice(plan, properties) {
  const p = BULK_PLANS[plan];
  let total = 0;
  properties.forEach(prop => {
    const extra = Math.max(0, prop.tenants - p.included);
    total += p.price + (extra * p.extra);
  });
  return total;
}

// Single property pricing tests
const singleTests = [
  { pkg: 'starter', tenants: 1, expected: 49 },
  { pkg: 'starter', tenants: 2, expected: 49 },
  { pkg: 'starter', tenants: 3, expected: 49 },
  { pkg: 'starter', tenants: 4, expected: 49 },
  { pkg: 'starter', tenants: 5, expected: 57 },
  { pkg: 'starter', tenants: 6, expected: 65 },
];
singleTests.forEach(t => {
  const calc = calcSinglePrice(t.pkg, t.tenants);
  test(`Starter ${t.tenants} tenant(s) = £${t.expected}`, () => calc === t.expected || `Got £${calc}, expected £${t.expected}`);
});

// Bulk per-property pricing tests
const bulkTest1 = [
  { address: 'Prop A', tenants: 2 },  // £44
  { address: 'Prop B', tenants: 5 },  // £44 + £8 = £52
  { address: 'Prop C', tenants: 4 },  // £44
];
const bulkTotal1 = calcBulkPrice('silver', bulkTest1);
test('Silver: 3 props (2,5,4 tenants) = £140', () => bulkTotal1 === 140 || `Got £${bulkTotal1}, expected £140`);

// Verify NOT generalised
test('Bulk: per-property calc differs from generalised calc', () => {
  const perProp = calcBulkPrice('silver', [{address:'A',tenants:2},{address:'B',tenants:5},{address:'C',tenants:4}]);
  const generalised = 3 * 44;
  return perProp !== generalised || 'Per-property and generalised give same result (unexpected for this test case)';
});

// Bronze tests
test('Bronze: 1 prop 6 tenants = £48', () => {
  const calc = calcBulkPrice('bronze', [{address:'A',tenants:6}]);
  return calc === 48 || `Got £${calc}, expected £48 (£34 + 2×£7)`;
});

// Gold tests
// Gold: price=24, extra=6, included=4
// Prop A: 3 tenants -> 0 extra -> £24
// Prop B: 7 tenants -> 3 extra -> £24 + 3×£6 = £42
// Total: £24 + £42 = £66
test('Gold: 2 props (3,7 tenants) = £66', () => {
  const calc = calcBulkPrice('gold', [{address:'A',tenants:3},{address:'B',tenants:7}]);
  return calc === 66 || `Got £${calc}, expected £66 (£24 + £42)`;
});

// ── ADDITIONAL VALIDATION TESTS ─────────────────────────────
console.log('\n📝 ADDITIONAL VALIDATION TESTS');

// Verify index.html has 6-tenant selector
test('index.html: 6-tenant selector present', () => indexCode.includes('data-n="6"') || 'Missing 6-tenant button');
test('index.html: 5-tenant selector present', () => indexCode.includes('data-n="5"') || 'Missing 5-tenant button');
test('index.html: pval-display element present', () => indexCode.includes('pval-display') || 'Missing pval-display element');
test('index.html: pricing card shows extra tenant info', () => indexCode.includes('+£8 per extra tenant') || 'Missing extra tenant pricing info in card');
test('index.html: FAQ updated with correct pricing', () => indexCode.includes('4 tenants') && indexCode.includes('£8 per extra tenant') || 'FAQ not updated with correct pricing');

// Verify create-checkout.js has correct structure
test('create-checkout.js: includedTenants field in PRICING_TIERS', () => checkoutCode.includes('includedTenants: 4') || 'Missing includedTenants in PRICING_TIERS');
test('create-checkout.js: extraTenantCount uses includedTenants', () => checkoutCode.includes('pricing.includedTenants') || 'Not using pricing.includedTenants');
test('create-checkout.js: clear description for Stripe', () => checkoutCode.includes('included in base price') || 'Missing clear tenant description');

// Platinum bulk pricing test
// Platinum: price=19, extra=5, included=4
// Prop A: 4 tenants -> 0 extra -> £19
// Prop B: 4 tenants -> 0 extra -> £19
// Prop C: 6 tenants -> 2 extra -> £19 + 2×£5 = £29
// Total: £19 + £19 + £29 = £67
test('Platinum: 3 props (4,4,6 tenants) = £67', () => {
  const calc = calcBulkPrice('platinum', [{address:'A',tenants:4},{address:'B',tenants:4},{address:'C',tenants:6}]);
  return calc === 67 || `Got £${calc}, expected £67`;
});

// ── SUMMARY ──────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\nFAILED TESTS:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  FAIL: ${r.name}: ${r.detail || ''}`);
  });
}

process.exit(failed > 0 ? 1 : 0);
