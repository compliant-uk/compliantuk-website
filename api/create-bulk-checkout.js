// api/create-bulk-checkout.js
// Creates a Stripe Checkout session for bulk/portfolio orders
// Called from bulk-upload.html on form submit

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Bulk pricing tiers (pounds per property)
const PLAN_LABELS = {
  silver:   { label: 'Silver',   minProps: 2,  maxProps: 10  },
  bronze:   { label: 'Bronze',   minProps: 11, maxProps: 25  },
  gold:     { label: 'Gold',     minProps: 25, maxProps: 50  },
  platinum: { label: 'Platinum', minProps: 50, maxProps: 100 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, total, propertyCount } = req.body;

    if (!plan || !total || !propertyCount) {
      return res.status(400).json({ error: 'Missing required fields: plan, total, propertyCount' });
    }

    const planInfo = PLAN_LABELS[plan] || { label: plan.charAt(0).toUpperCase() + plan.slice(1) };
    const totalPence = Math.round(total * 100);

    if (totalPence < 100) {
      return res.status(400).json({ error: 'Total amount too low' });
    }

    const origin = req.headers.origin || 'https://www.compliantuk.co.uk';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `CompliantUK Portfolio — ${planInfo.label} Plan`,
              description: `Renters Rights Act Information Sheet delivery + proof certificates · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'}`,
            },
            unit_amount: totalPence,
          },
          quantity: 1,
        },
      ],
      metadata: {
        orderType: 'bulk',
        plan,
        propertyCount: String(propertyCount),
        totalGBP: String(total),
      },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&bulk=1`,
      cancel_url: `${origin}/bulk-upload?plan=${plan}`,
      payment_intent_data: {
        metadata: {
          orderType: 'bulk',
          plan,
          propertyCount: String(propertyCount),
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Bulk checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
