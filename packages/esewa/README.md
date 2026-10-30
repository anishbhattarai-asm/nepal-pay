# @nepalpay/esewa

[![npm](https://img.shields.io/npm/v/@nepalpay/esewa)](https://www.npmjs.com/package/@nepalpay/esewa)
[![CI](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/anishbhattarai-asm/nepal-pay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)

Accept **eSewa** (ePay v2) payments from Node.js. This package signs the payment form, checks the
signed callback, and confirms every payment with eSewa's status API before you ship anything.
Zero dependencies; TypeScript types included.

> Unofficial. Not affiliated with eSewa. Part of [nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay);
> for Khalti use [`@nepalpay/khalti`](https://www.npmjs.com/package/@nepalpay/khalti).

## Install

```sh
npm i @nepalpay/esewa
```

Requires **Node.js 22 or newer** (use a patched release). Ships ESM, CommonJS and types. Uses only
the standard `fetch` and Web Crypto APIs.

## How a payment works

1. Your server calls `initiate()` and gets a **signed form**. The customer's browser POSTs it to eSewa.
2. The customer pays on eSewa, which redirects them to your `returnUrl?data=...`.
3. `parseCallback()` checks the signature on that redirect. This is only what the redirect **claims**.
4. `verify()` asks eSewa's status API. Fulfil the order only when it returns `COMPLETED`.

## Quick start (Express)

`db` stands for your own database code.

```ts
import express from 'express';
import escapeHtml from 'escape-html'; // npm i escape-html
import { createEsewa } from '@nepalpay/esewa';

const esewa = createEsewa({
  environment: 'sandbox', // 'production' for real money; there is no default
  productCode: process.env.ESEWA_PRODUCT_CODE!, // EPAYTEST in sandbox
  secretKey: process.env.ESEWA_SECRET_KEY!, // keep it on the server
});

const app = express();

// 1. Start the payment: eSewa needs a signed form POSTed from the customer's browser.
app.post('/pay/esewa', async (req, res) => {
  const order = await db.orders.create({ amount: 1500 }); // amount in rupees, from your own data
  const form = await esewa.initiate({
    amount: order.amount,
    orderId: order.id, // letters, digits, "-" and "_"
    returnUrl: 'https://shop.example/esewa/callback',
    failureUrl: `https://shop.example/esewa/failure/${order.id}`,
  });
  if (form.type !== 'form') throw new Error('unexpected');
  const inputs = Object.entries(form.fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  res.send(`<form id="pay" method="post" action="${escapeHtml(form.action)}">${inputs}</form>
            <script>document.getElementById('pay').submit()</script>`);
});

// 2. eSewa sends the customer back with ?data=<base64>.
app.get('/esewa/callback', async (req, res) => {
  const claim = await esewa.parseCallback({ data: String(req.query.data) }); // checks the signature
  const order = await db.orders.find(claim.orderId!);

  // 3. Ask eSewa, using the amount from YOUR records.
  const result = await esewa.verify({ orderId: order.id, amount: order.amount });
  if (result.status === 'COMPLETED') {
    await db.orders.markPaid(order.id, result.transactionId);
    return res.send('Thank you, payment received.');
  }
  res.send(`Payment not completed (${result.status}).`);
});

// eSewa sends the customer to failureUrl when they cancel; check the real status there too.
app.get('/esewa/failure/:orderId', async (req, res) => {
  const order = await db.orders.find(req.params.orderId);
  const result = await esewa.verify({ orderId: order.id, amount: order.amount });
  res.send(`Payment not completed (${result.status}).`);
});
```

A complete working app is in the repo's
[`examples/express-demo`](https://github.com/anishbhattarai-asm/nepal-pay/tree/main/examples/express-demo).

## Rules that keep your money safe

1. **Fulfil an order only when `verify()` returns `COMPLETED`.** `parseCallback()` proves the redirect
   was not altered, not that money moved.
2. **Pass the amount from your database to `verify()`.** eSewa reports a wrong amount as `NOT_FOUND`,
   so a tampered amount shows up as `FAILED`.
3. **Keep the secret key on the server.** `createEsewa()` refuses to start in a browser.
4. **Set `environment` explicitly.** There is no default.
5. **Make fulfilment idempotent.** Customers refresh the callback page.

## API

### `createEsewa(options)`

| Option | Meaning |
|-|-|
| `environment` | `'sandbox'` or `'production'`. Required. |
| `productCode` | Your eSewa merchant code (`EPAYTEST` in sandbox). |
| `secretKey` | Your eSewa HMAC secret. |
| `fetch` | Custom fetch for proxies, logging or tests. Defaults to the global `fetch`. |
| `timeoutMs` | Request timeout. Default `15000`. |

### Methods

| Method | Input | Returns |
|-|-|-|
| `initiate()` | `{ amount, orderId, returnUrl, failureUrl? }` | `{ type: 'form', action, fields, reference }` |
| `parseCallback()` | `{ data }` (the `data` query param) | `{ reference, orderId, transactionId?, claimedStatus, amount, signatureValid: true, raw }` |
| `verify()` | `{ orderId, amount }` | `{ status, amount, orderId, transactionId?, raw }` |

Amounts are **rupees** with up to 2 decimals. `failureUrl` defaults to `returnUrl`.

### Statuses

| `status` | eSewa sends |
|-|-|
| `COMPLETED` | COMPLETE |
| `PENDING` | PENDING, AMBIGUOUS |
| `REFUNDED` | FULL_REFUND, PARTIAL_REFUND |
| `CANCELED` | CANCELED |
| `FAILED` | NOT_FOUND, anything else |

### Errors

Every failure is a `PaymentError`; check `err.code` with `isPaymentError(err)`:

| Code | When |
|-|-|
| `INVALID_CONFIG` | Missing or unknown environment, empty product code or secret. |
| `INVALID_INPUT` | Bad amount, unsafe order id, relative URL, unreadable callback. |
| `SIGNATURE_MISMATCH` | The callback was not signed with your key, or its signature leaves status, amount, order or product unsigned. Do not trust it. |
| `AMOUNT_MISMATCH` | eSewa reports a completed payment for a different amount. |
| `GATEWAY_ERROR` | eSewa returned an HTTP error or a response we do not understand. |
| `NETWORK_ERROR`, `TIMEOUT` | The request did not complete. |
| `BROWSER_ENVIRONMENT` | `createEsewa()` was called in a browser. |

## Testing in the sandbox

* Merchant: product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q` (eSewa's public test values).
* Customer login on the eSewa page: eSewa ID `9806800001`, password `Nepal@123`, token `123456`.

## eSewa behaviour this package handles

Checked against the live sandbox and covered by tests:

* eSewa signs `total_amount=1000.0` but sends `1000.0` as a JSON number. A plain `JSON.parse` turns it
  into `1000` and every round-amount payment fails its signature check; the decoder keeps the exact text.
* A callback lists its own signed fields, and the form your site sends is signed with the same key.
  Callbacks whose signature does not cover `status`, `total_amount`, `transaction_uuid` and
  `product_code` are rejected, so the visible form signature cannot be replayed as a "COMPLETE" callback.
* A wrong amount in the status check comes back as `NOT_FOUND`, and an order that was started but not
  paid reports `PENDING`.
* A bad form signature is answered with HTTP 400 `ES104 Invalid payload signature.`

## Changelog

* **0.1.2**: Documentation only.
* **0.1.1**: Security fix. `parseCallback()` now rejects callbacks whose signature does not cover
  status, amount, order and product. Upgrade from 0.1.0.
* **0.1.0**: First release.

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE) © Anish Bhattarai
