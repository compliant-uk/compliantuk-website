// api/create-bulk-checkout.js
// Creates a Stripe Checkout session for bulk/portfolio orders.
// Receives full order payload from bulk-upload.html and stores in metadata
// so stripe-webhook.js can process tenants without needing sessionStorage.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLAN_LABELS = {
  silver:   'Silver (2–10 properties)',
  bronze:   'Bronze (11–25 properties)',
  gold:     'Gold (25–50 properties)',
  platinum: 'Platinum (50–100 properties)',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, total, properties, submittedBy, pricePerProperty, extraTenantCost } = req.body;

    if (!plan || !total || !properties?.length || !submittedBy?.email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const totalPence = Math.round(total * 100);
    if (totalPence < 100) {
      return res.status(400).json({ error: 'Total amount too low' });
    }

    const propertyCount = properties.length;
    const origin = req.headers.origin || 'https://www.compliantuk.co.uk';

    // Stripe metadata values max 500 chars per key, 50 keys total.
    // Chunk properties JSON across multiple keys if needed.
    const propertiesJson = JSON.stringify(properties);
    const chunkSize = 490;
    const chunks = [];
    for (let i = 0; i < propertiesJson.length; i += chunkSize) {
      chunks.push(propertiesJson.slice(i, i + chunkSize));
    }
    if (chunks.length > 40) {
      return res.status(400).json({ error: 'Order too large for metadata. Contact support.' });
    }

    const metadata = {
      orderType: 'bulk',
      plan,
      propertyCount: String(propertyCount),
      totalGBP: String(total),
      landlordFirst: submittedBy.first,
      landlordLast: submittedBy.last,
      landlordEmail: submittedBy.email,
      propertiesChunks: String(chunks.length),
    };
    chunks.forEach((chunk, i) => { metadata[`properties_${i}`] = chunk; });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: submittedBy.email,
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `CompliantUK Portfolio — ${PLAN_LABELS[plan] || plan}`,
            description: `Renters Rights Act Information Sheet delivery + proof certificates · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'}`,
          },
          unit_amount: totalPence,
        },
        quantity: 1,
      }],
      metadata,
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&bulk=1`,
      cancel_url: `${origin}/bulk-upload?plan=${plan}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Bulk checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
