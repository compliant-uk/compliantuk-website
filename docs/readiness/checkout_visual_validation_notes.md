# Stripe Checkout Visual Validation Notes

The deployed CompliantUK bulk checkout API successfully created a Stripe Checkout session in sandbox/test mode from a synthetic bulk-upload payload.

Observed checkout page details:

| Field | Observed value |
|---|---|
| Merchant label | Compliant Uk |
| Mode indicator | Sandbox |
| Product | CompliantUK Portfolio — Silver (2–10 properties) |
| Amount | £40.00 |
| Description | Renters Rights Act Information Sheet delivery + proof certificates · 2 properties |
| Customer email | readiness.bulk.1778444913@example.com |
| Payment form | Card, cardholder name, country/region, postcode fields visible |
| Payment status | Not completed; no card details entered |

This validates that the bulk-upload handoff can reach Stripe Checkout with the expected product, amount, property count, and buyer email. Completing the payment requires explicit user confirmation because it is a payment action, even in test mode.
