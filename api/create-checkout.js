// api/create-checkout.js
// Creates a Stripe Checkout session with all order data in metadata
// Called from index.html and bulk.html on form submit

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers — flat rate per tenancy (pence)
// 1 tenant: £49, 2 tenants: £78, 3 tenants: £97, 4 tenants: £116
// Flat price per tenancy — covers up to 4 tenants
// The tenant count selector only populates input fields, it does NOT change the price
const TENANCY_PRICE = 4900; // £49 per tenancy (flat rate, up to 4 tenants)

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

    const tenantCount = tenants.length;
    const totalPence = TENANCY_PRICE; // flat rate — tenant count doesn't affect price

    // Serialise tenant data into metadata
    // Stripe has 500 char limit per value — chunk if needed
    const tenantsJson = JSON.stringify(tenants);
    const metadata = {
      landlordFirst,
      landlordLast,
      landlordEmail,
      propertyAddress,
      tenantCount: String(tenantCount),
      package: 'starter',
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
              name: `CompliantUK — Starter Compliance Pack`,
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
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
