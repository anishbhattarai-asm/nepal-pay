import { PaymentError } from './errors';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Unique id for one payment attempt: `${orderId}-` plus 8 random characters (eSewa rejects reused ids). */
export function paymentAttemptId(orderId: string): string {
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new PaymentError('INVALID_INPUT', '"orderId" is required');
  }
  let suffix = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(8))) suffix += ALPHABET.charAt(byte % ALPHABET.length);
  return `${orderId}-${suffix}`;
}
