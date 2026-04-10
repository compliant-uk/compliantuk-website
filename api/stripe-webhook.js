// api/stripe-webhook.js
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false,
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Landlord';
    const customFields = session.custom_fields || [];

    // Extract all three custom fields
    const addressField = customFields.find(f =>
      f.key === 'propertyaddress' || f.key === 'property_address'
    );
    const tenantNameField = customFields.find(f =>
      f.key === 'tenantname' || f.key === 'tenant_name'
    );
    const tenantEmailField = customFields.find(f =>
      f.key === 'tenantemail' || f.key === 'tenant_email'
    );

    const propertyAddress = addressField?.text?.value || 'your property';
    const tenantName = tenantNameField?.text?.value || null;
    const tenantEmail = tenantEmailField?.text?.value || null;

    // Detect plan from amount
    const amountTotal = session.amount_total || 0;
    const plan = amountTotal >= 8900 ? 'bundle' : 'starter';

    if (customerEmail) {
      try {
        const emailResponse = await fetch('https://www.compliantuk.co.uk/api/send-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerEmail,
            customerName,
            propertyAddress,
            tenantName,
            tenantEmail,
            plan,
            paymentReference: session.id, // <- ADDED: pass Stripe session id
          }),
        });

        if (!emailResponse.ok) {
          console.error('Failed to send document email');
        } else {
          console.log(`Documents sent to ${customerEmail} for ${propertyAddress}`);
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
      }
    }
  }

  return res.status(200).json({ received: true });
}
