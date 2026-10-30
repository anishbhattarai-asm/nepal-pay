# @anishbhattarai/esewa

Unofficial, zero-dependency eSewa ePay v2 SDK for Node.js 20+ and edge runtimes. Not affiliated with eSewa.

```sh
npm i @anishbhattarai/esewa
```

## Usage

```ts
import { createEsewa, isPaymentError } from '@anishbhattarai/esewa';

const esewa = createEsewa({
  environment: 'sandbox', // or 'production'; required, no default
  productCode: process.env.ESEWA_PRODUCT_CODE!, // EPAYTEST in sandbox
  secretKey: process.env.ESEWA_SECRET_KEY!, // 8gBm/:&EnhH.1/q in sandbox
});

// 1. Start: returns a signed form. Render it and auto-submit it from the browser.
const form = await esewa.initiate({
  amount: 100, // rupees, max 2 decimals
  orderId: 'ORD-1001', // letters, digits, "-" and "_"
  returnUrl: 'https://shop.example/esewa/callback',
  failureUrl: 'https://shop.example/esewa/failure/ORD-1001',
});
// form.type === 'form' -> POST form.fields to form.action

// 2. Success redirect: eSewa appends ?data=<base64>. parseCallback checks the HMAC signature.
const claim = await esewa.parseCallback({ data: String(req.query.data) });

// 3. Always confirm with eSewa before fulfilling the order.
const result = await esewa.verify({ orderId: claim.orderId!, amount: order.amount });
if (result.status === 'COMPLETED') fulfil(order);
```

`verify()` returns `{ status, amount, orderId, transactionId, raw }` where `status` is one of
`COMPLETED`, `PENDING`, `FAILED`, `REFUNDED` or `CANCELED`.

## Errors

Every failure is a `PaymentError`; check `err.code`:

| Code | When |
|-|-|
| `INVALID_CONFIG` | missing or unknown environment, empty product code or secret |
| `INVALID_INPUT` | bad amount, unsafe orderId, relative URL, unreadable callback |
| `SIGNATURE_MISMATCH` | the callback was not signed with your secret key; do not trust it |
| `AMOUNT_MISMATCH` | eSewa reports a completed payment for a different amount |
| `GATEWAY_ERROR` | eSewa returned an HTTP error or a response we do not understand |
| `NETWORK_ERROR` / `TIMEOUT` | the request did not complete |
| `BROWSER_ENVIRONMENT` | `createEsewa` was called in a browser |

## eSewa behaviour this package relies on

Checked against the live sandbox on 2026-10-30:

* A wrong amount in the status check comes back as `NOT_FOUND`, so `verify()` reports `FAILED`.
* An order that was started but not paid reports `PENDING`.
* eSewa signs `total_amount=1000.0` but sends `1000.0` as a JSON number. The callback decoder keeps the raw text, otherwise every round amount would fail the signature check.
* A bad form signature is answered with HTTP 400 `ES104 Invalid payload signature.`
