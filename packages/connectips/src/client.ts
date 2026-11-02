import {
  assertAmount,
  assertServerSide,
  fromPaisa,
  isRecord,
  parseAmount,
  PaymentError,
  PaymentStatus,
  requestJson,
  toPaisa,
  type FormInitiateResult,
  type PaymentGateway,
} from '@nepalpay/core';
import { resolveConfig, type ConnectipsConfig } from './config';
import { mapConnectipsStatus, SETTLED_CREDIT_STATUSES } from './mapStatus';
import { bytesToBase64, checkoutMessage, importSigningKey, privateKeyDer, sign, validationMessage, type CheckoutFields } from './signing';

const GATEWAY = 'connectips';

/** NCHL caps TXNID at 20 characters; it must be unique for every payment request. */
const TXNID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

/** Nepal Standard Time, UTC+05:45. */
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60_000;

export interface ConnectipsInitiateInput {
  /** Amount in rupees (max 2 decimals); connectIPS receives it in paisa. */
  amount: number;
  /** TXNID: a new id for every attempt, up to 20 letters, digits, "-" or "_". Use paymentAttemptId(order.id, { maxLength: 20 }). */
  orderId: string;
  /** REFERENCEID, up to 20 characters. Defaults to orderId. */
  referenceId?: string;
  /** REMARKS, up to 50 characters. Defaults to "Payment". */
  remarks?: string;
  /** PARTICULARS, up to 100 characters. Defaults to remarks. */
  particulars?: string;
  /** Transaction date, sent as DD-MM-YYYY in Nepal time. Defaults to now. */
  date?: Date;
}

export interface ConnectipsVerifyInput {
  /** The TXNID given to initiate(). */
  orderId: string;
  /** Expected amount in rupees; a completed payment for another amount throws AMOUNT_MISMATCH. */
  amount: number;
}

/** Query params of the success or failure redirect (only TXNID): req.query, URLSearchParams, a query string or the full URL. */
export type ConnectipsCallbackInput = Record<string, unknown> | URLSearchParams | string;

/** gettxndetail: the status plus NCHL's own records of the transaction. */
export interface ConnectipsTransactionDetail {
  /** COMPLETED only when NCHL reports SUCCESS and, if present, a settled creditStatus. */
  status: PaymentStatus;
  /** Amount in rupees. */
  amount: number;
  orderId: string;
  /** NCHL transaction id. */
  transactionId?: string;
  batchId?: string;
  /** Code of the customer's bank. */
  debitBankCode?: string;
  /** Charge in rupees, and who bears it (chargeLiability). */
  chargeAmount?: number;
  chargeLiability?: string;
  creditStatus?: string;
  raw: unknown;
}

export type ConnectipsClient = PaymentGateway<
  ConnectipsVerifyInput,
  ConnectipsCallbackInput,
  FormInitiateResult,
  ConnectipsInitiateInput
> & {
  transactionDetail(input: ConnectipsVerifyInput): Promise<ConnectipsTransactionDetail>;
};

const gatewayError = (message: string, raw: unknown) =>
  new PaymentError('GATEWAY_ERROR', `connectips: ${message}`, { gateway: GATEWAY, details: raw });

const invalidInput = (message: string) => new PaymentError('INVALID_INPUT', `connectips: ${message}`, { gateway: GATEWAY });

function assertTxnId(value: unknown, field = 'orderId'): asserts value is string {
  if (typeof value !== 'string' || !TXNID_PATTERN.test(value)) {
    throw invalidInput(`"${field}" must be 1 to 20 letters, digits, "-" or "_"`);
  }
}

/** Free text fields go into the signed "A=b,C=d" string, so "," and "=" would change what is signed. */
function assertText(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[,=\u0000-\u001f\u007f]/.test(value)) {
    throw invalidInput(`"${field}" must be 1 to ${max} characters without "," "=" or control characters`);
  }
}

/** DD-MM-YYYY in Nepal time. */
function nepalDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw invalidInput('"date" must be a valid Date');
  const npt = new Date(date.getTime() + NEPAL_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(npt.getUTCDate())}-${two(npt.getUTCMonth() + 1)}-${npt.getUTCFullYear()}`;
}

export function createConnectips(config: ConnectipsConfig): ConnectipsClient {
  assertServerSide(GATEWAY);
  const cfg = resolveConfig(config);
  privateKeyDer(cfg.privateKey); // a malformed key fails here, at startup, not on the first payment
  let key: Promise<CryptoKey> | undefined;
  const signingKey = () => (key ??= importSigningKey(cfg.privateKey));
  const authorization = `Basic ${bytesToBase64(new TextEncoder().encode(`${cfg.appId}:${cfg.password}`))}`;
  const merchantIdValue = Number.isSafeInteger(Number(cfg.merchantId)) ? Number(cfg.merchantId) : cfg.merchantId;

  /** POSTs a signed validatetxn or gettxndetail request. */
  async function query(url: string, input: ConnectipsVerifyInput): Promise<Record<string, unknown>> {
    assertTxnId(input?.orderId);
    assertAmount(input.amount, GATEWAY);
    const paisa = toPaisa(input.amount);
    const token = await sign(await signingKey(), validationMessage(cfg.merchantId, cfg.appId, input.orderId, paisa));
    let res: unknown;
    try {
      res = await requestJson({
        gateway: GATEWAY,
        url,
        method: 'POST',
        headers: { Authorization: authorization },
        body: { merchantId: merchantIdValue, appId: cfg.appId, referenceId: input.orderId, txnAmt: paisa, token },
        fetch: cfg.fetch,
        timeoutMs: cfg.timeoutMs,
      });
    } catch (err) {
      if (err instanceof PaymentError && isRecord(err.details) && err.details.status === 401) {
        throw new PaymentError('INVALID_CONFIG', 'connectips: the validation API refused appId or password (HTTP 401)', {
          gateway: GATEWAY,
          details: err.details,
          cause: err,
        });
      }
      throw err;
    }
    if (!isRecord(res) || typeof res.status !== 'string') throw gatewayError('reply has no status', res);
    // NCHL may leave out ids for an unknown transaction; whatever it names must be ours.
    if (res.referenceId != null && String(res.referenceId) !== input.orderId) throw gatewayError('reply is for another transaction', res);
    if (res.appId != null && String(res.appId) !== cfg.appId) throw gatewayError('reply is for another app', res);
    if (res.merchantId != null && String(res.merchantId) !== cfg.merchantId) throw gatewayError('reply is for another merchant', res);
    return res;
  }

  /** The reply's amount in rupees; a completed payment must report exactly the expected whole paisa. */
  function replyAmount(res: Record<string, unknown>, status: PaymentStatus, input: ConnectipsVerifyInput): number {
    const paisa = parseAmount(res.txnAmt);
    const whole = paisa !== undefined && Number.isSafeInteger(Math.round(paisa)) && Math.abs(paisa - Math.round(paisa)) < 1e-9;
    if (status !== PaymentStatus.COMPLETED) return whole ? fromPaisa(Math.round(paisa)) : input.amount;
    if (!whole) throw gatewayError('completed reply has no whole-paisa txnAmt', res);
    if (Math.round(paisa) !== toPaisa(input.amount)) {
      throw new PaymentError('AMOUNT_MISMATCH', `connectips: paid ${fromPaisa(Math.round(paisa))} but expected ${input.amount}`, {
        gateway: GATEWAY,
        details: res,
      });
    }
    return input.amount;
  }

  const text = (value: unknown) => (value == null || value === '' ? undefined : String(value));

  return {
    async initiate(input) {
      assertAmount(input?.amount, GATEWAY);
      assertTxnId(input.orderId);
      const referenceId = input.referenceId ?? input.orderId;
      const remarks = input.remarks ?? 'Payment';
      const particulars = input.particulars ?? remarks;
      assertText(referenceId, 'referenceId', 20);
      assertText(remarks, 'remarks', 50);
      assertText(particulars, 'particulars', 100);

      const fields: CheckoutFields = {
        MERCHANTID: cfg.merchantId,
        APPID: cfg.appId,
        APPNAME: cfg.appName,
        TXNID: input.orderId,
        TXNDATE: nepalDate(input.date ?? new Date()),
        TXNCRNCY: 'NPR',
        TXNAMT: String(toPaisa(input.amount)),
        REFERENCEID: referenceId,
        REMARKS: remarks,
        PARTICULARS: particulars,
      };
      const TOKEN = await sign(await signingKey(), checkoutMessage(fields));
      return { type: 'form', action: cfg.urls.form, fields: { ...fields, TOKEN }, reference: input.orderId };
    },

    async verify(input) {
      const res = await query(cfg.urls.validate, input);
      const status = mapConnectipsStatus(res.status, res.statusDesc);
      return { status, amount: replyAmount(res, status, input), orderId: input.orderId, raw: res };
    },

    async transactionDetail(input) {
      const res = await query(cfg.urls.detail, input);
      const creditStatus = text(res.creditStatus);
      let status = mapConnectipsStatus(res.status, res.statusDesc);
      if (status === PaymentStatus.COMPLETED && creditStatus && !SETTLED_CREDIT_STATUSES.has(creditStatus.toUpperCase())) {
        status = PaymentStatus.FAILED;
      }
      const charge = parseAmount(res.chargeAmt);
      return {
        status,
        amount: replyAmount(res, status, input),
        orderId: input.orderId,
        transactionId: text(res.txnId),
        batchId: text(res.batchId),
        debitBankCode: text(res.debitBankCode),
        chargeAmount: charge === undefined ? undefined : fromPaisa(charge),
        chargeLiability: text(res.chargeLiability),
        creditStatus,
        raw: res,
      };
    },

    async parseCallback(input) {
      // connectIPS redirects with only TXNID: no status and no signature, so verify() decides.
      const params = toParams(input);
      const key = Object.keys(params).find((name) => name.toUpperCase() === 'TXNID');
      const txnId = key === undefined ? undefined : params[key];
      if (!txnId || !TXNID_PATTERN.test(txnId)) {
        throw new PaymentError('INVALID_INPUT', 'connectips: callback has no valid TXNID', { gateway: GATEWAY, details: params });
      }
      return { reference: txnId, orderId: txnId, claimedStatus: PaymentStatus.PENDING, signatureValid: null, raw: params };
    },
  };
}

function toParams(input: ConnectipsCallbackInput): Record<string, string> {
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
    throw new PaymentError('INVALID_INPUT', 'connectips: callback input must be query params', { gateway: GATEWAY });
  }
  for (const [key, value] of Object.entries(input)) {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[key] = first;
    else if (typeof first === 'number') out[key] = String(first);
  }
  return out;
}
