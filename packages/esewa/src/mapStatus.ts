import { PaymentStatus } from '@nepalpay/core';

/** eSewa status-API values -> common status. */
export function mapEsewaStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETE':
      return PaymentStatus.COMPLETED;
    case 'PENDING':
    case 'AMBIGUOUS':
      return PaymentStatus.PENDING;
    case 'FULL_REFUND':
    case 'PARTIAL_REFUND':
      return PaymentStatus.REFUNDED;
    case 'CANCELED':
    case 'CANCELLED':
      return PaymentStatus.CANCELED;
    default: // NOT_FOUND and anything unknown
      return PaymentStatus.FAILED;
  }
}
