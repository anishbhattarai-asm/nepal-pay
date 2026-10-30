import { assertNonEmpty, PaymentError, type BaseConfig, type FetchLike } from '@anishbhattarai/core';

export interface EsewaConfig extends BaseConfig {
  /** Merchant product code (EPAYTEST in sandbox). */
  productCode: string;
  /** HMAC secret key from eSewa. */
  secretKey: string;
}

// Checked against the live sandbox on 2026-10-30: both sandbox hosts answer the status API.
const URLS = {
  sandbox: {
    form: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    status: 'https://rc.esewa.com.np/api/epay/transaction/status/',
  },
  production: {
    form: 'https://epay.esewa.com.np/api/epay/main/v2/form',
    status: 'https://epay.esewa.com.np/api/epay/transaction/status/',
  },
} as const;

export interface ResolvedEsewaConfig {
  productCode: string;
  secretKey: string;
  fetch?: FetchLike;
  timeoutMs: number;
  urls: { form: string; status: string };
}

export function resolveConfig(config: EsewaConfig): ResolvedEsewaConfig {
  if (!config || (config.environment !== 'sandbox' && config.environment !== 'production')) {
    throw new PaymentError('INVALID_CONFIG', 'esewa: environment must be "sandbox" or "production"', {
      gateway: 'esewa',
    });
  }
  assertNonEmpty(config.productCode, 'productCode', 'esewa');
  assertNonEmpty(config.secretKey, 'secretKey', 'esewa');

  return {
    productCode: config.productCode,
    secretKey: config.secretKey,
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? 15_000,
    urls: URLS[config.environment],
  };
}
