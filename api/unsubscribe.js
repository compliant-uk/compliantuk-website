// api/unsubscribe.js
// Handles unsubscribe requests from email links with token-based verification
// Marks subscribers as unsubscribed in Supabase

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Generate a simple token from email (deterministic for verification)
function generateToken(email) {
  return crypto.createHash('sha256').update(email + process.env.UNSUBSCRIBE_SECRET || 'default-secret').digest('hex');
}

export default async function handler(req, res) {
  // Support both GET (from email link) and POST (API call)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let email, token;

    if (req.method === 'GET') {
      // From email link: /api/unsubscribe?email=...&token=...
      email = req.query.email;
      token = req.query.token;
    } else {
      // From API call: POST with { email, token }
      email = req.body?.email;
      token = req.body?.token;
    }

    if (!email || !token) {
      return res.status(400).json({ error: 'Missing email or token' });
    }

    // Verify token
    const expectedToken = generateToken(email);
    if (token !== expectedToken) {
      return res.status(401).json({ error: 'Invalid unsubscribe token' });
    }

    // Mark as unsubscribed in Supabase
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({ subscribed: false, unsubscribed_at: new Date().toISOString() })
      .eq('email', email);

    if (updateError) {
      console.error('Unsubscribe update error:', updateError);
      return res.status(500).json({ error: 'Failed to unsubscribe' });
    }

    // If GET request, return HTML confirmation page
    if (req.method === 'GET') {
      return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed — CompliantUK</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 60px auto; background: white; border-radius: 12px; padding: 40px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
    h1 { color: #1e293b; font-size: 24px; margin: 0 0 12px; }
    p { color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    a { color: #3b82f6; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
<div class="container">
  <div class="icon">✓</div>
  <h1>You've been unsubscribed</h1>
  <p>Your email has been removed from our mailing list. You won't receive any more emails from CompliantUK.</p>
  <p>If you change your mind, you can <a href="https://www.compliantuk.co.uk/blog">resubscribe anytime</a>.</p>
  <p style="margin-top: 32px; font-size: 12px; color: #94a3b8;">© 2026 CompliantUK</p>
</div>
</body>
</html>`);
    }

    // If POST request, return JSON
    return res.status(200).json({ success: true, message: 'Successfully unsubscribed' });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return res.status(500).json({ error: 'Failed to process unsubscribe request' });
  }
}
