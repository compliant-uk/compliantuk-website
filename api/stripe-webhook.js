// api/stripe-webhook.js
// Listens for Stripe payment success events and triggers document email

import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false, // Required for Stripe signature verification
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe env vars not set');
    return res.status(500).json({ error: 'Payment service not configured' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  let event;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Handle payment success
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Landlord';

    // Extract property address from Stripe custom_fields
    const customFields = session.custom_fields || [];
    const addressField = customFields.find(f =>
      f.key === 'propertyaddress' || f.key === 'property_address'
    );
    const propertyAddress = addressField?.text?.value || 'your property';

    // Detect plan from payment amount (£49 = starter, £89 = bundle)
    const amountTotal = session.amount_total || 0;
    const plan = amountTotal >= 8900 ? 'bundle' : 'starter';

    if (customerEmail) {
      try {
        // Call our send-documents endpoint
        const emailResponse = await fetch('https://www.compliantuk.co.uk/api/send-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerEmail,
            customerName,
            propertyAddress,
            plan,
          }),
        });

        if (!emailResponse.ok) {
          console.error('Failed to send document email');
        } else {
          console.log(`Documents sent to ${customerEmail} for ${propertyAddress}`);
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
        // Don't fail the webhook — Stripe will retry if we return an error
      }
    }
  }

  // Always return 200 to acknowledge receipt of the event
  return res.status(200).json({ received: true });
}

/*
NOTES FOR STRIPE SETUP:
========================
1. Add these env vars to Vercel:
   - STRIPE_SECRET_KEY = sk_live_xxx (from Stripe Dashboard -> Developers -> API Keys)
   - STRIPE_WEBHOOK_SECRET = whsec_xxx (from Stripe Dashboard -> Webhooks -> your endpoint)

2. In Stripe Dashboard -> Webhooks -> Add Endpoint:
   URL: https://www.compliantuk.co.uk/api/stripe-webhook
   Events to listen for: checkout.session.completed

3. For property address collection:
   Option A (easiest): Add a "Custom field" to your Stripe Payment Link
   - Stripe Dashboard -> Payment Links -> your link -> Edit
   - Add Custom Field: "Property Address" (text field, required)
   - This will appear in session.custom_fields[] — update the webhook to read it

   Option B: Collect on your site before redirecting to Stripe
   - Add a form on index.html to collect the address
   - Pass it as metadata when creating a Checkout Session via API
*/
