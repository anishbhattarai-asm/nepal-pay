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
4. Secrets never run in a browser -> BROWSER_ENVIRONMENT error.
5. Errors are checked by err.code, not instanceof (safe across package copies).
6. fetch is injectable for tests, proxies and logging.
7. Web Crypto + native fetch only, so it runs on Node 22+ and edge runtimes.

## Status mapping
COMPLETED | PENDING | FAILED | REFUNDED | CANCELED, with the original response kept in raw.

## Gateway quirks handled (verified 2026-10-30)
- eSewa signs the raw text of each callback value ("1000.0") but sends numbers as JSON numbers,
  so the callback decoder keeps raw text instead of using plain JSON.parse.
- eSewa's status API echoes the queried amount and answers NOT_FOUND when it is wrong.
- Khalti's lookup answers Expired and User canceled with HTTP 400 and a normal body; verify() maps them.
- Khalti status casing varies, so it is matched case-insensitively.

## Tests
- Unit tests (npm test, CI) inject fetch and never touch the network.
- tests/live and the demo smoke test (npm run test:live) hit the real sandboxes.
