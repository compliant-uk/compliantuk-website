# CompliantUK — Claude Code Handover Document
# READ THIS FIRST. Everything you need is here.

---

## 1. WHAT THIS PROJECT IS

**CompliantUK** (https://www.compliantuk.co.uk) is a UK landlord compliance SaaS.

**The business:** Private landlords in England must serve the official Government Information Sheet
to every tenant by 31 May 2026 under the Renters' Rights Act 2025. Non-compliance = fines up to
£7,000. CompliantUK automates the entire process: landlord pays → system emails each tenant the
PDF → tracks when the tenant reads it → auto-generates a timestamped proof-of-service certificate
→ landlord has their legal record.

**The tech stack:**
- Frontend: Static HTML/CSS/JS (no framework) — dark theme, Bricolage Grotesque font
- Backend: Vercel serverless functions in `/api/` folder (ES Modules, `"type": "module"`)
- Database: Supabase (Postgres + Auth)
- Payments: Stripe only (PayPal was removed — do not add it back)
- Email: Resend
- PDF generation: pdf-lib
- Hosting: Vercel (auto-deploys on GitHub push to main)
- Repo: https://github.com/compliant-uk/compliantuk-website (public)
- Live site: https://www.compliantuk.co.uk

---

## 2. ENVIRONMENT VARIABLES

All set in Vercel dashboard (Settings → Environment Variables). All set to "All Environments".

```
STRIPE_SECRET_KEY          = sk_live_...        (Stripe live secret key)
STRIPE_WEBHOOK_SECRET      = whsec_...          (from Stripe webhook registration)
RESEND_API_KEY             = re_...             (Resend email API)
SUPABASE_URL               = https://ihfbagpupottobyeciwq.supabase.co
SUPABASE_ANON_KEY          = sb_publishable_-U8VyL_5cWmquttTZfEekQ_LqPIE_WxOhevY (FULL KEY - get from Supabase)
SUPABASE_SERVICE_ROLE_KEY  = sb_secret_HCNsR... (FULL KEY - get from Supabase → Settings → API Keys → Secret)
ADMIN_BCC_EMAIL            = huseyin.turkay@compliantuk.co.uk
```

**IMPORTANT:** The SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY shown in this file may be
truncated. Always get the FULL keys from Supabase dashboard → Settings → API Keys before using
them in any frontend HTML files.

The SUPABASE_ANON_KEY (publishable key) is safe to embed in frontend HTML.
The SUPABASE_SERVICE_ROLE_KEY must ONLY be used in serverless API functions — never in frontend.

---

## 3. SUPABASE DATABASE SCHEMA

The schema has already been run. Tables exist:

```sql
-- ORDERS TABLE
create table public.orders (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  stripe_session_id text unique not null,
  landlord_id uuid references auth.users(id) on delete set null,
  landlord_email text not null,
  landlord_first text not null,
  landlord_last text not null,
  property_address text not null,
  amount_paid integer not null,  -- in pence
  package text default 'starter',
  status text default 'paid'     -- paid | processing | complete
);

-- TENANCIES TABLE
create table public.tenancies (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  order_id uuid references public.orders(id) on delete cascade,
  landlord_id uuid references auth.users(id) on delete set null,
  property_address text not null,
  tenant_first text not null,
  tenant_last text not null,
  tenant_email text not null,
  tracking_id text unique not null,   -- hex string, used in pixel URL
  status text default 'sent',         -- sent | opened | read | certificate_generated
  sent_at timestamptz default now(),
  opened_at timestamptz,
  read_at timestamptz,
  tenant_ip text,
  tenant_device text,
  certificate_url text,
  reminder_sent boolean default false
);
```

Row Level Security is enabled. Landlords can only see their own rows (auth.uid() = landlord_id).
Service role key bypasses RLS and is used in all API functions.

---

## 4. PRICING TIERS

### Single property (index.html):
- 1 tenant: £49
- 2 tenants: £78 (£49 + £29 for second)
- 3 tenants: £97
- 4 tenants: £116
- Max 4 tenants on single form (legislative cap per tenancy agreement)

### Portfolio / bulk (bulk.html → bulk-upload.html):
| Tier     | Properties | Price/property | Extra tenant (over 1) |
|----------|-----------|----------------|----------------------|
| Silver   | 2–10      | £44            | +£8                  |
| Bronze   | 11–25     | £34            | +£7                  |
| Gold     | 25–50     | £24            | +£6                  |
| Platinum | 50–100    | £19            | +£5                  |

Note: "extra tenants" in bulk means tenants 2,3,4+ on a single property (tenant 1 is included
in base price). The base price includes 1 tenant. Additional tenants on the SAME property
are charged at the extra rate. This is different from the single flow where pricing is
per-tenant count selected.

---

## 5. THE COMPLETE CUSTOMER JOURNEY

### Single property flow:
1. Landlord fills form on index.html (name, email, property address, tenant count, tenant details)
2. Clicks pay → form POSTs to `/api/create-checkout` → gets Stripe session URL → redirects
3. Landlord pays on Stripe
4. Stripe fires `checkout.session.completed` webhook to `/api/stripe-webhook`
5. Webhook:
   a. Creates/finds Supabase auth account for landlord (auto-generates password if new)
   b. Saves order to `orders` table
   c. Saves each tenant to `tenancies` table with unique `tracking_id`
   d. Emails each tenant: GOV.UK PDF attached + covering letter + invisible tracking pixel
      (`<img src="https://www.compliantuk.co.uk/api/track?id={tracking_id}">`)
   e. Emails landlord: confirmation + temporary password + dashboard link
6. Tenant opens email → pixel fires → GET `/api/track?id={tracking_id}`
7. Track endpoint:
   a. Logs IP, device, timestamp
   b. Updates tenancy status: sent → opened → read
   c. Calls `generateCertificatePdf()` to create certificate PDF
   d. Emails certificate PDF to landlord
   e. Updates tenancy status to `certificate_generated`
8. Landlord clicks dashboard link in email → `/login` → logs in with temp password
9. Dashboard shows all properties, tenant statuses, certificates

### Bulk portfolio flow:
1. Landlord visits `/bulk` → clicks plan tier button → goes to `/bulk-upload?plan=gold`
2. On bulk-upload.html: enters landlord details, uploads CSV or adds properties manually
3. Clicks pay → POSTs to `/api/create-bulk-checkout`
4. Single Stripe session created covering all properties
5. Same webhook handles it (detects `orderType: 'bulk'` in metadata)
6. Processes each property/tenant individually (emails, tracking, certificates all work same way)

### Auth flow:
- NO manual registration — accounts are auto-created by the webhook on first purchase
- Landlord receives email with: username (their email) + temporary password + login link
- Login at `/login` → Supabase auth → redirect to `/dashboard`
- Dashboard uses Supabase ANON key in frontend to query landlord's own data (RLS enforced)
- Forgot password → `/forgot` → Supabase `resetPasswordForEmail()`

---

## 6. FILE STRUCTURE — WHAT EXISTS, WHAT'S DEPLOYED

### Root HTML files (all in repo root):
```
index.html        — Homepage with single-property form + pricing
bulk.html         — Portfolio pricing tiers + calculator + enquiry form
bulk-upload.html  — ✅ NEWLY CREATED — portfolio order form (CSV upload + manual entry)
dashboard.html    — ✅ NEWLY CREATED — real landlord dashboard (Supabase auth + live data)
login.html        — ⚠️  STILL OLD FILE — new version created but NOT yet pushed to GitHub
success.html      — Post-payment confirmation page
register.html     — OLD/REDUNDANT — should be redirected to / or removed
about.html        — ⚠️  RETURNS BLANK — needs content (founder bio is in old dashboard.html)
blog.html         — Loads but has no actual articles showing
blog-post.html    — Could not verify
contact.html      — Loads, form UI present
privacy.html      — ⚠️  Says "SendGrid" — should say "Resend"
terms.html        — OK
forgot.html       — ❌ DOES NOT EXIST — linked from login, causes 404
```

### API functions (in `/api/` folder):
```
api/create-checkout.js       — ✅ Creates Stripe session for single property
api/create-bulk-checkout.js  — ✅ NEWLY CREATED — Creates Stripe session for portfolio
api/stripe-webhook.js        — ✅ Updated — handles both single + bulk orders
api/track.js                 — ✅ Read-tracking pixel + certificate trigger
api/generate-certificate.js  — ✅ PDF certificate generator using pdf-lib
api/send-documents.js        — Exists from before (may be superseded by webhook)
api/paypal-webhook.js        — ⚠️  EXISTS BUT PAYPAL REMOVED — can delete this file
api/calculator.js            — Exists (pricing calculator helper)
```

### Config files:
```
vercel.json     — ✅ Updated — registers all API functions with memory/timeout settings
package.json    — ✅ Updated — includes stripe, @supabase/supabase-js, resend, pdf-lib
.env.example    — Documents required env vars
```

### Assets:
```
The_Renters__Rights_Act_Information_Sheet_2026.pdf  — The actual GOV.UK PDF that gets emailed
manifest.json   — PWA manifest
sw.js           — Service worker
```

---

## 7. CRITICAL ISSUES TO FIX (in priority order)

### 🔴 P1 — BLOCKS ALL PAYMENTS

**Issue 1: index.html form not wired to /api/create-checkout**
The homepage form has a pay button that does NOT call the new API. The form needs its submit
handler replaced to POST tenant data to `/api/create-checkout` and redirect to `session.url`.

What to do:
- Find the submit button / form handler in index.html (search for `submit-btn` or `handlePay`)
- Replace it with a fetch call to POST to `/api/create-checkout`
- Payload should be: `{landlordFirst, landlordLast, landlordEmail, propertyAddress, tenants: [{first, last, email}]}`
- On success, redirect: `window.location.href = data.url`
- Show loading state while processing

The form currently collects: first name, last name, email, property address, number of tenants
(1-4 selector), and per-tenant name/email fields that appear dynamically.

**Issue 2: Stripe webhook not confirmed registered**
Must be registered at: stripe.com → Developers → Webhooks → Add endpoint
URL: `https://www.compliantuk.co.uk/api/stripe-webhook`
Event: `checkout.session.completed`
The `STRIPE_WEBHOOK_SECRET` env var in Vercel should match what Stripe shows.

### 🔴 P1 — BLOCKS LANDLORD LOGIN

**Issue 3: login.html still shows old page**
The old login.html has no Supabase auth wiring. The NEW login.html was written but NOT pushed
to GitHub. It needs to REPLACE the existing login.html in the repo.

New login.html features:
- Supabase JS SDK loaded via CDN
- `supabase.auth.signInWithPassword({email, password})`
- Auto-redirects to /dashboard if already logged in
- Shows temp password banner if `?new=1` param in URL
- "Forgot password?" links to /forgot
- Enter key submits form

Supabase client init (use in all frontend files):
```javascript
const SUPABASE_URL = 'https://ihfbagpupottobyeciwq.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_FULL_PUBLISHABLE_KEY'; // get from Supabase dashboard
const { createClient } = supabase; // loaded via CDN
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

CDN to load Supabase in HTML:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

### 🔴 P1 — CAUSES 404

**Issue 4: /forgot.html does not exist**
Linked from login page. Create forgot.html with:
- Input field for email address
- Call `sb.auth.resetPasswordForEmail(email, {redirectTo: 'https://www.compliantuk.co.uk/reset-password'})`
- Show success message: "Check your email for a reset link"
- Match the visual style of login.html

Also create reset-password.html that handles the Supabase magic link callback and lets
users set a new password using `sb.auth.updateUser({password: newPassword})`.

### 🟡 P2 — CONTENT/TRUST ISSUES

**Issue 5: /about.html returns blank page**
The about page loads but has no content. The founder bio content (Huseyin Turkay, 12 years
property experience, HHSRS certified, etc.) exists in the OLD dashboard.html file as "About"
content. Extract it and put it in about.html. Match the site's dark theme and design.

**Issue 6: privacy.html lists SendGrid as email provider**
Find "SendGrid (Twilio)" in privacy.html and replace with "Resend". This is a GDPR accuracy
requirement — the privacy policy must name the correct data processor.

**Issue 7: index.html shows PayPal trust badge**
In the hero card form area, the trust strip shows "✓ Stripe ✓ PayPal". PayPal has been removed.
Remove "✓ PayPal" from the trust badges. Search for "PayPal" in index.html and remove all
PayPal references (there may also be a PayPal button or SDK script tag — remove those too).

**Issue 8: /register.html should redirect**
Registration is now automatic on purchase. Create a redirect from /register to / or show
a message: "Accounts are created automatically when you make your first purchase."

### 🟢 P3 — MISSING FEATURES

**Issue 9: 48-hour auto-reminder not implemented**
The site promises tenants get an automatic reminder if they haven't read within 48 hours.
This needs a Vercel cron job. Add to vercel.json:
```json
"crons": [
  {
    "path": "/api/send-reminders",
    "schedule": "0 * * * *"
  }
]
```
Create `api/send-reminders.js` that:
1. Queries Supabase for tenancies where status = 'sent' AND sent_at < NOW() - INTERVAL '48 hours'
   AND reminder_sent = false
2. Sends a reminder email via Resend to each tenant
3. Updates reminder_sent = true

**Issue 10: Password change UI in dashboard**
Landlords receive a temp password but have no way to change it. Add an "Account settings"
section to dashboard.html with a simple form calling:
`sb.auth.updateUser({password: newPassword})`

**Issue 11: Certificate download from dashboard**
The dashboard shows certificate status but there's no download button for certificates.
Add a download link — currently certificates are only emailed. Options:
a. Store certificate PDF in Supabase Storage and save URL to `tenancies.certificate_url`
b. Or add a regenerate endpoint: GET `/api/certificate?id={tenancy_id}` that regenerates on demand

---

## 8. KEY CODE PATTERNS

### API function pattern (all API files use this):
```javascript
// api/example.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  // ...
}
```

### Supabase in API functions (server-side, use SERVICE ROLE):
```javascript
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role bypasses RLS
);
```

### Supabase in frontend HTML (client-side, use ANON KEY):
```javascript
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Then RLS ensures users only see their own data
const { data } = await sb.from('orders').select('*'); // auto-filtered by auth.uid()
```

### Stripe webhook (raw body required):
```javascript
export const config = { api: { bodyParser: false } };
// Must read raw body for signature verification
const rawBody = await getRawBody(req);
const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
```

### Sending email with Resend:
```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({
  from: 'CompliantUK <noreply@compliantuk.co.uk>',
  to: recipientEmail,
  subject: 'Subject here',
  html: '<p>HTML content</p>',
  attachments: [{
    filename: 'document.pdf',
    content: base64string,
    encoding: 'base64',
  }],
});
```

### Generating certificate PDF:
```javascript
import { generateCertificatePdf } from './generate-certificate.js';
const pdfBuffer = await generateCertificatePdf({
  propertyAddress, tenantFirst, tenantLast, tenantEmail,
  sentAt, readAt, ipAddress, device, trackingId, landlordId
});
const base64 = pdfBuffer.toString('base64');
```

### Getting the GOV.UK info sheet PDF (already in repo):
```javascript
const response = await fetch('https://www.compliantuk.co.uk/The_Renters__Rights_Act_Information_Sheet_2026.pdf');
const buffer = await response.arrayBuffer();
const pdfBuffer = Buffer.from(buffer);
const pdfBase64 = pdfBuffer.toString('base64');
```

---

## 9. DESIGN SYSTEM

The site uses a consistent dark theme. All new HTML pages must match this exactly.

### CSS Variables:
```css
:root {
  --bg: #080c14;       /* page background */
  --bg1: #0d1220;      /* card background */
  --bg2: #111827;      /* nested card bg */
  --border: rgba(255,255,255,0.07);
  --border2: rgba(255,255,255,0.12);
  --text: #f1f5f9;     /* primary text */
  --text2: #94a3b8;    /* secondary text */
  --text3: #64748b;    /* muted text */
  --blue: #3b82f6;
  --blue2: #60a5fa;
  --blue3: #1d4ed8;
  --emerald: #10b981;
  --emerald2: #34d399;
  --amber: #f59e0b;
  --red: #ef4444;
  --font: 'Bricolage Grotesque', sans-serif;
  --mono: 'Geist Mono', monospace;
  --serif: 'Lora', serif;
  --radius: 14px;
  --radius-lg: 20px;
}
```

### Font import (copy into every new page head):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Geist+Mono:wght@400;500&family=Lora:ital,wght@0,400;1,400&display=swap');
</style>
```

### Standard nav (copy into every new page):
```html
<nav>
  <div style="max-width:1160px;margin:0 auto;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 max(5%,20px)">
    <a href="/" style="display:flex;align-items:center;gap:9px;text-decoration:none">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:15px">✓</div>
      <span style="font-size:17px;font-weight:700;color:#f1f5f9;letter-spacing:-.4px">Compliant<span style="color:#60a5fa">UK</span></span>
    </a>
    <div style="display:flex;gap:12px;align-items:center">
      <a href="/login" style="color:#94a3b8;text-decoration:none;font-size:14px">Log in</a>
      <a href="/#get-compliant" style="background:#3b82f6;color:white;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13.5px;font-weight:600">Get compliant — £49</a>
    </div>
  </div>
</nav>
```

### Standard page shell:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PAGE TITLE — CompliantUK</title>
<meta name="robots" content="noindex"> <!-- for auth pages -->
<script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque...');
/* CSS variables here */
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:var(--font); background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased; }
nav { position:sticky; top:0; z-index:99; background:rgba(8,12,20,0.95); backdrop-filter:blur(20px); border-bottom:1px solid var(--border); }
</style>
</head>
<body>
<!-- nav here -->
<!-- content here -->
<!-- standard footer -->
<footer style="border-top:1px solid var(--border);padding:28px max(5%,20px)">
  <div style="max-width:1160px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
    <a href="/" style="display:flex;align-items:center;gap:9px;text-decoration:none">
      <div style="width:28px;height:28px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);border-radius:7px;display:flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:13px">✓</div>
      <span style="font-size:16px;font-weight:700;color:#f1f5f9">Compliant<span style="color:#60a5fa">UK</span></span>
    </a>
    <div style="display:flex;gap:4px">
      <a href="/about" style="color:#64748b;text-decoration:none;font-size:13px;padding:4px 10px">About</a>
      <a href="/privacy" style="color:#64748b;text-decoration:none;font-size:13px;padding:4px 10px">Privacy</a>
      <a href="/terms" style="color:#64748b;text-decoration:none;font-size:13px;padding:4px 10px">Terms</a>
      <a href="/contact" style="color:#64748b;text-decoration:none;font-size:13px;padding:4px 10px">Contact</a>
      <a href="/login" style="color:#64748b;text-decoration:none;font-size:13px;padding:4px 10px">Log in</a>
    </div>
    <span style="font-size:12px;color:#64748b">© 2026 CompliantUK</span>
  </div>
</footer>
</body>
</html>
```

---

## 10. FILES WRITTEN IN THIS SESSION (push these to GitHub)

The following files were written and need to be committed to the repo. They are ready to use:

### New files (ADD to repo):
- `bulk-upload.html` — Portfolio order form with CSV upload, manual entry, live cost, Stripe checkout
- `api/create-bulk-checkout.js` — Stripe session creator for bulk/portfolio orders

### Replace existing files:
- `api/stripe-webhook.js` — Updated to handle both single + bulk orders, creates Supabase accounts
- `api/generate-certificate.js` — Complete PDF certificate generator
- `api/track.js` — Read-tracking pixel that triggers certificate auto-generation
- `api/create-checkout.js` — Single-property Stripe session creator
- `dashboard.html` — Real landlord dashboard with Supabase auth + live data
- `login.html` — New login page with Supabase auth (REPLACES old broken version)
- `vercel.json` — Updated with all function registrations
- `package.json` — Updated with all dependencies

### Files NOT yet pushed but needed — Claude Code must push these:
All the above files exist as artifacts from this session. Clone the repo, replace/add
the files listed above, then `git push` to trigger Vercel auto-deploy.

---

## 11. DEPLOYMENT WORKFLOW

```bash
# Clone the repo
git clone https://github.com/compliant-uk/compliantuk-website.git
cd compliantuk-website

# Make changes
# ... edit/add files ...

# Deploy (Vercel auto-deploys on push to main)
git add .
git commit -m "description of changes"
git push origin main
```

Vercel will auto-deploy within ~60 seconds. Check status at:
https://vercel.com/compliantuk-2916s-projects/compliantuk-website

**After deploying**, verify:
1. Visit https://www.compliantuk.co.uk/login — should show new login form
2. Visit https://www.compliantuk.co.uk/bulk-upload?plan=gold — should show portfolio form
3. Visit https://www.compliantuk.co.uk/dashboard — should show auth gate
4. Visit https://www.compliantuk.co.uk/forgot — should show password reset form

---

## 12. STRIPE WEBHOOK SETUP (manual step required once)

The Stripe webhook must be registered in the Stripe dashboard:
1. Go to https://dashboard.stripe.com → Developers → Webhooks
2. Click "Add endpoint"
3. URL: `https://www.compliantuk.co.uk/api/stripe-webhook`
4. Events to listen to: `checkout.session.completed`
5. After saving, copy the "Signing secret" (starts with `whsec_`)
6. Make sure this matches the `STRIPE_WEBHOOK_SECRET` in Vercel env vars

---

## 13. TESTING CHECKLIST

After deploying, test in this order:

1. **Single property payment test:**
   - Fill form on homepage with your own email as both landlord and tenant
   - Use Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC
   - Verify: redirect to Stripe → payment → redirect to /success
   - Verify: email received at landlord address with password + dashboard link
   - Verify: email received at tenant address with PDF attachment
   - Verify: Supabase tables show order + tenancy rows
   - Verify: Login works at /login with the temp password from email
   - Verify: Dashboard shows the property and tenant

2. **Tracking pixel test:**
   - Open the tenant email
   - Verify: tenancy status updates in Supabase from 'sent' to 'read'
   - Verify: certificate email arrives at landlord address with PDF

3. **Bulk order test:**
   - Visit /bulk → click Gold plan → arrives at /bulk-upload?plan=gold
   - Download CSV template
   - Fill with test data (few properties, your own emails)
   - Upload CSV → verify properties populate
   - Pay → verify all tenant emails sent + landlord email received

4. **Dashboard test:**
   - Login with landlord account
   - Verify properties show with correct statuses
   - Verify filter tabs work (All / Fully compliant / Awaiting read)
   - Verify auto-refresh every 30s

5. **Auth flow test:**
   - Visit /forgot → enter email → verify reset email arrives
   - Click reset link → verify can set new password

---

## 14. BUSINESS CONTEXT & OWNER

**Owner:** Huseyin Turkay
**Email:** huseyin.turkay@compliantuk.co.uk
**Support email:** support@compliantuk.co.uk
**Background:** 12 years property industry, HHSRS certified, Awaab's Law specialist,
previously Acquisitions Manager at Nacro Housing West Midlands.

**Critical deadline:** The 31 May 2026 deadline for landlord compliance is the entire
reason this business exists and the urgency behind every feature. The deadline has
technically already passed (we are 11 April 2026) — this creates MAXIMUM urgency.
All copy, CTAs, and UX decisions should reflect this urgency.

**DO NOT:**
- Add PayPal (was deliberately removed)
- Add subscription flows (not in scope for this launch)
- Change the pricing without confirmation from Huseyin
- Break the certificate generation — it is the core legal product
- Use localStorage/sessionStorage for anything sensitive (use Supabase)

**DO:**
- Keep the dark aesthetic consistent across all pages
- Ensure every page has the standard nav and footer
- Always test with Stripe test keys before anything hits production
- Keep the GOV.UK PDF filename exactly as-is (it's referenced in the API code)
- Email from: `CompliantUK <noreply@compliantuk.co.uk>` (don't change this)

---

## 15. IMMEDIATE NEXT ACTIONS FOR CLAUDE CODE

In order of priority:

1. **Clone the repo** and push all the new/updated files listed in Section 10
2. **Wire index.html form** to `/api/create-checkout` (search for `submit-btn` class and
   the payment handler — replace with fetch call to API)
3. **Create forgot.html** — password reset page calling Supabase `resetPasswordForEmail()`
4. **Create reset-password.html** — handles Supabase magic link, lets user set new password
5. **Fix about.html** — populate with founder bio content (see old dashboard.html in repo
   for the content — it was accidentally put there instead of about.html)
6. **Fix privacy.html** — replace "SendGrid (Twilio)" with "Resend"
7. **Remove PayPal badges** from index.html trust strip
8. **Redirect register.html** to homepage
9. **Create api/send-reminders.js** — 48hr tenant reminder cron job
10. **Add password change UI** to dashboard.html

Each of these is a self-contained task. Do them in order. Push after each one so
the owner can verify before you proceed to the next.
