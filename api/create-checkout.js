// api/create-checkout.js
// Creates a Stripe Checkout session with dynamic pricing based on package and tenant count
// Called from index.html on form submit

import Stripe from 'stripe';
import { PRS_PRODUCTS, prsQuote } from '../lib/prs-pricing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers — per tenancy (pence)
// Base price INCLUDES up to 4 tenants. Tenants 5+ are charged at extraTenantPrice each.
// e.g. Starter: 1–4 tenants = £49 | 5 tenants = £57 | 6 tenants = £65
const PRICING_TIERS = {
  starter:   { basePrice: 4900, extraTenantPrice: 800, includedTenants: 4, label: 'Starter' },   // £49 base (up to 4 tenants), +£8 per extra tenant
  essential: { basePrice: 3900, extraTenantPrice: 600, includedTenants: 4, label: 'Essential' },    // £39 base (up to 4 tenants), +£6 per extra tenant
  portfolio: { basePrice: 2900, extraTenantPrice: 600, includedTenants: 4, label: 'Portfolio' },    // £29 base (up to 4 tenants), +£6 per extra tenant
  scale:     { basePrice: 2200, extraTenantPrice: 500, includedTenants: 4, label: 'Scale' },        // £22 base (up to 4 tenants), +£5 per extra tenant
};

// ── Rental Property Register service (Phase 2) ─────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function prsCheckout(req, res) {
  const { product, name, email, properties, postcode } = req.body || {};
  const q = prsQuote(product, Number(properties));
  if (!q) return res.status(400).json({ error: 'Please choose a plan and between 1 and 500 properties.' });
  const cleanEmail = `${email || ''}`.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const fullName = `${name || ''}`.trim().slice(0, 120);
  const [first, ...rest] = fullName.split(/\s+/);
  const origin = req.headers.origin || 'https://www.compliantuk.co.uk';
  const metadata = {
    orderType: 'prs',
    product,
    properties: String(q.properties),
    landlordEmail: cleanEmail,
    landlordFirst: (first || 'Landlord').slice(0, 60),
    landlordLast: rest.join(' ').slice(0, 60),
    postcode: `${postcode || ''}`.trim().toUpperCase().slice(0, 10),
  };
  const setupItem = {
    price_data: {
      currency: 'gbp',
      product_data: {
        name: `CompliantUK ${q.label} — set-up per property`,
        description: 'Register-Ready data sheet, private certificate vault, gap report and 28-day tracker for the Rental Property Register. The GOV.UK registration fee is paid separately to the government.',
      },
      unit_amount: PRS_PRODUCTS[product].setupPence,
    },
    quantity: q.properties,
  };
  const base = {
    customer_email: cleanEmail,
    metadata,
    allow_promotion_codes: true,
    success_url: `${origin}/success?product=${product}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
  };
  let session;
  if (product === 'monitor') {
    session = await stripe.checkout.sessions.create({
      ...base,
      mode: 'subscription',
      line_items: [
        setupItem,
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'CompliantUK Monitor — per property per month',
              description: 'Certificate expiry alerts at 60, 30 and 7 days, 28-day record reminders and annual fee reminders. Cancel any time.',
            },
            unit_amount: PRS_PRODUCTS.monitor.monthlyPence,
            recurring: { interval: 'month' },
          },
          quantity: q.properties,
        },
      ],
      subscription_data: { metadata },
    });
  } else {
    session = await stripe.checkout.sessions.create({
      ...base,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [setupItem],
      payment_intent_data: { metadata },
    });
  }
  return res.status(200).json({ url: session.url });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.body?.product && PRS_PRODUCTS[req.body.product]) {
      return await prsCheckout(req, res);
    }

    const {
      landlordFirst,
      landlordLast,
      landlordEmail,
      propertyAddress,
      tenants,        // array of { first, last, email }
      package: pkg,   // 'starter' | 'essential' | 'portfolio' | 'scale'
    } = req.body;

    // Validate required fields
    if (!landlordFirst || !landlordLast || !landlordEmail || !propertyAddress || !tenants?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate package
    const packageKey = (pkg || 'starter').toLowerCase();
    if (!PRICING_TIERS[packageKey]) {
      return res.status(400).json({ error: 'Invalid package selection' });
    }

    const tenantCount = tenants.length;
    const pricing = PRICING_TIERS[packageKey];

    // Calculate dynamic price:
    // Base price includes up to 4 tenants. Tenants 5+ are charged at extraTenantPrice each.
    // Examples (Starter): 1 tenant=£49, 2=£49, 3=£49, 4=£49, 5=£57, 6=£65
    const extraTenantCount = Math.max(0, tenantCount - pricing.includedTenants);
    const totalPence = pricing.basePrice + (extraTenantCount * pricing.extraTenantPrice);

    // Serialise tenant data into metadata
    // Stripe has 500 char limit per value — chunk if needed
    const tenantsJson = JSON.stringify(tenants);
    const metadata = {
      landlordFirst,
      landlordLast,
      landlordEmail,
      propertyAddress,
      tenantCount: String(tenantCount),
      package: packageKey,
      includedTenants: String(pricing.includedTenants),
      extraTenantCount: String(extraTenantCount),
      extraTenantCost: String(pricing.extraTenantPrice / 100),
    };

    if (tenantsJson.length <= 490) {
      metadata.tenants = tenantsJson;
    } else {
      // Chunk across multiple keys
      const chunkSize = 490;
      let chunkIndex = 0;
      for (let i = 0; i < tenantsJson.length; i += chunkSize) {
        metadata[`tenants_${chunkIndex}`] = tenantsJson.slice(i, i + chunkSize);
        chunkIndex++;
      }
      metadata.tenantsChunks = String(chunkIndex);
    }

    const origin = req.headers.origin || 'https://www.compliantuk.co.uk';

    // Build a clear description for the Stripe checkout page
    const tenantDesc = tenantCount <= pricing.includedTenants
      ? `${tenantCount} tenant${tenantCount > 1 ? 's' : ''} (all included in base price)`
      : `${tenantCount} tenants (${pricing.includedTenants} included + ${extraTenantCount} extra @ £${pricing.extraTenantPrice / 100} each)`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: landlordEmail,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `CompliantUK — ${pricing.label} Compliance Pack`,
              description: `Information Sheet delivery + proof certificate · ${tenantDesc} · ${propertyAddress}`,
            },
            unit_amount: totalPence,
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#get-compliant`,
      payment_intent_data: {
        metadata: {
          landlordEmail,
          propertyAddress,
          package: packageKey,
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
