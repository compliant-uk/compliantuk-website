// api/create-checkout.js
// Creates a Stripe Checkout session with all order data in metadata
// Called from index.html and bulk.html on form submit

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers (pence)
const PRICING = {
  starter:   { base: 4900, extraTenant: 800 },   // £49 + £8/extra tenant
  essential: { base: 3900, extraTenant: 600 },   // £39 + £6/extra tenant
  portfolio: { base: 2900, extraTenant: 600 },   // £29 + £6/extra tenant
  scale:     { base: 2200, extraTenant: 500 },   // £22 + £5/extra tenant
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      landlordFirst,
      landlordLast,
      landlordEmail,
      propertyAddress,
      tenants,        // array of { first, last, email }
      package: pkg,  // 'starter' | 'essential' | 'portfolio' | 'scale'
    } = req.body;

    // Validate required fields
    if (!landlordFirst || !landlordLast || !landlordEmail || !propertyAddress || !tenants?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const packageName = pkg || 'starter';
    const tier = PRICING[packageName] || PRICING.starter;

    // Calculate price
    const tenantCount = tenants.length;
    const extraTenants = Math.max(0, tenantCount - 1);
    const totalPence = tier.base + (extraTenants * tier.extraTenant);

    // Serialise tenant data into metadata (Stripe has 500 char limit per value)
    // We store as JSON string - safe for up to ~10 tenants inline
    // For bulk orders, tenants are chunked
    const tenantsJson = JSON.stringify(tenants.slice(0, 20)); // cap at 20 for metadata

    const origin = req.headers.origin || 'https://www.compliantuk.co.uk';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: landlordEmail,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `CompliantUK — ${packageName.charAt(0).toUpperCase() + packageName.slice(1)} Pack`,
              description: `Information Sheet delivery + proof certificate · ${tenantCount} tenant${tenantCount > 1 ? 's' : ''} · ${propertyAddress}`,
            },
            unit_amount: totalPence,
          },
          quantity: 1,
        },
      ],
      metadata: {
        landlordFirst,
        landlordLast,
        landlordEmail,
        propertyAddress,
        tenantCount: String(tenantCount),
        package: packageName,
        tenants: tenantsJson,
      },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#get-compliant`,
      payment_intent_data: {
        metadata: {
          landlordEmail,
          propertyAddress,
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
