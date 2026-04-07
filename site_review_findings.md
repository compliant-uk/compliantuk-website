# CompliantUK Live Site Review - Key Findings

## Current Pricing Structure (As Seen on Live Site)

### Starter Pack - £49
- **Type:** One-off payment (no subscription)
- **Scope:** Per property
- **Includes:**
  - Official GOV.UK Information Sheet (only valid version)
  - Proof-of-service certificate
  - Real-time open and read tracking
  - 48-hour auto-reminder if tenant hasn't read
  - Timestamped proof-of-service certificate
  - Landlord dashboard access (all properties)
  - Certificate download for records
  - SSL secured
  - Stripe payments
  - Money-back guarantee

### Portfolio/Agency Plans
- **Mentioned:** "Portfolio from £25/property · Agency plans from £25 · Unlimited retainer £150/mo"
- **Current Status:** Link to "View portfolio pricing" goes to bulk.html (which we just fixed)
- **Need to Check:** What are the actual subscription terms and pricing tiers?

## Current Payment Method
- **Stripe** (Visa, Mastercard, Apple Pay, Google Pay)
- **No PayPal** currently integrated

## Current Calculator/Form
- **Location:** Main page (index.html)
- **Captures:**
  1. Landlord first name
  2. Landlord last name
  3. Landlord email
  4. Property address
  5. Number of tenants (1-4 selector)
  6. Tenant name (per tenant)
  7. Tenant email (per tenant)
- **Price Display:** Shows "1 tenant — Starter compliance pack" with £49 price
- **Calculation:** Appears to be static (£49 per property, not dynamic per tenant)

## Missing Features (Per User Requirements)
1. ❌ **PayPal integration** - Only Stripe currently
2. ❌ **Subscription management** - No visible subscription options on main page
3. ❌ **Expiry alerts** - Not visible in current form
4. ❌ **File upload** - Not visible in current form
5. ❌ **Dynamic calculator** - Price appears static at £49
6. ❌ **Subscription terms display** - Min 3-month, rollover, cancellation policy not shown

## Next Steps
1. Navigate to bulk.html to see portfolio pricing structure
2. Review index.html form to understand current calculator logic
3. Implement:
   - PayPal integration
   - Dynamic pricing calculator
   - Subscription management UI
   - File upload functionality
   - Expiry alert system
   - Subscription terms display in price cards
