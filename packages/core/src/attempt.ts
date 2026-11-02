import { PaymentError } from './errors';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SUFFIX_LENGTH = 8;

export interface PaymentAttemptIdOptions {
  /** Longest id the gateway accepts (connectIPS: 20). The order id is shortened to fit; the random part is kept. */
  maxLength?: number;
}

/** Unique id for one payment attempt: `${orderId}-` plus 8 random characters (gateways reject reused ids). */
export function paymentAttemptId(orderId: string, options: PaymentAttemptIdOptions = {}): string {
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new PaymentError('INVALID_INPUT', '"orderId" is required');
  }
  const { maxLength } = options;
  if (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < SUFFIX_LENGTH + 2)) {
    throw new PaymentError('INVALID_INPUT', `"maxLength" must be an integer of at least ${SUFFIX_LENGTH + 2}`);
  }
  let suffix = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH))) suffix += ALPHABET.charAt(byte % ALPHABET.length);
  const prefix = maxLength === undefined ? orderId : orderId.slice(0, maxLength - SUFFIX_LENGTH - 1);
  return `${prefix}-${suffix}`;
}
