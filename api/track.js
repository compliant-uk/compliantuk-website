// api/track.js
// Invisible 1x1 tracking pixel — records when tenants open their email
// Updates tenancy status: sent → opened → read
// Certificates are generated at purchase time, NOT here

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export default async function handler(req, res) {
  // Always serve the pixel immediately
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(PIXEL);

  const { id: trackingId } = req.query;
  if (!trackingId) return;

  try {
    const { data: tenancy, error } = await supabase
      .from('tenancies')
      .select('id, status, tracking_id')
      .eq('tracking_id', trackingId)
      .single();

    if (error || !tenancy) return;

    // Already fully tracked — nothing more to do
    if (tenancy.status === 'read') return;

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || 'Unknown';

    const ua = req.headers['user-agent'] || 'Unknown';
    const device = parseDevice(ua);
    const now = new Date().toISOString();

    if (tenancy.status === 'sent') {
      // First open
      await supabase
        .from('tenancies')
        .update({
          status: 'opened',
          opened_at: now,
          tenant_ip: ip,
          tenant_device: device,
        })
        .eq('tracking_id', trackingId);
    } else if (tenancy.status === 'opened') {
      // Second pixel fire = read confirmation
      await supabase
        .from('tenancies')
        .update({ status: 'read', read_at: now })
        .eq('tracking_id', trackingId);
    }
  } catch (err) {
    console.error('Track error:', err.message);
  }
}

function parseDevice(ua) {
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}
