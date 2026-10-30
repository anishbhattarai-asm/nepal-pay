# @nepalpay/core

[![npm](https://img.shields.io/npm/v/@nepalpay/core)](https://www.npmjs.com/package/@nepalpay/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE)

Shared types, errors and helpers for [`@nepalpay/esewa`](https://www.npmjs.com/package/@nepalpay/esewa)
and [`@nepalpay/khalti`](https://www.npmjs.com/package/@nepalpay/khalti).

**You normally do not install this directly.** It comes with either gateway package, and the parts
you need (`PaymentError`, `isPaymentError`, `PaymentStatus` and the result types) are re-exported
from both.

> Unofficial. Not affiliated with eSewa or Khalti. Part of
> [nepal-pay](https://github.com/anishbhattarai-asm/nepal-pay).

## What is inside

| Export | Purpose |
|-|-|
| `PaymentError`, `isPaymentError()` | One error type with a `code` for every failure. `isPaymentError()` works even when two copies of the package are installed. |
| `PaymentStatus` | `COMPLETED`, `PENDING`, `FAILED`, `REFUNDED`, `CANCELED`. |
| `paymentAttemptId()` | A fresh id for each payment attempt on an order, for "pay again". eSewa rejects reused ids. |
| `InitiateInput`, `InitiateResult`, `VerifyResult`, `CallbackResult` | The shapes every gateway client uses. |
| `toPaisa()`, `fromPaisa()`, `sameAmount()`, `formatRupees()`, `parseAmount()` | Rupee and paisa conversion without floating-point surprises. |
| `requestJson()` | `fetch` with a timeout, a 1 MB response limit and readable gateway errors. |

## License

[MIT](https://github.com/anishbhattarai-asm/nepal-pay/blob/main/LICENSE) © Anish Bhattarai
