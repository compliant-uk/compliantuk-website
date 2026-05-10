# Stripe Test Payment Validation Notes

A controlled Stripe sandbox checkout payment was completed using synthetic buyer data and Stripe test card `4242 4242 4242 4242` for the generated bulk checkout session `cs_test_a1Oz0b61aTqCYU6iE2BI010PgvVErYaZY7aF0Pulz8ahKxNa7uWbEc5wB3`.

The checkout page showed the expected order summary before payment: **CompliantUK Portfolio — Silver (2–10 properties)**, **£40.00**, described as **Renters Rights Act Information Sheet delivery + proof certificates · 2 properties**. After payment submission, Stripe redirected to `https://www.compliantuk.co.uk/success?session_id=cs_test_a1Oz0b61aTqCYU6iE2BI010PgvVErYaZY7aF0Pulz8ahKxNa7uWbEc5wB3&bulk=1`.

The success page rendered **Compliance Confirmed — CompliantUK** and the hero text stated that payment was confirmed and tenants are being emailed with the official Information Sheet. However, the visible order summary displayed placeholder dashes for property, landlord, tenants, and amount paid. This indicates the success-page display does not yet hydrate bulk-session details even though checkout/payment completed. This should be treated as a customer-facing polish/accuracy issue for the buyer journey.

Next verification required: inspect Supabase `bulk_orders` status and processing fields for this checkout session, then check Stripe/webhook logs or database state to confirm the post-payment webhook completed as expected.

## Supabase post-payment verification

The synthetic checkout session was found in Supabase with `status = processed`, `plan = silver`, `property_count = 2`, `total_gbp = 40.00`, and the expected synthetic landlord email `readiness.bulk.1778444913@example.com`. This confirms that the deployed checkout/payment/webhook path can receive a successful Stripe test payment and update the bulk order to a processed state.

A remaining live-deployment discrepancy was identified: `properties_data` is currently stored as JSONB shape `string` rather than `array`, and `processing_report` is `null` for the deployed synthetic order. The local repository already contains compatibility and processing-summary improvements, but this result shows the current deployed API/webhook is not yet serving the improved contract. Next step is to finish validating the local patch, commit/push the business-site fixes, and then re-test against the updated Vercel deployment.
