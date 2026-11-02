import { assertNonEmpty, PaymentError, type BaseConfig, type FetchLike } from '@nepalpay/core';

export interface ConnectipsConfig extends BaseConfig {
  /** MERCHANTID issued by NCHL (digits). */
  merchantId: string | number;
  /** APPID issued by NCHL; also the Basic auth user for the validation API. */
  appId: string;
  /** APPNAME registered with NCHL. */
  appName: string;
  /** Password for the validation API, sent by NCHL with the credentials. */
  password: string;
  /**
   * The creditor certificate's private key as an unencrypted PEM ("PRIVATE KEY" or "RSA PRIVATE KEY").
   * Export it once from the .pfx: `openssl pkcs12 -in CREDITOR.pfx -nocerts -nodes -out creditor-key.pem`.
   */
  privateKey: string;
}

// Paths from NCHL's documentation; hosts from existing integrations. The UAT host answers on the
// login page path (checked 2026-11-02). Not yet confirmed by a completed payment.
const URLS = {
  sandbox: {
    form: 'https://uat.connectips.com/connectipswebgw/loginpage',
    validate: 'https://uat.connectips.com/connectipswebws/api/creditor/validatetxn',
    detail: 'https://uat.connectips.com/connectipswebws/api/creditor/gettxndetail',
  },
  production: {
    form: 'https://login.connectips.com/connectipswebgw/loginpage',
    validate: 'https://login.connectips.com/connectipswebws/api/creditor/validatetxn',
    detail: 'https://login.connectips.com/connectipswebws/api/creditor/gettxndetail',
  },
} as const;

export interface ResolvedConnectipsConfig {
  production: boolean;
  merchantId: string;
  appId: string;
  appName: string;
  password: string;
  privateKey: string;
  fetch?: FetchLike;
  timeoutMs: number;
  urls: { form: string; validate: string; detail: string };
}

const invalid = (message: string) => new PaymentError('INVALID_CONFIG', `connectips: ${message}`, { gateway: 'connectips' });

export function resolveConfig(config: ConnectipsConfig): ResolvedConnectipsConfig {
  if (!config || (config.environment !== 'sandbox' && config.environment !== 'production')) {
    throw invalid('environment must be "sandbox" or "production"');
  }
  const merchantId = typeof config.merchantId === 'number' ? String(config.merchantId) : config.merchantId;
  if (typeof merchantId !== 'string' || !/^\d{1,20}$/.test(merchantId)) {
    throw invalid('"merchantId" must be the numeric MERCHANTID from NCHL');
  }
  assertNonEmpty(config.appId, 'appId', 'connectips');
  assertNonEmpty(config.appName, 'appName', 'connectips');
  assertNonEmpty(config.password, 'password', 'connectips');
  assertNonEmpty(config.privateKey, 'privateKey', 'connectips');
  if (config.appId.length > 15) throw invalid('"appId" can have at most 15 characters');
  if (config.appName.length > 30) throw invalid('"appName" can have at most 30 characters');
  if (/[,=]/.test(config.appId + config.appName)) throw invalid('"appId" and "appName" cannot contain "," or "="');

  return {
    production: config.environment === 'production',
    merchantId,
    appId: config.appId,
    appName: config.appName,
    password: config.password,
    privateKey: config.privateKey,
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? 15_000,
    urls: URLS[config.environment],
  };
}
