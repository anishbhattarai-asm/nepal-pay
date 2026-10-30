# @nepalpay/khalti

[![npm](https://img.shields.io/npm/v/@nepalpay/khalti)](https://www.npmjs.com/package/@nepalpay/khalti)
[![CI](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)

Accept **Khalti** (ePayment, KPG-2) payments from Node.js. This package starts the payment, reads the
return redirect, and confirms every payment with Khalti's lookup API before you ship anything.
Zero dependencies; TypeScript types included.

> Unofficial. Not affiliated with Khalti. Part of [nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay);
> for eSewa use [`@nepalpay/esewa`](https://www.npmjs.com/package/@nepalpay/esewa).

## Install

```sh
npm i @nepalpay/khalti
```

Requires **Node.js 22 or newer** (use a patched release). Ships ESM, CommonJS and types. Uses only
the standard `fetch` API.

## How a payment works

1. Your server calls `initiate()` and gets a **payment URL** plus a `pidx`. Store the pidx on the order
   and redirect the customer.
2. The customer pays on Khalti, which redirects them to your `returnUrl?pidx=...&status=...`.
3. `parseCallback()` reads that redirect. Khalti does not sign it, so it is only a **claim**.
4. `verify()` asks Khalti's lookup API. Fulfil the order only when it returns `COMPLETED`.

## Quick start (Express)

`db` stands for your own database code.

```ts
import express from 'express';
import { createKhalti, paymentAttemptId } from '@nepalpay/khalti';

const khalti = createKhalti({
  environment: 'sandbox', // 'production' for real money; there is no default
  secretKey: process.env.KHALTI_SECRET_KEY!, // from test-admin.khalti.com in sandbox
  websiteUrl: 'https://shop.example', // https is required in production
});

const app = express();

// 1. Start a payment attempt: Khalti returns a URL to send the customer to.
app.post('/orders/:id/pay/khalti', async (req, res) => {
  const order = await db.orders.find(req.params.id); // rupees; Khalti's minimum is Rs 10
  const start = await khalti.initiate({
    amount: order.amount, // converted to paisa for you
    orderId: paymentAttemptId(order.id), // a new id for every attempt, see "Paying again"
    returnUrl: 'https://shop.example/khalti/callback',
    productName: 'Momo platter',
    customer: { name: 'Sita', phone: '9800000001' }, // optional
  });
  if (start.type !== 'redirect') throw new Error('unexpected');
  await db.attempts.create({ id: start.reference, orderId: order.id }); // remember the pidx
  res.redirect(303, start.url);
});

// 2. Khalti sends the customer back with ?pidx=...&status=... (not signed).
app.get('/khalti/callback', async (req, res) => {
  const claim = await khalti.parseCallback(req.query);
  const attempt = await db.attempts.find(claim.reference); // by the pidx you stored, never by URL order id
  const order = await db.orders.find(attempt.orderId);

  // 3. Ask Khalti, using the amount from YOUR records.
  const result = await khalti.verify({ pidx: claim.reference, expectedAmount: order.amount });
  if (result.status === 'COMPLETED') {
    await db.orders.markPaid(order.id, result.transactionId);
    return res.send('Thank you, payment received.');
  }
  res.send(`Payment not completed (${result.status}).`);
});
```

A complete working app is in the repo's
[`examples/express-demo`](https://github.com/anishbhattarai-asm/nepal-pay/tree/main/examples/express-demo).

## Paying again

Every `initiate()` creates a new pidx, and an open Khalti payment page can still be paid until it
expires. So a "Pay again" button needs:

1. **A new id for every attempt:** `paymentAttemptId(order.id)` as `orderId` (Khalti's
   `purchase_order_id`), and the returned pidx stored against the order.
2. **A check of earlier attempts first:** `verify()` each earlier pidx; if one is `COMPLETED`, the order is
   already paid and must not be charged again.
3. **A refund if two attempts both complete** (an old page and a new one were both paid).

## Rules that keep your money safe

1. **Fulfil an order only when `verify()` returns `COMPLETED`.** Anyone can type the redirect URL.
2. **Find the order by the pidx you stored at `initiate()`.** Khalti's redirect is unsigned and its
   lookup API does not return your order id, so `purchase_order_id` from the URL proves nothing. Looking
   orders up by it would let one paid pidx be replayed against another order with the same amount.
3. **Pass the amount from your database to `verify()`.** A completed payment for a different amount
   throws `AMOUNT_MISMATCH`.
4. **Use a new `paymentAttemptId()` for every attempt** and check earlier pidx values before charging again.
5. **Keep the secret key on the server.** `createKhalti()` refuses to start in a browser page or worker.
   That check catches mistakes; it cannot protect a key that already reached a browser.
6. **Set `environment` explicitly** (in production, `websiteUrl` and `returnUrl` must be `https`) and
   **make fulfilment idempotent**.

## API

### `createKhalti(options)`

| Option | Meaning |
|-|-|
| `environment` | `'sandbox'` or `'production'`. Required. |
| `secretKey` | Your Khalti secret key. |
| `websiteUrl` | Your site's URL, sent to Khalti. |
| `fetch` | Custom fetch for proxies, logging or tests. Defaults to the global `fetch`. |
| `timeoutMs` | Request timeout. Default `15000`. |

### Methods

| Method | Input | Returns |
|-|-|-|
| `initiate()` | `{ amount, orderId, returnUrl, productName?, customer? }` | `{ type: 'redirect', url, reference, raw }` (`reference` is the pidx) |
| `parseCallback()` | `req.query`, `URLSearchParams`, a query string or the full URL | `{ reference, orderId?, transactionId?, claimedStatus, amount?, signatureValid: null, raw }` |
| `verify()` | `{ pidx, expectedAmount }` | `{ status, amount, transactionId?, raw }` |

`orderId` is the id of **this attempt** (Khalti's `purchase_order_id`): use `paymentAttemptId(order.id)`.
Amounts are **rupees** with up to 2 decimals and at least Rs 10; conversion to paisa happens inside.
`customer` is `{ name?, email?, phone? }`.

### Statuses

| `status` | Khalti sends |
|-|-|
| `COMPLETED` | Completed |
| `PENDING` | Pending, Initiated |
| `REFUNDED` | Refunded, Partially Refunded |
| `CANCELED` | User canceled |
| `FAILED` | Expired, anything else |

### Errors

Every failure is a `PaymentError`; check `err.code` with `isPaymentError(err)`:

| Code | When |
|-|-|
| `INVALID_CONFIG` | Missing or unknown environment, empty secret, bad `websiteUrl` (must be `https` in production). |
| `INVALID_INPUT` | Bad or too large amount, under Rs 10, empty order id or pidx, relative URL, `http` returnUrl in production, callback without pidx. |
| `AMOUNT_MISMATCH` | Khalti reports a completed payment for a different amount. |
| `GATEWAY_ERROR` | Khalti returned an HTTP error (its reason is in the message), a lookup for another or missing pidx, an amount that is not whole paisa, a `payment_url` that is not `https`, a reply over 1 MB, or an unexpected response. |
| `NETWORK_ERROR`, `TIMEOUT` | The request did not complete. |
| `BROWSER_ENVIRONMENT` | `createKhalti()` was called in a browser page or worker. |

## Testing in the sandbox

* Merchant key: sign up at [test-admin.khalti.com](https://test-admin.khalti.com/#/join/merchant) and use
  its `live_secret_key` with `environment: 'sandbox'`.
* Customer login on the Khalti page: Khalti ID `9800000000` to `9800000005`, MPIN `1111`, OTP `987654`.

## Khalti behaviour this package handles

Checked against docs.khalti.com and the live sandbox, and covered by tests:

* The lookup API answers `Expired` and `User canceled` with HTTP 400 and a normal body. `verify()` maps
  them to `FAILED` and `CANCELED` instead of throwing.
* Status spelling is not consistent ("Partially refunded" and "Partially Refunded"), so statuses are
  matched case-insensitively.
* A wrong key is answered with HTTP 401 `Invalid token.`, which becomes a `GATEWAY_ERROR` with that message.

## Changelog

* **0.2.0**: Hardening. New `paymentAttemptId()` for paying again. `websiteUrl` and `returnUrl` must be
  `https` in production (**breaking** if you used `http` there). `payment_url` must be `https`. Lookups
  must return the same pidx and a whole-paisa amount. Gateway replies over 1 MB are refused. Browser
  workers are refused like browser pages. Amounts must fit in a safe integer of paisa.
* **0.1.2**: Documentation only.
* **0.1.1**: Documentation: bind orders by the stored pidx.
* **0.1.0**: First release.

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE) © Anish Bhattarai
