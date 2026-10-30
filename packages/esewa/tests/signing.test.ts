import { describe, expect, it } from 'vitest';
import { buildMessage, DEFAULT_SIGNED_FIELDS, hmacSha256Base64, sign, verifySignature } from '../src/signing';
import { nodeHmac, UAT } from './helpers';

const fields = { total_amount: '100', transaction_uuid: 'ORD-1', product_code: 'EPAYTEST' };

describe('esewa signing', () => {
  it('builds the message in signed_field_names order', () => {
    expect(buildMessage(fields, DEFAULT_SIGNED_FIELDS)).toBe(
      'total_amount=100,transaction_uuid=ORD-1,product_code=EPAYTEST',
    );
    expect(buildMessage(fields, 'product_code,total_amount')).toBe('product_code=EPAYTEST,total_amount=100');
  });

  it('throws INVALID_INPUT on a missing signed field', () => {
    expect(() => buildMessage({ total_amount: '100' }, DEFAULT_SIGNED_FIELDS)).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: 'esewa: missing signed field "transaction_uuid"' }),
    );
  });

  it('matches node:crypto HMAC-SHA256 (base64)', async () => {
    for (const [secret, message] of [
      [UAT.secretKey, 'total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST'],
      ['k', ''],
      ['नेपाल', 'unicode=नमस्ते'],
    ] as const) {
      expect(await hmacSha256Base64(secret, message)).toBe(nodeHmac(secret, message));
    }
  });

  it("verifies the signature in eSewa's documented success response", async () => {
    const payload = {
      transaction_code: '000AWEO',
      status: 'COMPLETE',
      total_amount: '1000.0',
      transaction_uuid: '250610-162413',
      product_code: 'EPAYTEST',
      signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
    };
    const documented = '62GcfZTmVkzhtUeh+QJ1AqiJrjoWWGof3U+eTPTZ7fA=';
    expect(await verifySignature(UAT.secretKey, payload, payload.signed_field_names, documented)).toBe(true);
    // The same payload with the amount read back as 1000 no longer matches.
    expect(
      await verifySignature(UAT.secretKey, { ...payload, total_amount: '1000' }, payload.signed_field_names, documented),
    ).toBe(false);
  });

  it('signs and verifies (round trip)', async () => {
    const sig = await sign('test-secret', fields, DEFAULT_SIGNED_FIELDS);
    expect(await verifySignature('test-secret', fields, DEFAULT_SIGNED_FIELDS, sig)).toBe(true);
    expect(await verifySignature('wrong-secret', fields, DEFAULT_SIGNED_FIELDS, sig)).toBe(false);
    expect(await verifySignature('test-secret', { ...fields, total_amount: '1' }, DEFAULT_SIGNED_FIELDS, sig)).toBe(false);
    expect(await verifySignature('test-secret', fields, DEFAULT_SIGNED_FIELDS, sig.slice(0, -2))).toBe(false);
  });
});
