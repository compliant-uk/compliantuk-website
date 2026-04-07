# CompliantUK Deployment Checklist

## ✅ COMPLETED FIXES

### 1. Certificate Data Flow
- ✅ Fixed `stripe-webhook.js` to pass `paymentReference: session.id` to send-documents
- ✅ Certificate now receives property address and tenant name correctly
- ✅ Data flows: Form → Stripe → Webhook → send-documents → generate-certificate → Email

### 2. PayPal Integration
- ✅ Created `api/paypal-webhook.js` handler
- ✅ Added PayPal button to index.html
- ✅ Integrated PayPal SDK with order creation and capture
- ✅ Sends data to paypal-webhook after payment approval
- ✅ Generates certificates and sends emails to landlord + tenant

### 3. Dynamic Calculator
- ✅ Created `api/calculator.js` with pricing tiers
- ✅ Supports all 5 packages (Starter, Essential, Portfolio, Scale, Unlimited)
- ✅ Calculates base cost + extra tenant costs
- ✅ Subscription support (3-month minimum, auto-renewal)

### 4. Website Audit Fixes
- ✅ Restored correct bulk.html
- ✅ Added hamburger menus to about.html, blog-post.html
- ✅ Fixed dashboard.html SEO metadata
- ✅ Updated success.html post-payment guidance
- ✅ Added SEO metadata to all pages

## 🔴 DEPLOYMENT REQUIREMENTS

### Environment Variables (Add to .env or hosting provider)
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
PAYPAL_CLIENT_ID=YOUR_PAYPAL_CLIENT_ID
```

### PayPal Setup
1. Replace `YOUR_PAYPAL_CLIENT_ID` in index.html line 2437
2. Ensure PayPal account is in LIVE mode (not sandbox)
3. Currency set to GBP

### Files Modified
- `/index.html` - Added PayPal button + SDK + integration script
- `/api/stripe-webhook.js` - Added paymentReference to payload
- `/api/paypal-webhook.js` - NEW file (PayPal payment handler)
- `/api/calculator.js` - NEW file (dynamic pricing calculator)
- `/about.html` - Added hamburger menu
- `/blog-post.html` - Added hamburger menu
- `/dashboard.html` - Fixed SEO metadata
- `/success.html` - Updated post-payment guidance
- Other pages - Added SEO metadata

### Testing Checklist
- [ ] Test Stripe payment (existing flow)
- [ ] Test PayPal payment (new flow)
- [ ] Verify certificates include property address + tenant name
- [ ] Verify emails sent to landlord + tenant
- [ ] Test hamburger menu on mobile (all pages)
- [ ] Test calculator API: POST /api/calculator with { tenancies: 5, extraTenants: 2 }
- [ ] Verify bulk.html portfolio pricing displays correctly
- [ ] Check all links work (portfolio button, navigation)

### Go-Live Steps
1. Push all modified files to production
2. Set environment variables in hosting provider
3. Update PayPal Client ID in index.html
4. Run smoke tests (Stripe + PayPal payments)
5. Monitor error logs for 24 hours
6. Announce live status

## 📋 REMAINING FEATURES (Not in this release)

- Subscription management UI (expiry alerts, cancellation)
- File upload for bulk orders
- Advanced calculator UI on bulk.html
- Multi-tenant support in dashboard

## 🆘 SUPPORT

If issues arise:
1. Check environment variables are set
2. Verify PayPal Client ID is correct
3. Check Stripe webhook is configured
4. Review browser console for errors
5. Check server logs for API errors
