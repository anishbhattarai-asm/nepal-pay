import { PaymentStatus } from '@nepalpay/core';

/** Khalti lookup/callback status values -> common status. Case-insensitive: Khalti's own docs mix "Partially refunded" and "Partially Refunded". */
export function mapKhaltiStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'completed':
      return PaymentStatus.COMPLETED;
    case 'pending':
    case 'initiated':
      return PaymentStatus.PENDING;
    case 'refunded':
    case 'partially refunded':
      return PaymentStatus.REFUNDED;
    case 'user canceled':
    case 'user cancelled':
      return PaymentStatus.CANCELED;
    default: // Expired, Failed, unknown
      return PaymentStatus.FAILED;
  }
}
