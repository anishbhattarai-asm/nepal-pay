import { PaymentError } from './errors';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A fresh id for one payment attempt on an order: `${orderId}-` plus 8 random characters.
 * eSewa rejects any reused transaction_uuid ("Duplicate transaction UUID."), even after an abandoned
 * attempt, so every "pay again" needs a new id. Store each attempt id against its order.
 */
export function paymentAttemptId(orderId: string): string {
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new PaymentError('INVALID_INPUT', '"orderId" is required');
  }
  let suffix = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(8))) suffix += ALPHABET.charAt(byte % ALPHABET.length);
  return `${orderId}-${suffix}`;
}
