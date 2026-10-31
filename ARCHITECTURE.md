# Architecture

## Packages
- core: shared types, PaymentError (with codes), status enum, HTTP helper, money + guard helpers.
- esewa / khalti: one package per gateway, versioned independently with npm version.
  Each depends only on core. No other runtime dependencies.

## Every gateway client exposes the same shape
- initiate(input)      -> { type: 'redirect', url } | { type: 'form', action, fields }
- verify(input)        -> { status, amount, orderId, transactionId, raw }  (calls the gateway's status API)
- parseCallback(input) -> what the redirect CLAIMS happened. Untrusted. Always call verify() after.

## Rules
1. Amounts are always rupees in the public API. Paisa conversion is internal.
2. environment ('sandbox' | 'production') is required. No silent default.
3. verify() must check the amount against what the merchant expects -> AMOUNT_MISMATCH.
4. Secrets never run in a browser page or worker -> BROWSER_ENVIRONMENT error. This catches mistakes;
   it is not a security boundary.
5. Errors are checked by err.code, not instanceof (safe across package copies).
6. fetch is injectable for tests, proxies and logging.
7. Web Crypto + native fetch only, so it runs on Node 22+ and edge runtimes.
8. One order, many payment attempts: initiate() takes the attempt id (paymentAttemptId(order.id)),
   never a reused one. Callbacks are matched by attempt, and an order is paid by verify(), once.
9. Production means https for every callback and website URL.
10. Trust nothing about size or identity from outside: callback data is capped at 4 KB, gateway
    replies at 1 MB, and replies must name the same transaction, pidx and product code we asked about,
    with a whole-paisa amount.
11. Every transport failure is a PaymentError, including a reply body that stalls or breaks after the
    headers. retryable is true for NETWORK_ERROR, TIMEOUT and HTTP 429 or 5xx, so callers can tell an
    outage from a bug. A failed verify() never means a failed payment.

## Status mapping
COMPLETED | PENDING | FAILED | REFUNDED | CANCELED, with the original response kept in raw.

## Gateway quirks handled (verified 2026-10-30)
- eSewa signs the raw text of each callback value ("1000.0") but sends numbers as JSON numbers,
  so the callback decoder keeps raw text instead of using plain JSON.parse.
- eSewa's status API echoes the queried amount and answers NOT_FOUND when it is wrong.
- Khalti's lookup answers Expired and User canceled with HTTP 400 and a normal body; verify() maps them.
- Khalti status casing varies, so it is matched case-insensitively.
- An eSewa callback names its own signed fields, so parseCallback() requires the signature to cover
  status, total_amount, transaction_uuid and product_code; otherwise the visible form signature could
  be replayed as a "COMPLETE" callback.
- Khalti redirects are unsigned and lookup returns no order id: bind a payment to an order by the pidx
  stored at initiate, never by purchase_order_id from the URL.
- eSewa refuses a reused transaction_uuid ("Duplicate transaction UUID."), even after an abandoned
  attempt, and the abandoned attempt stays PENDING (verified 2026-10-31). Hence paymentAttemptId().

## Tests
- Unit tests (npm test, CI) inject fetch and never touch the network. The demo's own tests
  (examples/express-demo/demo.test.mjs) use fake gateway clients to cover retries, double payment,
  simultaneous checkout requests, attempt limits and outages.
- tests/live and the demo smoke test (npm run test:live) hit the real sandboxes.
