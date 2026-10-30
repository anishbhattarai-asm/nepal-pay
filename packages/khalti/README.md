# @nepalpay/khalti

[![npm](https://img.shields.io/npm/v/@nepalpay/khalti)](https://www.npmjs.com/package/@nepalpay/khalti)
[![CI](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)

Khalti ePayment (KPG-2) SDK for Node.js. Starts payments, reads the return redirect, and confirms each
payment with Khalti's lookup API. No runtime dependencies; TypeScript types included.

Unofficial; not affiliated with Khalti. Part of [nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay)
(see also [`@nepalpay/esewa`](https://www.npmjs.com/package/@nepalpay/esewa)).

```sh
npm i @nepalpay/khalti
```

Node.js 22 or newer. ESM and CommonJS.

## Usage

`db` stands for the application's own storage.

```ts
import { createKhalti, paymentAttemptId } from '@nepalpay/khalti';

const khalti = createKhalti({ environment: 'production', secretKey, websiteUrl: 'https://shop.example' });

// Start a payment attempt; the customer is redirected to start.url.
const start = await khalti.initiate({
  amount: order.amount, // rupees, minimum 10
  orderId: paymentAttemptId(order.id),
  returnUrl: 'https://shop.example/khalti/callback',
});
await db.attempts.create({ id: start.reference, orderId: order.id }); // reference is the pidx

// Callback (?pidx=...): unsigned, so the attempt is found by the stored pidx.
const claim = await khalti.parseCallback(req.query);
const attempt = await db.attempts.find(claim.reference);
const order = await db.orders.find(attempt.orderId);
const result = await khalti.verify({ pidx: attempt.id, expectedAmount: order.amount });
if (result.status === 'COMPLETED') await db.orders.markPaid(order.id, result.transactionId);
```

A payment counts as completed only when `verify()` returns `COMPLETED`; the return redirect is
unsigned and only reports a claim. Khalti's lookup does not return the merchant's order id, so the
stored pidx is what links a payment to an order. A full Express example with retries is in the repo's
[`examples/express-demo`](https://github.com/anishbhattarai-asm/nepal-pay/tree/main/examples/express-demo).

## Retries

Each `initiate()` returns a new pidx, and a payment page stays payable for 30 minutes, so an earlier
attempt can complete after a new one starts. `paymentAttemptId(order.id)` gives each attempt its own
id; re-verifying earlier pidx values before a new attempt prevents charging an order twice.

## Security

| Area | Behaviour |
|-|-|
| Status | `verify()` returns `COMPLETED` only from Khalti's lookup API |
| Amount | A completed payment for a different amount throws `AMOUNT_MISMATCH`; amounts must be whole paisa |
| Lookup reply | Must return the same pidx; replies over 1 MB refused |
| URLs | `websiteUrl` and `returnUrl` must be `https` in production; `payment_url` must be `https` |
| Runtime | Refuses to start in a browser page or worker |

## API

| Method | Input | Returns |
|-|-|-|
| `initiate()` | `{ amount, orderId, returnUrl, productName?, customer? }` | `{ type: 'redirect', url, reference, raw }` |
| `parseCallback()` | `req.query`, `URLSearchParams`, query string or URL | `{ reference, orderId?, transactionId?, claimedStatus, amount?, signatureValid: null, raw }` |
| `verify()` | `{ pidx, expectedAmount }` | `{ status, amount, transactionId?, raw }` |

Options: `environment` (`'sandbox'` or `'production'`, required), `secretKey`, `websiteUrl`, and
optional `fetch` and `timeoutMs` (default 15000). `customer` is `{ name?, email?, phone? }`.

| `status` | Khalti |
|-|-|
| `COMPLETED` | Completed |
| `PENDING` | Pending, Initiated |
| `REFUNDED` | Refunded, Partially Refunded |
| `CANCELED` | User canceled |
| `FAILED` | Expired, other |

Errors are `PaymentError` with a `code`: `INVALID_CONFIG`, `INVALID_INPUT`, `AMOUNT_MISMATCH`,
`GATEWAY_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `BROWSER_ENVIRONMENT`. Khalti's own error message is
included in `GATEWAY_ERROR`.

## Testing

88 unit tests cover requests, paisa conversion, every status (including Expired and User canceled,
which Khalti answers with HTTP 400), lookup validation and callback parsing, using a callback and
lookup reply recorded from a completed sandbox payment. Live tests against the Khalti sandbox start a
payment and look it up when `KHALTI_SECRET_KEY` is set. CI runs on Node.js 22, 24 and 26.

Sandbox: merchant keys from [test-admin.khalti.com](https://test-admin.khalti.com/#/join/merchant)
(`live_secret_key` with `environment: 'sandbox'`); customer login Khalti ID `9800000000` to
`9800000005`, MPIN `1111`, OTP `987654`.

## Changelog

- **0.2.1**: Documentation only.
- **0.2.0**: `paymentAttemptId()` for retries. `https` URLs in production (breaking for `http`), `https`
  payment URLs, pidx matching, whole-paisa amounts, 1 MB reply limit, browser worker detection.
- **0.1.1**: Documentation: orders bound by the stored pidx.
- **0.1.0**: First release.

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)
