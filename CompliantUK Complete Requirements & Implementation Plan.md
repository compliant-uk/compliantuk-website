# CompliantUK Complete Requirements & Implementation Plan

## Current Pricing Tiers (From bulk.html)

| Package | Price | Scope | Extra Tenants | Payment Type | Min Term |
|---------|-------|-------|----------------|--------------|----------|
| **Starter** | £49 | 1 tenancy | +£8 each | One-off | N/A |
| **Essential** | £39 | 2-10 tenancies | +£6 each | One-off batch | Min 2 |
| **Portfolio** | £29 | 11-49 tenancies | +£6 each | One-off | N/A |
| **Scale** | £22 | 50-100 tenancies | +£5 each | One-off | N/A |
| **Unlimited** | £199/mo | 100-250/month | +£5 each | Subscription | **3-month min** |

## User Requirements (New)

### 1. Payment Integration
- **Add PayPal** alongside existing Stripe
- **One-off payment:** £49 (already working)
- **Subscription:** Stripe or PayPal subscriptions for Unlimited plan

### 2. Subscription Management (Unlimited Plan)
- **Minimum commitment:** 3 months
- **Auto-renewal:** Monthly after 3-month term
- **Cancellation:** Allowed anytime after 3-month minimum with 30 days notice
- **Rollover costs:** Include in final purchase price calculation
- **Expiry alerts:** 3 notifications in the week before 3-month expiry
  - Alert 1: 7 days before
  - Alert 2: 3 days before
  - Alert 3: 1 day before
- **Alert delivery:** Email to landlord

### 3. Dynamic Calculator (Active/Real-time)
- **Location:** Main page (index.html) and bulk.html
- **Functionality:**
  - Select package (Starter, Essential, Portfolio, Scale, Unlimited)
  - Input number of tenancies
  - Input number of additional tenants per tenancy (1-4)
  - Real-time price calculation
  - Show itemized breakdown:
    - Base cost (tenancies × package price)
    - Extra tenant costs
    - Subtotal
    - Taxes (if applicable)
    - **Final total**
  - For subscriptions: Show monthly cost × 3 months + rollover info
- **Display:** Update instantly as user adjusts inputs

### 4. File Upload Capability
- **Purpose:** Users can upload property/tenant details directly
- **Alternative to:** Manual form entry or emailing support
- **File types:** CSV, PDF, Excel
- **Placement:** In order form or dashboard
- **Processing:** Parse file and auto-populate form fields

### 5. Order Summary for All Parties
- **Landlord:** Sees full itemized bill before payment
- **Tenant:** Receives Information Sheet + proof certificate (already working)
- **Support:** Can view order details in admin/dashboard

### 6. Certificate Data Issue (To Fix)
- **Problem:** Certificate missing property address and tenant name
- **Solution:** Ensure form captures these fields and passes to certificate generator
- **Verification:** Check data flow: Form → API → Resend → Email

## Implementation Priority

### Phase 1: Critical Fixes (Website Audit)
1. ✅ Fix bulk.html (restore from backup)
2. ✅ Add hamburger menus to all pages
3. ✅ Fix dashboard.html SEO metadata
4. ✅ Update success.html post-payment guidance
5. ✅ Add SEO metadata to all pages
6. ⏳ Add hamburger menus to remaining pages (dashboard, auth pages)

### Phase 2: Certificate & Data Flow
7. Fix certificate data flow (property address + tenant name)
8. Verify Resend email integration

### Phase 3: Payment & Subscription
9. Integrate PayPal payment gateway
10. Implement Stripe subscription management
11. Build subscription expiry alert system (3 notifications)
12. Add cancellation/renewal logic

### Phase 4: Calculator & UX
13. Build dynamic pricing calculator
14. Add real-time cost updates
15. Show itemized breakdown
16. Display subscription terms in price cards

### Phase 5: File Upload
17. Implement file upload functionality
18. Add CSV/Excel parser
19. Auto-populate form from uploaded file

## Technical Notes

- **Current Payment:** Stripe only (via checkout button)
- **Current Email Service:** Resend (for sending documents)
- **Current Form:** Captures landlord info, property address, tenant details
- **Current Calculator:** Static (shows £49 for Starter)
- **Mobile Navigation:** Being standardized across all pages

## Questions for User

1. **PayPal integration:** Use PayPal Commerce Platform or standard checkout?
2. **Subscription management:** Stripe Billing or custom backend?
3. **File upload formats:** CSV, Excel, PDF, or all three?
4. **Expiry alerts:** Email only or also dashboard notifications?
5. **Certificate template:** Should it display property address and tenant name in specific format?
