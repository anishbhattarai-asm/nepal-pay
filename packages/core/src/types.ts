import type { PaymentStatus } from './status';

export type FetchLike = typeof fetch;
export type Environment = 'sandbox' | 'production';

/** Options every gateway config accepts. */
export interface BaseConfig {
  /** Required on purpose: no silent default between test and real money. */
  environment: Environment;
  /** Custom fetch (tests, proxies, logging). Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

export interface Customer {
  name?: string;
  email?: string;
  phone?: string;
}

export interface InitiateInput {
  /** Amount in RUPEES (max 2 decimals). */
  amount: number;
  /** Payment attempt id, unique per attempt (eSewa transaction_uuid, Khalti purchase_order_id). */
  orderId: string;
  /** Where the gateway sends the user after paying. */
  returnUrl: string;
  /** eSewa needs a separate failure URL; defaults to returnUrl. */
  failureUrl?: string;
  productName?: string;
  customer?: Customer;
}

export type InitiateResult =
  | { type: 'redirect'; url: string; reference: string; raw: unknown }
  | { type: 'form'; action: string; fields: Record<string, string>; reference: string };

export interface VerifyResult {
  status: PaymentStatus;
  /** Amount in RUPEES as reported by the gateway. */
  amount: number;
  orderId?: string;
  transactionId?: string;
  raw: unknown;
}

/** What the redirect CLAIMS. Never fulfil an order from this; call verify(). */
export interface CallbackResult {
  reference: string;
  orderId?: string;
  /** Gateway transaction id, when the redirect carries one. */
  transactionId?: string;
  claimedStatus: PaymentStatus;
  amount?: number;
  /** true/false if the gateway signs callbacks, null if it does not. */
  signatureValid: boolean | null;
  raw: unknown;
}

export interface PaymentGateway<TVerifyInput, TCallbackInput> {
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(input: TVerifyInput): Promise<VerifyResult>;
  parseCallback(input: TCallbackInput): Promise<CallbackResult>;
}
