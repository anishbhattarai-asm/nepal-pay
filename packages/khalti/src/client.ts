import {
  assertAmount,
  assertHttpUrl,
  assertNonEmpty,
  assertServerSide,
  fromPaisa,
  isHttpsUrl,
  isPaymentError,
  isRecord,
  parseAmount,
  PaymentError,
  PaymentStatus,
  requestJson,
  sameAmount,
  toPaisa,
  type Customer,
  type PaymentGateway,
} from '@nepalpay/core';
import { resolveConfig, type KhaltiConfig } from './config';
import { mapKhaltiStatus } from './mapStatus';

const GATEWAY = 'khalti';

/** Khalti rejects payments under Rs 10 (1000 paisa). */
const MIN_PAISA = 1000;

export interface KhaltiVerifyInput {
  pidx: string;
  /** Expected amount in rupees; a completed payment for another amount throws AMOUNT_MISMATCH. */
  expectedAmount: number;
}

/** Query params Khalti appends to return_url: pass req.query, a URLSearchParams, a query string or the full URL. */
export type KhaltiCallbackInput = Record<string, unknown> | URLSearchParams | string;

export type KhaltiClient = PaymentGateway<KhaltiVerifyInput, KhaltiCallbackInput>;

const gatewayError = (message: string, raw: unknown) =>
  new PaymentError('GATEWAY_ERROR', `khalti: ${message}`, { gateway: GATEWAY, details: raw });

/** Khalti amounts are whole paisa; anything else is not a real amount. */
function parsePaisa(value: unknown): number | undefined {
  const paisa = parseAmount(value);
  return paisa !== undefined && Number.isSafeInteger(paisa) && paisa >= 0 ? paisa : undefined;
}

export function createKhalti(config: KhaltiConfig): KhaltiClient {
  assertServerSide(GATEWAY);
  const cfg = resolveConfig(config);
  const post = (url: string, body: unknown) =>
    requestJson({
      gateway: GATEWAY,
      url,
      method: 'POST',
      headers: { Authorization: `Key ${cfg.secretKey}` },
      body,
      fetch: cfg.fetch,
      timeoutMs: cfg.timeoutMs,
    });

  return {
    async initiate(input) {
      assertAmount(input.amount, GATEWAY);
      if (toPaisa(input.amount) < MIN_PAISA) {
        throw new PaymentError('INVALID_INPUT', 'khalti: minimum amount is Rs 10', { gateway: GATEWAY });
      }
      assertNonEmpty(input.orderId, 'orderId', GATEWAY, 'INVALID_INPUT');
      assertHttpUrl(input.returnUrl, 'returnUrl', GATEWAY, 'INVALID_INPUT', cfg.production);

      const info = customerInfo(input.customer);
      const res = await post(cfg.urls.initiate, {
        return_url: input.returnUrl,
        website_url: cfg.websiteUrl,
        amount: toPaisa(input.amount),
        purchase_order_id: input.orderId,
        purchase_order_name: input.productName?.trim() || input.orderId,
        ...(info ? { customer_info: info } : {}),
      });
      if (!isRecord(res) || typeof res.pidx !== 'string' || res.pidx === '' || typeof res.payment_url !== 'string') {
        throw gatewayError('initiate response has no pidx or payment_url', res);
      }
      // Only https payment URLs are returned to the caller.
      if (!isHttpsUrl(res.payment_url)) throw gatewayError('payment_url is not an https URL', res);
      return { type: 'redirect', url: res.payment_url, reference: res.pidx, raw: res };
    },

    async verify(input) {
      assertNonEmpty(input.pidx, 'pidx', GATEWAY, 'INVALID_INPUT');
      assertAmount(input.expectedAmount, GATEWAY);

      const res = await post(cfg.urls.lookup, { pidx: input.pidx }).catch((err: unknown) => {
        // Khalti answers Expired and User canceled with HTTP 400 and a normal lookup body.
        const body = lookupBodyFrom(err);
        if (body) return body;
        throw err;
      });
      if (!isRecord(res) || typeof res.status !== 'string') {
        throw gatewayError('unexpected lookup response', res);
      }
      if (res.pidx !== input.pidx) {
        throw gatewayError('lookup response is for a different pidx', res);
      }
      const paisa = parsePaisa(res.total_amount);
      if (paisa === undefined) throw gatewayError('lookup response has no whole-paisa total_amount', res);

      const amount = fromPaisa(paisa);
      const status = mapKhaltiStatus(res.status);
      if (status === PaymentStatus.COMPLETED && !sameAmount(amount, input.expectedAmount)) {
        throw new PaymentError('AMOUNT_MISMATCH', `khalti: paid ${amount} but expected ${input.expectedAmount}`, {
          gateway: GATEWAY,
          details: { expected: input.expectedAmount, actual: amount, raw: res },
        });
      }

      return {
        status,
        amount,
        transactionId: typeof res.transaction_id === 'string' && res.transaction_id !== '' ? res.transaction_id : undefined,
        raw: res,
      };
    },

    async parseCallback(input) {
      // Khalti does not sign callbacks, so this is only a claim until verify() confirms it.
      const params = toParams(input);
      const pidx = params.pidx;
      if (!pidx) {
        throw new PaymentError('INVALID_INPUT', 'khalti: callback has no pidx', { gateway: GATEWAY, details: params });
      }
      const paisa = parsePaisa(params.total_amount ?? params.amount);

      return {
        reference: pidx,
        orderId: params.purchase_order_id || undefined,
        transactionId: params.transaction_id || params.tidx || params.txnId || undefined,
        claimedStatus: mapKhaltiStatus(params.status),
        amount: paisa === undefined ? undefined : fromPaisa(paisa),
        signatureValid: null,
        raw: params,
      };
    },
  };
}

function customerInfo(customer: Customer | undefined): Record<string, string> | undefined {
  if (!customer) return undefined;
  const info: Record<string, string> = {};
  for (const key of ['name', 'email', 'phone'] as const) {
    const value = customer[key]?.trim();
    if (value) info[key] = value;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

function lookupBodyFrom(err: unknown): Record<string, unknown> | undefined {
  if (!isPaymentError(err) || err.code !== 'GATEWAY_ERROR' || !isRecord(err.details)) return undefined;
  const { status, body } = err.details;
  return status === 400 && isRecord(body) && typeof body.status === 'string' ? body : undefined;
}

/** Flattens req.query, URLSearchParams, a query string or a full URL into single string values. */
function toParams(input: KhaltiCallbackInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input === 'string' || input instanceof URLSearchParams) {
    const search =
      typeof input === 'string' && /^https?:\/\//i.test(input) ? new URL(input).searchParams : new URLSearchParams(input);
    search.forEach((value, key) => {
      if (!(key in out)) out[key] = value;
    });
    return out;
  }
  if (!isRecord(input)) {
    throw new PaymentError('INVALID_INPUT', 'khalti: callback input must be query params', { gateway: GATEWAY });
  }
  for (const [key, value] of Object.entries(input)) {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[key] = first;
    else if (typeof first === 'number') out[key] = String(first);
  }
  return out;
}
