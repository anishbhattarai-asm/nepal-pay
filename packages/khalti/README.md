# @anishbhattarai/khalti

Unofficial, zero-dependency Khalti KPG-2 (ePayment) SDK for Node.js 20+ and edge runtimes. Not affiliated with Khalti.

```sh
npm i @anishbhattarai/khalti
```

## Usage

```ts
import { createKhalti, isPaymentError } from '@anishbhattarai/khalti';

const khalti = createKhalti({
  environment: 'sandbox', // or 'production'; required, no default
  secretKey: process.env.KHALTI_SECRET_KEY!, // from test-admin.khalti.com in sandbox
  websiteUrl: 'https://shop.example',
});

// 1. Start: returns a payment_url to redirect the customer to.
const start = await khalti.initiate({
  amount: 100, // rupees (sent as paisa); Khalti's minimum is Rs 10
  orderId: 'ORD-1001',
  returnUrl: 'https://shop.example/khalti/callback',
  productName: 'Momo platter',
  customer: { name: 'Sita', phone: '9800000001' },
});
// start.type === 'redirect' -> res.redirect(start.url); store start.reference (the pidx)

// 2. Return redirect: Khalti does NOT sign it, so this is only a claim.
const claim = await khalti.parseCallback(req.query); // also takes a URL, query string or URLSearchParams

// 3. Always confirm with the lookup API before fulfilling the order.
const result = await khalti.verify({ pidx: claim.reference, expectedAmount: order.amount });
if (result.status === 'COMPLETED') fulfil(order);
```

`verify()` returns `{ status, amount, transactionId, raw }` where `status` is one of
`COMPLETED`, `PENDING`, `FAILED`, `REFUNDED` or `CANCELED`.

## Errors

Every failure is a `PaymentError`; check `err.code`:

| Code | When |
|-|-|
| `INVALID_CONFIG` | missing or unknown environment, empty secret, bad websiteUrl |
| `INVALID_INPUT` | bad amount, under Rs 10, empty orderId or pidx, relative URL, callback without pidx |
| `AMOUNT_MISMATCH` | Khalti reports a completed payment for a different amount |
| `GATEWAY_ERROR` | Khalti returned an HTTP error (the message includes Khalti's reason) or an unexpected response |
| `NETWORK_ERROR` / `TIMEOUT` | the request did not complete |
| `BROWSER_ENVIRONMENT` | `createKhalti` was called in a browser |

## Khalti behaviour this package relies on

Checked against docs.khalti.com and the live sandbox on 2026-10-30:

* The lookup API answers `Expired` and `User canceled` with HTTP 400 and a normal body. `verify()` maps those to `FAILED` and `CANCELED` instead of throwing.
* Status spelling is not consistent ("Partially refunded" and "Partially Refunded"), so statuses are matched case-insensitively.
* A wrong key is answered with HTTP 401 `Invalid token.`
