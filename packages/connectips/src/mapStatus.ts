import { PaymentStatus } from '@nepalpay/core';

/** gettxndetail creditStatus values that mean the merchant was credited. */
export const SETTLED_CREDIT_STATUSES = new Set(['000', '999', 'DEFER']);

/**
 * validatetxn and gettxndetail answer SUCCESS, FAILED, or ERROR with statusDesc "TRANSACTION NOT FOUND"
 * (the customer never paid) or "TRANSACTION INCOMPLETE" (the customer left before entering the OTP).
 */
export function mapConnectipsStatus(status: unknown, statusDesc?: unknown): PaymentStatus {
  const value = typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (value === 'SUCCESS') return PaymentStatus.COMPLETED;
  if (value === 'ERROR' && typeof statusDesc === 'string' && /INCOMPLETE/i.test(statusDesc)) {
    return PaymentStatus.PENDING;
  }
  return PaymentStatus.FAILED;
}
