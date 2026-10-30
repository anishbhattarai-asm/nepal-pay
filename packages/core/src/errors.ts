export type PaymentErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'GATEWAY_ERROR'
  | 'SIGNATURE_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'BROWSER_ENVIRONMENT'
  | 'NOT_IMPLEMENTED';

export interface PaymentErrorOptions {
  gateway?: string;
  details?: unknown;
  cause?: unknown;
}

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly gateway?: string;
  readonly details?: unknown;

  constructor(code: PaymentErrorCode, message: string, opts: PaymentErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = 'PaymentError';
    this.code = code;
    this.gateway = opts.gateway;
    this.details = opts.details;
  }
}

/** Works even if two copies of core end up installed. */
export function isPaymentError(err: unknown): err is PaymentError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'PaymentError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}
