import { PaymentError } from '@anishbhattarai/core';

export const DEFAULT_SIGNED_FIELDS = 'total_amount,transaction_uuid,product_code';

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

/** "a=1,b=2,c=3" in the exact order of signed_field_names. */
export function buildMessage(fields: Record<string, string>, signedFieldNames: string): string {
  return signedFieldNames
    .split(',')
    .map((name) => {
      const value = fields[name];
      if (value === undefined) {
        throw new PaymentError('INVALID_INPUT', `esewa: missing signed field "${name}"`, { gateway: 'esewa' });
      }
      return `${name}=${value}`;
    })
    .join(',');
}

export function sign(secret: string, fields: Record<string, string>, signedFieldNames: string): Promise<string> {
  return hmacSha256Base64(secret, buildMessage(fields, signedFieldNames));
}

export async function verifySignature(
  secret: string,
  fields: Record<string, string>,
  signedFieldNames: string,
  signature: string,
): Promise<boolean> {
  const expected = await sign(secret, fields, signedFieldNames);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
