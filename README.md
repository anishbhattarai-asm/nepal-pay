# nepal-pay

Unofficial, zero-dependency TypeScript SDKs for Nepali payment gateways.
Not affiliated with eSewa or Khalti.

| Package | Gateway |
|-|-|
| `@nepalpay/esewa` | eSewa ePay v2 |
| `@nepalpay/khalti` | Khalti KPG-2 |
| `@nepalpay/core` | Shared types, errors, HTTP (installed automatically) |

See ARCHITECTURE.md for design decisions and each package's README for usage.

## Development

```sh
npm ci
npm run check       # build + typecheck + unit tests (what CI runs)
npm run test:live   # hits the real eSewa and Khalti sandboxes
npm run demo        # Express demo on http://localhost:3000
```

`test:live` and the demo use eSewa's public UAT credentials. Khalti has no shared test key:
set `KHALTI_SECRET_KEY` (from test-admin.khalti.com) to include Khalti's full flow.

TypeScript is pinned to 5.9: tsup's declaration build does not work with TypeScript 7.

## Releasing

```sh
npm version patch -w @nepalpay/esewa   # bump only the packages that changed
npm run release                        # check, then publish every package whose version is new
```

When core gets a new minor version, update the `@nepalpay/core` range in esewa and khalti too.
