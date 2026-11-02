# Next.js demo

A checkout with eSewa and Khalti in the Next.js App Router, using `@nepalpay/esewa` and
`@nepalpay/khalti`. It runs against the sandboxes and keeps orders in memory, so it is a demo to copy
from, not an app to deploy as is.

```sh
# from the repo root
npm ci
npm run demo:next    # http://localhost:3000
```

Set `KHALTI_SECRET_KEY` (from test-admin.khalti.com) to enable Khalti. Sandbox logins: eSewa ID
`9711111111`, MPIN `1122`; Khalti ID `9800000001`, MPIN `1111` (OTP `987654` if asked).

## Files

| File | Role |
|-|-|
| `lib/checkout.ts` | Orders and payment attempts: one start per order at a time, earlier attempts re-verified, paid only after `verify()` |
| `lib/shop.ts` | Gateway clients from environment variables; one shop per server process |
| `lib/respond.ts` | The auto-posting eSewa form, error pages, outage handling |
| `app/actions.ts` | Server action that creates an order |
| `app/orders/[id]/page.tsx` | Order page with its attempts |
| `app/orders/[id]/pay/[gateway]/route.ts` | Starts a payment: eSewa form or Khalti redirect |
| `app/esewa/callback/route.ts`, `app/esewa/failure/[attemptId]/route.ts`, `app/khalti/callback/route.ts` | Gateway returns; each one calls `verify()` before changing the order |

## Before production

- Replace the in-memory maps in `lib/checkout.ts` with database tables, and the per-order start lock
  with a row lock or a conditional update.
- Set `APP_URL` to the public `https` address; callback URLs are built from it. It is not named
  `BASE_URL` because Vite and Vitest set that variable to `/`.
- Use production credentials and `environment: 'production'` in `lib/shop.ts`.
- Keep the gateway code in route handlers, server actions or server components. The library refuses
  to run in the browser.

## Runtime

Use the default Node.js runtime. The library also works in the Edge runtime (checked on
2026-11-02: eSewa signing and a status lookup), but Next.js 16 deprecates Edge.

## Tests

`npm test -w nextjs-demo` runs the checkout logic with fake gateways and the route handlers with the
real sandbox client and a stubbed eSewa status API. On 2026-11-02 one eSewa and one Khalti sandbox
payment went through the production build end to end.
