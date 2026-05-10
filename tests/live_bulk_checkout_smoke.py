import json
import time
import urllib.error
import urllib.request

stamp = int(time.time())
base_email = f"readiness.bulk.{stamp}@example.com"
payload = {
    "plan": "silver",
    "total": 40,
    "pricePerProperty": 20,
    "extraTenantCost": 0,
    "submittedBy": {
        "first": "Readiness",
        "last": "Tester",
        "email": base_email,
    },
    "properties": [
        {
            "propertyAddress": "Test House 1, 31 May Readiness Street, London, SW1A 1AA",
            "address": "Test House 1, 31 May Readiness Street, London, SW1A 1AA",
            "tenants": [
                {"firstName": "Alice", "lastName": "Tenant", "email": f"alice.tenant.{stamp}@example.com"},
                {"firstName": "Bob", "lastName": "Tenant", "email": f"bob.tenant.{stamp}@example.com"},
            ],
        },
        {
            "propertyAddress": "Test House 2, 31 May Readiness Street, Manchester, M1 1AA",
            "address": "Test House 2, 31 May Readiness Street, Manchester, M1 1AA",
            "tenants": [
                {"firstName": "Cara", "lastName": "Tenant", "email": f"cara.tenant.{stamp}@example.com"},
            ],
        },
    ],
    "processingReport": {
        "source": "automated_readiness_test",
        "totalRows": 2,
        "processedProperties": 2,
        "processedTenants": 3,
        "skipped": [],
        "warnings": [],
    },
}

req = urllib.request.Request(
    "https://www.compliantuk.co.uk/api/create-bulk-checkout",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "Origin": "https://www.compliantuk.co.uk"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode("utf-8")
        print(json.dumps({"status": res.status, "body": json.loads(body)}, indent=2))
except urllib.error.HTTPError as exc:
    body = exc.read().decode("utf-8")
    print(json.dumps({"status": exc.code, "body": body}, indent=2))
    raise SystemExit(1)
