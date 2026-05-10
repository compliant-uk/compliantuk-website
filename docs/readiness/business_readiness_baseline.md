# CompliantUK Business Readiness Baseline

This baseline records the business and compliance assumptions that will guide the technical audit. It is not legal advice; it is a product-readiness summary based on the live CompliantUK site, the repository requirements document, and official GOV.UK/MHCLG public guidance.

## Compliance workflow that the product must protect

The live CompliantUK proposition is an automated document-delivery and proof-of-service workflow for private landlords in England. The public site currently promises that landlords enter landlord, property, and tenant details; pay through Stripe; and then the official GOV.UK Renters’ Rights Act Information Sheet is emailed individually to every tenant, with dashboard proof and certificate access. GOV.UK states that the Information Sheet must be given to every tenant named on the tenancy agreement where the published eligibility criteria apply, that it must be given by 31 May 2026, and that a failure may lead to a fine up to £7,000.[1]

> GOV.UK states: “A copy must be given to every tenant named on the tenancy agreement.” It also states: “You must not email or text a link to the PDF to the tenant, as this will not be valid.”[1]

This makes the **bulk upload flow legally sensitive from a product-risk perspective**. Invalid tenant rows should not silently disappear. Valid rows should continue processing where safe, but every omitted or rejected record must be surfaced clearly before payment, after processing, or both, so the buyer understands what still needs immediate attention.

| Requirement area | Product implication for testing |
|---|---|
| Official PDF delivery | Emails must attach the official GOV.UK PDF rather than merely linking to it. |
| Every named tenant | Bulk upload must preserve one tenant row per intended recipient and must report skipped rows. |
| Proof of dispatch | Successful processing must create auditable order, property, tenant, and dispatch records. |
| Deadline urgency | Error states must be direct, non-ambiguous, and suitable for fast correction. |
| Accessibility alternatives | Alternative formats may supplement but not replace the official PDF.[2] |

## Repository requirements that must be verified

The repository’s implementation plan lists **file upload capability** as a core requirement, including CSV, PDF, and Excel support, with parsing that can auto-populate form fields. It also identifies order summaries, certificate data flow, Stripe payment, pricing tiers, and subscription handling as broader implementation concerns. The current immediate priority is therefore to conclude the Excel/CSV download and import path first, then verify payment and buyer journeys.

| Immediate audit priority | Acceptance standard |
|---|---|
| CSV template download | The downloaded file must open correctly, contain expected headers, and be usable for bulk property/tenant import. |
| XLSX template download | The downloaded workbook must be a real valid Excel file, not a mislabeled CSV or corrupted binary. |
| Bulk parsing | Valid rows must be accepted; invalid rows must be omitted with row-level reasons. |
| Summary before payment | The customer must see processed/skipped counts and the data that will proceed to checkout. |
| Payment handoff | The accepted batch must reach the Stripe checkout creation step with accurate pricing and metadata. |

## References

[1]: https://www.gov.uk/government/publications/the-renters-rights-act-information-sheet-2026 "The Renters’ Rights Act Information Sheet 2026 - GOV.UK"
[2]: https://www.gov.uk/guidance/the-renters-rights-act-information-sheet-2026-alternative-formats "The Renters' Rights Act Information Sheet 2026 alternative formats - GOV.UK"
