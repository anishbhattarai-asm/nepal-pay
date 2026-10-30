import { PaymentStatus } from '@nepalpay/core';

/** Maps Khalti statuses to PaymentStatus, case-insensitively (Khalti mixes "Partially refunded" casing). */
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
