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
  /** Defaults to true for NETWORK_ERROR and TIMEOUT, false otherwise. */
  retryable?: boolean;
}

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly gateway?: string;
  readonly details?: unknown;
  /**
   * True for transient failures (network, timeout, gateway HTTP 429 and 5xx) that may clear later.
   * It does not say whether the request reached the gateway: verify() is safe to repeat, but a failed
   * Khalti initiate() may still have created a payment.
   */
  readonly retryable: boolean;

  constructor(code: PaymentErrorCode, message: string, opts: PaymentErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = 'PaymentError';
    this.code = code;
    this.gateway = opts.gateway;
    this.details = opts.details;
    this.retryable = opts.retryable ?? (code === 'NETWORK_ERROR' || code === 'TIMEOUT');
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
