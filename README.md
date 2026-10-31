# nepal-pay

[![CI](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml)
[![@nepalpay/esewa](https://img.shields.io/npm/v/@nepalpay/esewa?label=%40nepalpay%2Fesewa)](https://www.npmjs.com/package/@nepalpay/esewa)
[![@nepalpay/khalti](https://img.shields.io/npm/v/@nepalpay/khalti?label=%40nepalpay%2Fkhalti)](https://www.npmjs.com/package/@nepalpay/khalti)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

TypeScript SDKs for the eSewa and Khalti payment gateways. Both share one API (`initiate`,
`parseCallback`, `verify`), have no runtime dependencies, and confirm every payment with the gateway
before reporting it as completed.

Unofficial; not affiliated with eSewa or Khalti.

| Package | Gateway |
|-|-|
| [`@nepalpay/esewa`](https://www.npmjs.com/package/@nepalpay/esewa) | eSewa ePay v2 |
| [`@nepalpay/khalti`](https://www.npmjs.com/package/@nepalpay/khalti) | Khalti ePayment (KPG-2) |
| [`@nepalpay/core`](https://www.npmjs.com/package/@nepalpay/core) | Shared types and errors, installed with either gateway |

Node.js 22 or newer. ESM, CommonJS and TypeScript types. Uses only `fetch` and Web Crypto.

## Payment flow

```mermaid
sequenceDiagram
    participant C as Customer
    participant S as Server
    participant G as eSewa / Khalti
    S->>C: initiate(): signed form (eSewa) or payment URL (Khalti)
    C->>G: Pays
    G->>C: Redirect to returnUrl
    C->>S: Callback
    S->>S: parseCallback(): what the redirect claims
    S->>G: verify(): payment status from the gateway
    G->>S: COMPLETED, PENDING, FAILED, ...
```

A payment counts as completed only when `verify()` returns `COMPLETED`.

## Usage

`db` stands for the application's own storage, with one record per order and one per payment attempt:

| Record | Fields |
|-|-|
| Order | `id`, `amount` (rupees), `status` (`UNPAID`, `PAID`, `PAID_TWICE`) |
| Attempt | `id` (eSewa `transaction_uuid` or Khalti pidx), `orderId`, `gateway`, `status`, `transactionId` |

### eSewa

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

### Khalti

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

A complete Express app with both gateways, retries included, is in
[`examples/express-demo`](examples/express-demo).

## Retries

An order can need several payment attempts (abandoned page, insufficient balance, back button).

- `paymentAttemptId(order.id)` returns a new id per attempt. eSewa rejects any reused
  `transaction_uuid` (`Duplicate transaction UUID.`); Khalti issues a new pidx per attempt.
- An abandoned eSewa attempt stays `PENDING`, and a Khalti payment page stays payable for 30 minutes,
  so an earlier attempt can still complete after a new one starts.
- The demo therefore re-verifies earlier attempts before starting a new one, matches each callback to
  its attempt, and marks an order `PAID_TWICE` when two attempts complete, for a refund.
- Two requests for one order can arrive together (double click, two tabs). The demo runs one payment
  start per order at a time and caps attempts per order (`maxAttempts`, default 10). With a database,
  the same guard is a row lock (`SELECT ... FOR UPDATE`) or a conditional update on the order.

## Gateway outages

Neither gateway publishes a health endpoint, so an outage shows up as an error from `verify()` or
Khalti's `initiate()`. `error.retryable` tells whether repeating the call can help:

| Error | `retryable` | Cause |
|-|-|-|
| `NETWORK_ERROR` | true | Gateway unreachable, or the connection broke during the reply |
| `TIMEOUT` | true | No complete reply within `timeoutMs` (default 15000) |
| `GATEWAY_ERROR`, HTTP 429 or 5xx | true | Rate limit or maintenance; `details.status` holds the HTTP status |
| Any other error | false | Input, configuration, signature or amount problem; a repeat gives the same result |

A failed `verify()` says nothing about the payment itself: the customer may already have paid. The
attempt keeps its last known status and is verified again later, on the next callback, a status
check or a scheduled job; `verify()` only reads, so repeating it is safe. A failed `initiate()` leaves
no attempt behind. The `fetch` option accepts a wrapper for retries, circuit breaking or logging. The
demo answers 503 for retryable errors and leaves the order unchanged.

## Security model

Enforced by the library:

| Area | Behaviour |
|-|-|
| Payment status | `verify()` asks the gateway and returns `COMPLETED` only from the gateway's reply |
| Amount | A completed payment for a different amount throws `AMOUNT_MISMATCH` |
| eSewa callbacks | HMAC-SHA256 checked with a constant-time compare; the signature must cover status, amount, transaction id and product code, and the product code must match the client |
| Gateway replies | Must name the same transaction (eSewa) or pidx (Khalti) and product code, with a whole-paisa amount; replies over 1 MB are refused |
| Callback input | eSewa data over 4 KB is refused; Khalti amounts must be whole paisa |
| URLs | Callback and website URLs must be `https` in production; Khalti `payment_url` must be `https` |
| Configuration | `environment` is required; there is no default |
| Runtime | Clients refuse to start in a browser page or worker (misuse detection, not a boundary) |

Vulnerability reports: see [SECURITY.md](SECURITY.md).

## Production checklist

| Area | Library | Application |
|-|-|-|
| Secret keys | Refuses to run in a browser | Keeps keys in environment variables or a secret store, separate for sandbox and production |
| HTTPS | Requires `https` callback and website URLs in production | Serves the callback routes over HTTPS |
| Payment status | `verify()` asks the gateway and checks the amount | Marks an order paid only from `verify()`, never from the redirect |
| Attempts | `paymentAttemptId()` gives each attempt its own id | Stores each attempt before redirecting and matches callbacks to it |
| Concurrency | Application only | Starts one attempt per order at a time (row lock or conditional update) |
| Fulfilment | Application only | Fulfils each order once, even when a callback arrives twice |
| Outages | Typed errors with `retryable` | Keeps attempts on errors and verifies them again later |
| Reconciliation | Application only | Re-verifies unfinished attempts on a schedule, catching customers who never return to the site |
| Refunds | Application only | Refunds `PAID_TWICE` orders and returns through the gateway's merchant portal |

## API

| Method | eSewa | Khalti |
|-|-|-|
| `initiate()` | `{ amount, orderId, returnUrl, failureUrl? }` returns `{ type: 'form', action, fields, reference }` | `{ amount, orderId, returnUrl, productName?, customer? }` returns `{ type: 'redirect', url, reference, raw }` |
| `parseCallback()` | `{ data }` | `req.query`, `URLSearchParams`, query string or URL |
| `verify()` | `{ orderId, amount }` | `{ pidx, expectedAmount }` |

Client options: `environment`, gateway keys (`productCode` and `secretKey`, or `secretKey` and
`websiteUrl`), and optional `fetch` and `timeoutMs` (default 15000). Amounts are rupees with up to
2 decimals.

| `status` | eSewa | Khalti |
|-|-|-|
| `COMPLETED` | COMPLETE | Completed |
| `PENDING` | PENDING, AMBIGUOUS | Pending, Initiated |
| `REFUNDED` | FULL_REFUND, PARTIAL_REFUND | Refunded, Partially Refunded |
| `CANCELED` | CANCELED | User canceled |
| `FAILED` | NOT_FOUND, other | Expired, other |

Results include `raw`, the gateway's reply as received (Khalti amounts in paisa). Errors are
`PaymentError` instances with a `code` and `retryable`; `isPaymentError()` works across package copies.

| Code | Meaning |
|-|-|
| `INVALID_CONFIG` | Missing or invalid client options |
| `INVALID_INPUT` | Invalid amount, id, URL or callback |
| `SIGNATURE_MISMATCH` | eSewa callback not signed by this merchant, or signed too narrowly |
| `AMOUNT_MISMATCH` | Completed payment for a different amount |
| `GATEWAY_ERROR` | Gateway error reply, or a reply about another payment |
| `NETWORK_ERROR`, `TIMEOUT` | Request did not complete |
| `BROWSER_ENVIRONMENT` | Client created in a browser |

## Testing

| Suite | Command | Covers |
|-|-|-|
| Unit (275 tests) | `npm run check` | Signing and signature coverage, every status mapping, amount and paisa handling, URL and size limits, error mapping including stalled and broken replies, and in the demo: retries, double payment, simultaneous checkout requests and outages |
| Live sandbox | `npm run test:live` | Signed form accepted by eSewa, tampered signature rejected (`ES104`), reused id rejected, status lookups, Khalti initiate and lookup (with `KHALTI_SECRET_KEY`) |
| CI | GitHub Actions | Build, typecheck and unit tests on Node.js 22, 24 and 26 for every push |

Unit tests use fixtures recorded from the gateways, including eSewa's documented callback and a
completed Khalti sandbox payment. A completed eSewa sandbox payment has not been recorded yet.

## Development

```sh
npm ci
npm run check        # build, typecheck, unit tests
npm run test:live    # real eSewa and Khalti sandboxes
npm run demo         # http://localhost:3000; KHALTI_SECRET_KEY enables Khalti
```

Releases go through the **Release** workflow (Actions tab, Run workflow). It runs the full check and
stages every package whose version is not on npm yet, using npm trusted publishing with provenance.
A staged version goes live after approval with 2FA on npmjs.com (Staged Packages) or with
`npm stage approve`.

Sandbox credentials: eSewa uses the public product code `EPAYTEST` and secret `8gBm/:&EnhH.1/q`;
Khalti keys come from [test-admin.khalti.com](https://test-admin.khalti.com/#/join/merchant).
TypeScript is pinned to 5.9 because tsup's declaration build does not support TypeScript 7.
Design notes: [ARCHITECTURE.md](ARCHITECTURE.md).

## License

[MIT](LICENSE)
