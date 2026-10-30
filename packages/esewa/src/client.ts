import {
  assertAmount,
  assertHttpUrl,
  assertNonEmpty,
  assertServerSide,
  formatRupees,
  isRecord,
  parseAmount,
  PaymentError,
  PaymentStatus,
  requestJson,
  sameAmount,
  type PaymentGateway,
} from '@nepalpay/core';
import { decodeCallbackData } from './callback';
import { resolveConfig, type EsewaConfig } from './config';
import { mapEsewaStatus } from './mapStatus';
import { DEFAULT_SIGNED_FIELDS, sign, verifySignature } from './signing';

const GATEWAY = 'esewa';

/** transaction_uuid goes into a comma-joined signed message and a query string, so keep it to safe characters. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The callback names its own signed fields, so a signature over fewer fields (such as the one on the
 * initiate form the customer can see) must not vouch for the fields parseCallback reports.
 */
const REQUIRED_SIGNED_FIELDS = ['status', 'total_amount', 'transaction_uuid', 'product_code'];

export interface EsewaVerifyInput {
  /** The transaction_uuid you sent (your orderId). */
  orderId: string;
  /** Amount in rupees you EXPECT. eSewa's status API also needs it. */
  amount: number;
}

export interface EsewaCallbackInput {
  /** The base64 `data` query param eSewa appends to success_url. */
  data: string;
}

export type EsewaClient = PaymentGateway<EsewaVerifyInput, EsewaCallbackInput>;

const gatewayError = (message: string, raw: unknown) =>
  new PaymentError('GATEWAY_ERROR', `esewa: ${message}`, { gateway: GATEWAY, details: raw });

function assertOrderId(orderId: unknown): asserts orderId is string {
  assertNonEmpty(orderId, 'orderId', GATEWAY, 'INVALID_INPUT');
  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new PaymentError('INVALID_INPUT', 'esewa: "orderId" may only contain letters, digits, "-" and "_"', {
      gateway: GATEWAY,
    });
  }
}

export function createEsewa(config: EsewaConfig): EsewaClient {
  assertServerSide(GATEWAY);
  const cfg = resolveConfig(config);

  return {
    async initiate(input) {
      assertAmount(input.amount, GATEWAY);
      assertOrderId(input.orderId);
      assertHttpUrl(input.returnUrl, 'returnUrl', GATEWAY, 'INVALID_INPUT', cfg.production);
      const failureUrl = input.failureUrl ?? input.returnUrl;
      assertHttpUrl(failureUrl, 'failureUrl', GATEWAY, 'INVALID_INPUT', cfg.production);

      const total = formatRupees(input.amount);
      const fields: Record<string, string> = {
        amount: total,
        tax_amount: '0',
        product_service_charge: '0',
        product_delivery_charge: '0',
        total_amount: total,
        transaction_uuid: input.orderId,
        product_code: cfg.productCode,
        success_url: input.returnUrl,
        failure_url: failureUrl,
        signed_field_names: DEFAULT_SIGNED_FIELDS,
      };
      const signature = await sign(cfg.secretKey, fields, DEFAULT_SIGNED_FIELDS);
      return { type: 'form', action: cfg.urls.form, fields: { ...fields, signature }, reference: input.orderId };
    },

    async verify(input) {
      assertOrderId(input.orderId);
      assertAmount(input.amount, GATEWAY);

      const url = new URL(cfg.urls.status);
      url.searchParams.set('product_code', cfg.productCode);
      url.searchParams.set('total_amount', formatRupees(input.amount));
      url.searchParams.set('transaction_uuid', input.orderId);

      const res = await requestJson({ gateway: GATEWAY, url: url.toString(), fetch: cfg.fetch, timeoutMs: cfg.timeoutMs });
      if (!isRecord(res) || typeof res.status !== 'string') {
        throw gatewayError('unexpected status response', res);
      }
      // eSewa echoes both back; a reply that does not is not about this payment.
      if (String(res.transaction_uuid ?? '') !== input.orderId) {
        throw gatewayError('status response is for a different transaction', res);
      }
      if (String(res.product_code ?? '') !== cfg.productCode) {
        throw gatewayError('status response is for a different product code', res);
      }
      const amount = parseAmount(res.total_amount);
      if (amount === undefined) throw gatewayError('status response has no total_amount', res);

      // eSewa answers NOT_FOUND (-> FAILED) when the amount is wrong, so this mainly guards a bad response.
      const status = mapEsewaStatus(res.status);
      if (status === PaymentStatus.COMPLETED && !sameAmount(amount, input.amount)) {
        throw new PaymentError('AMOUNT_MISMATCH', `esewa: paid ${amount} but expected ${input.amount}`, {
          gateway: GATEWAY,
          details: { expected: input.amount, actual: amount, raw: res },
        });
      }

      return {
        status,
        amount,
        orderId: input.orderId,
        transactionId: typeof res.ref_id === 'string' && res.ref_id !== '' ? res.ref_id : undefined,
        raw: res,
      };
    },

    async parseCallback(input) {
      const payload = decodeCallbackData(input?.data);
      const { signed_field_names: signedFields, signature, transaction_uuid: orderId } = payload;
      if (!signedFields || !signature) {
        throw new PaymentError('INVALID_INPUT', 'esewa: callback is missing signed_field_names or signature', {
          gateway: GATEWAY,
          details: payload,
        });
      }
      const signed = new Set(signedFields.split(','));
      const unsigned = REQUIRED_SIGNED_FIELDS.filter((field) => !signed.has(field));
      if (unsigned.length > 0) {
        throw new PaymentError(
          'SIGNATURE_MISMATCH',
          `esewa: callback signature does not cover ${unsigned.join(', ')}; do not trust it`,
          { gateway: GATEWAY, details: payload },
        );
      }
      if (!(await verifySignature(cfg.secretKey, payload, signedFields, signature))) {
        throw new PaymentError('SIGNATURE_MISMATCH', 'esewa: callback signature does not match; do not trust it', {
          gateway: GATEWAY,
          details: payload,
        });
      }
      if (payload.product_code !== cfg.productCode) {
        throw new PaymentError('SIGNATURE_MISMATCH', 'esewa: callback is for a different product code', {
          gateway: GATEWAY,
          details: payload,
        });
      }
      if (!orderId) {
        throw new PaymentError('INVALID_INPUT', 'esewa: callback has no transaction_uuid', {
          gateway: GATEWAY,
          details: payload,
        });
      }

      return {
        reference: orderId,
        orderId,
        transactionId: signed.has('transaction_code') ? payload.transaction_code || undefined : undefined,
        claimedStatus: mapEsewaStatus(payload.status),
        amount: parseAmount(payload.total_amount),
        signatureValid: true,
        raw: payload,
      };
    },
  };
}
