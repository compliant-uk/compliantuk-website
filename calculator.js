// Dynamic pricing calculator
// Canonical pricing structure used by index.html, bulk.html, bulk-upload.html,
// api/create-checkout.js, and api/create-bulk-checkout.js.
// Base price includes up to four tenants per property; tenant 5+ is charged
// at the tier-specific extra tenant rate.

export const PRICING_TIERS = {
  starter: { name: 'Starter', price: 49, extraTenant: 8, min: 1, max: 1, includedTenants: 4 },
  bronze: { name: 'Bronze', price: 44, extraTenant: 8, min: 2, max: 10, includedTenants: 4 },
  silver: { name: 'Silver', price: 39, extraTenant: 7, min: 11, max: 25, includedTenants: 4 },
  gold: { name: 'Gold', price: 29, extraTenant: 6, min: 26, max: 50, includedTenants: 4 },
  platinum: { name: 'Platinum', price: 24, extraTenant: 5, min: 51, max: 100, includedTenants: 4 },
  agency: { name: 'Agency/Batch', price: 19, extraTenant: 5, min: 101, max: 1000, includedTenants: 4 },
};

export function selectTier(propertyCount) {
  const count = Number(propertyCount);
  if (count >= 101) return PRICING_TIERS.agency;
  return Object.values(PRICING_TIERS).find((tier) => count >= tier.min && count <= tier.max) || null;
}

export function calculatePrice(propertyCount = 1, extraTenants = 0, tierKey = null) {
  const numericPropertyCount = Number(propertyCount);
  const numericExtraTenants = Math.max(0, Number(extraTenants) || 0);
  const explicitTier = tierKey ? PRICING_TIERS[String(tierKey).toLowerCase()] : null;
  const tier = explicitTier || selectTier(numericPropertyCount);

  if (!Number.isFinite(numericPropertyCount) || numericPropertyCount < 1) {
    return { error: 'Invalid number of properties' };
  }

  if (!tier) return { error: 'Invalid number of properties' };

  const baseCost = tier.price * numericPropertyCount;
  const extraCost = tier.extraTenant * numericExtraTenants;
  const subtotal = baseCost + extraCost;

  return {
    tier: tier.name,
    total: subtotal,
    breakdown: {
      properties: numericPropertyCount,
      pricePerProperty: tier.price,
      includedTenantsPerProperty: tier.includedTenants,
      extraTenants: numericExtraTenants,
      extraTenantPrice: tier.extraTenant,
      baseCost,
      extraCost,
      subtotal,
    },
  };
}

// HTTP handler for deployments that route this helper as an API endpoint.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { properties = 1, tenancies, extraTenants = 0, tier } = req.body || {};
  const propertyCount = properties ?? tenancies ?? 1;
  const result = calculatePrice(propertyCount, extraTenants, tier);

  return res.status(200).json(result);
}
