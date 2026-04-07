// Dynamic pricing calculator
// Pricing structure from bulk.html

const PRICING_TIERS = {
  1: { name: 'Starter', price: 49, extraTenant: 8, min: 1, max: 1 },
  2: { name: 'Essential', price: 39, extraTenant: 6, min: 2, max: 10 },
  3: { name: 'Portfolio', price: 29, extraTenant: 6, min: 11, max: 49 },
  4: { name: 'Scale', price: 22, extraTenant: 5, min: 50, max: 100 },
  5: { name: 'Unlimited', price: 199, extraTenant: 5, min: 100, max: 250, monthly: true }
};

export function calculatePrice(numTenancies, extraTenants = 0, isSubscription = false) {
  let tier = null;
  
  // Find appropriate tier
  for (let t of Object.values(PRICING_TIERS)) {
    if (numTenancies >= t.min && numTenancies <= t.max) {
      tier = t;
      break;
    }
  }
  
  if (!tier) return { error: 'Invalid number of tenancies' };
  
  const baseCost = tier.price * numTenancies;
  const extraCost = tier.extraTenant * extraTenants;
  const subtotal = baseCost + extraCost;
  
  if (isSubscription && tier.monthly) {
    // 3-month minimum subscription
    const monthlyTotal = subtotal;
    const threeMonthTotal = monthlyTotal * 3;
    return {
      tier: tier.name,
      monthly: monthlyTotal,
      threeMonth: threeMonthTotal,
      total: threeMonthTotal,
      breakdown: {
        tenancies: numTenancies,
        pricePerTenancy: tier.price,
        baseCost: baseCost,
        extraTenants: extraTenants,
        extraCost: extraCost,
        subtotal: subtotal,
        months: 3,
        renewal: 'Auto-renews monthly after 3-month term. Cancel anytime with 30 days notice.'
      }
    };
  }
  
  return {
    tier: tier.name,
    total: subtotal,
    breakdown: {
      tenancies: numTenancies,
      pricePerTenancy: tier.price,
      baseCost: baseCost,
      extraTenants: extraTenants,
      extraCost: extraCost,
      subtotal: subtotal
    }
  };
}

// HTTP handler
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { tenancies = 1, extraTenants = 0, isSubscription = false } = req.body;
  const result = calculatePrice(tenancies, extraTenants, isSubscription);
  
  return res.status(200).json(result);
}
