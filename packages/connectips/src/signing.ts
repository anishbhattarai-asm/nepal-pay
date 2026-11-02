import { PaymentError } from '@nepalpay/core';

const encoder = new TextEncoder();

/** A PEM block: BEGIN line, base64 body (and, for legacy encrypted keys, headers), END line. */
const PEM_BLOCK = /-{5}BEGIN ([A-Z0-9 ]+)-{5}([\s\S]*?)-{5}END \1-{5}/;

/** AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL parameters. */
const RSA_ALGORITHM = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** Fields of the payment form TOKEN, in the order NCHL signs them. */
export const CHECKOUT_FIELDS = [
  'MERCHANTID',
  'APPID',
  'APPNAME',
  'TXNID',
  'TXNDATE',
  'TXNCRNCY',
  'TXNAMT',
  'REFERENCEID',
  'REMARKS',
  'PARTICULARS',
] as const;

export type CheckoutFields = Record<(typeof CHECKOUT_FIELDS)[number], string>;

const invalidKey = (message: string, cause?: unknown) =>
  new PaymentError('INVALID_CONFIG', `connectips: ${message}`, { gateway: 'connectips', cause });

/** "MERCHANTID=..,APPID=..,...,PARTICULARS=..,TOKEN=TOKEN": the text signed for the payment form. */
export const checkoutMessage = (fields: CheckoutFields): string =>
  [...CHECKOUT_FIELDS.map((name) => `${name}=${fields[name]}`), 'TOKEN=TOKEN'].join(',');

/** "MERCHANTID=..,APPID=..,REFERENCEID=..,TXNAMT=..": the text signed for validatetxn and gettxndetail. */
export const validationMessage = (merchantId: string, appId: string, referenceId: string, paisa: number): string =>
  `MERCHANTID=${merchantId},APPID=${appId},REFERENCEID=${referenceId},TXNAMT=${paisa}`;

/** PKCS#8 DER of an RSA private key given as an unencrypted PKCS#8 or PKCS#1 PEM. */
export function privateKeyDer(pem: string): Uint8Array<ArrayBuffer> {
  const match = PEM_BLOCK.exec(pem);
  if (!match) throw invalidKey('"privateKey" must be a PEM private key');
  const label = match[1]!;
  const body = match[2]!;
  if (label === 'ENCRYPTED PRIVATE KEY' || /Proc-Type:\s*4,ENCRYPTED/.test(body)) {
    throw invalidKey('"privateKey" is encrypted; export it with -nodes so it has no passphrase');
  }
  if (label !== 'PRIVATE KEY' && label !== 'RSA PRIVATE KEY') {
    throw invalidKey(`"privateKey" holds a ${label}, not a private key`);
  }
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  } catch (err) {
    throw invalidKey('"privateKey" is not valid base64', err);
  }
  return label === 'PRIVATE KEY' ? der : pkcs1ToPkcs8(der);
}

export async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = privateKeyDer(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch (err) {
    throw invalidKey('"privateKey" is not an RSA private key', err);
  }
}

/** SHA256withRSA (RSASSA-PKCS1-v1_5) signature of the UTF-8 message, base64 encoded. */
export async function sign(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(message));
  return bytesToBase64(new Uint8Array(signature));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo, which Web Crypto imports. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const body = [0x02, 0x01, 0x00, ...RSA_ALGORITHM, 0x04, ...derLength(pkcs1.length), ...pkcs1];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return [0x80 | bytes.length, ...bytes];
}
