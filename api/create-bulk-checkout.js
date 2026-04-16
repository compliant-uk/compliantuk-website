// api/create-bulk-checkout.js
// Creates a Stripe Checkout session for bulk/portfolio orders
// Stores large order payloads in Supabase instead of Stripe metadata to avoid limits
// Stripe metadata only stores reference ID and basic info

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

    // Store full order payload in Supabase for large orders
    // This avoids Stripe metadata size limits (500 chars per key, 50 keys total)
    let bulkOrderId = null;
    try {
      const { data, error: insertError } = await supabase
        .from('bulk_orders')
        .insert({
          plan,
          property_count: propertyCount,
          total_gbp: total,
          landlord_first: submittedBy.first,
          landlord_last: submittedBy.last,
          landlord_email: submittedBy.email,
          price_per_property: pricePerProperty,
          extra_tenant_cost: extraTenantCost,
          properties_data: JSON.stringify(properties),
          status: 'pending',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to store bulk order:', insertError);
        return res.status(500).json({ error: 'Failed to process bulk order' });
      }

      bulkOrderId = data.id;
    } catch (dbErr) {
      console.error('Bulk order storage error:', dbErr);
      return res.status(500).json({ error: 'Failed to store order data' });
    }

    // Minimal metadata for Stripe — just reference ID and basic info
    const metadata = {
      orderType: 'bulk',
      bulkOrderId: String(bulkOrderId),
      plan,
      propertyCount: String(propertyCount),
      totalGBP: String(total),
      landlordEmail: submittedBy.email,
    };

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
