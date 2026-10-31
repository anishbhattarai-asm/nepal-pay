# @nepalpay/esewa

[![npm](https://img.shields.io/npm/v/@nepalpay/esewa)](https://www.npmjs.com/package/@nepalpay/esewa)
[![CI](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)

eSewa ePay v2 SDK for Node.js. Signs the payment form, verifies the signed callback, and confirms each
payment with eSewa's status API. No runtime dependencies; TypeScript types included.

Unofficial; not affiliated with eSewa. Part of [nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay)
(see also [`@nepalpay/khalti`](https://www.npmjs.com/package/@nepalpay/khalti)).

```sh
npm i @nepalpay/esewa
```

Node.js 22 or newer. ESM and CommonJS.

## Usage

`db` stands for the application's own storage.

```ts
import { createEsewa, paymentAttemptId } from '@nepalpay/esewa';

const esewa = createEsewa({ environment: 'production', productCode, secretKey });

// Start a payment attempt; the browser POSTs form.fields to form.action.
const attemptId = paymentAttemptId(order.id);
await db.attempts.create({ id: attemptId, orderId: order.id });
const form = await esewa.initiate({
  amount: order.amount, // rupees
  orderId: attemptId,
  returnUrl: 'https://shop.example/esewa/callback',
  failureUrl: `https://shop.example/esewa/failure/${attemptId}`,
});

// Callback (?data=...): signature check, then the status from eSewa.
const claim = await esewa.parseCallback({ data: String(req.query.data) });
const attempt = await db.attempts.find(claim.orderId!);
const order = await db.orders.find(attempt.orderId);
const result = await esewa.verify({ orderId: attempt.id, amount: order.amount });
if (result.status === 'COMPLETED') await db.orders.markPaid(order.id, result.transactionId);
```

A payment counts as completed only when `verify()` returns `COMPLETED`; `parseCallback()` reports what
the redirect claims. A full Express example with retries is in the repo's
[`examples/express-demo`](https://github.com/anishbhattarai-asm/nepal-pay/tree/main/examples/express-demo).

## Retries

eSewa rejects a reused `transaction_uuid` (`Duplicate transaction UUID.`), and an abandoned attempt
stays `PENDING`, so it can still be paid later. `paymentAttemptId(order.id)` gives each attempt its own
id; re-verifying earlier attempts before a new one prevents charging an order twice.

## Security

| Area | Behaviour |
|-|-|
| Status | `verify()` returns `COMPLETED` only from eSewa's status API |
| Amount | A completed payment for a different amount throws `AMOUNT_MISMATCH` |
| Callback | HMAC-SHA256, constant-time compare; signature must cover status, amount, transaction id and product code; product code must match; data over 4 KB refused |
| Status reply | Must echo the same transaction id and product code, with a whole-paisa amount; replies over 1 MB refused |
| URLs | `returnUrl` and `failureUrl` must be `https` in production |
| Runtime | Refuses to start in a browser page or worker |

## API

| Method | Input | Returns |
|-|-|-|
| `initiate()` | `{ amount, orderId, returnUrl, failureUrl? }` | `{ type: 'form', action, fields, reference }` |
| `parseCallback()` | `{ data }` | `{ reference, orderId, transactionId?, claimedStatus, amount, signatureValid: true, raw }` |
| `verify()` | `{ orderId, amount }` | `{ status, amount, orderId, transactionId?, raw }` |

Options: `environment` (`'sandbox'` or `'production'`, required), `productCode`, `secretKey`, and
optional `fetch` and `timeoutMs` (default 15000). `failureUrl` defaults to `returnUrl`.

| `status` | eSewa |
|-|-|
| `COMPLETED` | COMPLETE |
| `PENDING` | PENDING, AMBIGUOUS |
| `REFUNDED` | FULL_REFUND, PARTIAL_REFUND |
| `CANCELED` | CANCELED |
| `FAILED` | NOT_FOUND, other |

Errors are `PaymentError` with a `code`: `INVALID_CONFIG`, `INVALID_INPUT`, `SIGNATURE_MISMATCH`,
`AMOUNT_MISMATCH`, `GATEWAY_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `BROWSER_ENVIRONMENT`. `retryable` is
true for `NETWORK_ERROR`, `TIMEOUT` and HTTP 429 or 5xx, and means the failure is transient. A
failed `verify()` leaves the payment unknown, not failed; `verify()` only reads, so it is safe to
repeat later. `initiate()` signs the form locally and sends no request.

## Testing

103 unit tests cover signing, signature coverage, callback decoding, status mapping and error cases,
using eSewa's documented callback as a fixture. Live tests against the eSewa sandbox check that a
signed form is accepted, a tampered one is rejected (`ES104`), a reused id is rejected, and status
lookups. CI runs on Node.js 22, 24 and 26. A full payment through the sandbox (login, payment,
callback, status) has not been recorded yet, because the sandbox login was unavailable when tested.

Sandbox: product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q`; customer login eSewa ID `9806800001`,
password `Nepal@123`, token `123456`.

## Changelog

- **0.2.4**: Amounts with stray commas such as `"1,2,3"` are rejected instead of read as 123.
  Documents what `retryable` means.
- **0.2.3**: Status replies must carry a whole-paisa amount. Errors have `retryable`, and a reply that
  times out or breaks after its headers gives `TIMEOUT` or `NETWORK_ERROR`.
- **0.2.2**: First release built and staged by GitHub Actions, with npm provenance.
- **0.2.1**: Documentation only.
- **0.2.0**: `paymentAttemptId()` for retries. `https` callback URLs in production (breaking for `http`).
  Product code and transaction id matching, 4 KB callback and 1 MB reply limits, browser worker detection.
- **0.1.1**: Security fix: callbacks must sign status, amount, transaction id and product code.
- **0.1.0**: First release.

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)
