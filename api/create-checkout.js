// api/create-checkout.js
// Creates a Stripe Checkout session with dynamic pricing based on package and tenant count
// Called from index.html on form submit

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers — per tenancy (pence)
// Each tier has a base price per tenancy and additional cost per extra tenant
const PRICING_TIERS = {
  starter: { basePrice: 4900, extraTenantPrice: 800, label: 'Starter' },      // £49 base, +£8 per extra tenant
  essential: { basePrice: 3900, extraTenantPrice: 600, label: 'Essential' },   // £39 base, +£6 per extra tenant
  portfolio: { basePrice: 2900, extraTenantPrice: 600, label: 'Portfolio' },   // £29 base, +£6 per extra tenant
  scale: { basePrice: 2200, extraTenantPrice: 500, label: 'Scale' },           // £22 base, +£5 per extra tenant
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
    // Base price for the package + extra tenant costs
    // (First tenant included in base price, additional tenants cost extra)
    const extraTenantCount = Math.max(0, tenantCount - 1);
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
      pricePerTenant: String(pricing.basePrice / 100),
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
              description: `Information Sheet delivery + proof certificate · ${tenantCount} tenant${tenantCount > 1 ? 's' : ''} · ${propertyAddress}`,
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
