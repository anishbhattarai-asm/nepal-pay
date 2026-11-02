# @nepalpay/connectips

connectIPS (NCHL) gateway SDK for Node.js. Signs the payment form with the merchant's certificate key and
confirms every payment with connectIPS's validation API. No runtime dependencies; TypeScript types
included.

**Not released yet.** It is built from NCHL's documentation and unit tested, but no payment has gone
through connectIPS UAT yet. It will be published once one has.

Unofficial; not affiliated with NCHL or connectIPS. Part of
[nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay).

## Usage

`db` stands for the application's own storage.

```ts
import { createConnectips, paymentAttemptId } from '@nepalpay/connectips';

const connectips = createConnectips({
  environment: 'production',
  merchantId,
  appId,
  appName,
  password, // for the validation API
  privateKey, // PEM exported from CREDITOR.pfx, see below
});

// Start a payment attempt; the browser POSTs form.fields to form.action.
const attemptId = paymentAttemptId(order.id, { maxLength: 20 }); // TXNID is at most 20 characters
await db.attempts.create({ id: attemptId, orderId: order.id });
const form = await connectips.initiate({ amount: order.amount, orderId: attemptId, remarks: `Order ${order.id}` });

// Success or failure redirect (?TXNID=...): find the attempt, then ask connectIPS.
const claim = await connectips.parseCallback(req.query);
const attempt = await db.attempts.find(claim.reference);
const order = await db.orders.find(attempt.orderId);
const result = await connectips.verify({ orderId: attempt.id, amount: order.amount });
if (result.status === 'COMPLETED') await db.orders.markPaid(order.id, attempt.id);
```

The success and failure URLs are registered once with NCHL, not sent with each payment. The redirect
carries only `TXNID`, with no status and no signature, so `parseCallback()` reports `PENDING` and
`verify()` decides.

## Private key

connectIPS signs with the RSA key inside the creditor certificate (`CREDITOR.pfx`). Export it once,
without a passphrase, and keep the file out of the repository:

```sh
openssl pkcs12 -in CREDITOR.pfx -nocerts -nodes -out creditor-key.pem
# OpenSSL 3 with an older certificate may need: openssl pkcs12 -legacy ...
```

`privateKey` takes the file's contents, not its path. Both `PRIVATE KEY` (PKCS#8) and `RSA PRIVATE KEY`
(PKCS#1) exports work.

## Security

| Area | Behaviour |
|-|-|
| Status | `verify()` returns `COMPLETED` only from connectIPS's validation API |
| Amount | A completed payment for a different amount throws `AMOUNT_MISMATCH` |
| Callback | Unsigned, so it is only used to find the attempt |
| Signing | SHA256withRSA (PKCS#1 v1.5) over NCHL's field string, the same bytes as Node's `createSign('RSA-SHA256')` |
| Replies | Must name the same transaction, app and merchant when they name one; a completed reply must carry the expected whole paisa; replies over 1 MB are refused |
| Form fields | `TXNID` and `REFERENCEID` at most 20 characters; remarks and particulars cannot contain `,` or `=`, which would change the signed text |
| Runtime | Refuses to start in a browser page or worker |

## API

| Method | Input | Returns |
|-|-|-|
| `initiate()` | `{ amount, orderId, referenceId?, remarks?, particulars?, date? }` | `{ type: 'form', action, fields, reference }` |
| `parseCallback()` | `req.query`, `URLSearchParams`, query string or URL | `{ reference, orderId, claimedStatus: 'PENDING', signatureValid: null, raw }` |
| `verify()` | `{ orderId, amount }` | `{ status, amount, orderId, raw }` |
| `transactionDetail()` | `{ orderId, amount }` | NCHL's record: status, transaction and batch ids, bank code, charge |

Amounts are rupees with up to 2 decimals; connectIPS receives paisa. `date` defaults to now and is
sent as `DD-MM-YYYY` in Nepal time.

| `status` | connectIPS |
|-|-|
| `COMPLETED` | SUCCESS (`transactionDetail()` also needs creditStatus 000, 999 or DEFER) |
| `PENDING` | ERROR "TRANSACTION INCOMPLETE": the customer left before entering the OTP |
| `FAILED` | FAILED, ERROR "TRANSACTION NOT FOUND", other |

Errors are `PaymentError` with a `code` and `retryable`, as in the other packages. A 401 from the
validation API is `INVALID_CONFIG` (wrong `appId` or `password`), not an outage.

## Testing

74 unit tests cover the signed text against NCHL's examples, signatures against Node's `createSign`,
both key formats, every status, reply checks and input limits. Live tests against UAT are written
and run once NCHL's test credentials are set (`CONNECTIPS_MERCHANT_ID`, `CONNECTIPS_APP_ID`,
`CONNECTIPS_APP_NAME`, `CONNECTIPS_PASSWORD`, `CONNECTIPS_KEY_FILE`).

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)
