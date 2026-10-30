import { assertHttpUrl, assertNonEmpty, PaymentError, type BaseConfig, type FetchLike } from '@nepalpay/core';

export interface KhaltiConfig extends BaseConfig {
  /** Live or test secret key from the Khalti merchant dashboard. */
  secretKey: string;
  /** Your site's URL (Khalti requires website_url on initiate). */
  websiteUrl: string;
}

// Checked against docs.khalti.com and the live sandbox on 2026-10-30.
const BASE_URLS = {
  sandbox: 'https://dev.khalti.com/api/v2/',
  production: 'https://khalti.com/api/v2/',
} as const;

export interface ResolvedKhaltiConfig {
  production: boolean;
  secretKey: string;
  websiteUrl: string;
  fetch?: FetchLike;
  timeoutMs: number;
  urls: { initiate: string; lookup: string };
}

export function resolveConfig(config: KhaltiConfig): ResolvedKhaltiConfig {
  if (!config || (config.environment !== 'sandbox' && config.environment !== 'production')) {
    throw new PaymentError('INVALID_CONFIG', 'khalti: environment must be "sandbox" or "production"', {
      gateway: 'khalti',
    });
  }
  assertNonEmpty(config.secretKey, 'secretKey', 'khalti');
  assertNonEmpty(config.websiteUrl, 'websiteUrl', 'khalti');
  const production = config.environment === 'production';
  assertHttpUrl(config.websiteUrl, 'websiteUrl', 'khalti', 'INVALID_CONFIG', production);

  const base = BASE_URLS[config.environment];
  return {
    production,
    secretKey: config.secretKey,
    websiteUrl: config.websiteUrl,
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? 15_000,
    urls: { initiate: `${base}epayment/initiate/`, lookup: `${base}epayment/lookup/` },
  };
}
