import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FormInitiateResult, InitiateInput } from '@nepalpay/core';
import { createEsewa } from '../src/client';
import { paymentAttemptId } from '../src';
import { mockFetch, nodeHmac, UAT } from './helpers';

const base: InitiateInput = { amount: 100, orderId: 'ORD-1', returnUrl: 'https://shop.example/esewa/ok' };

describe('esewa.initiate', () => {
  it('is typed as a form, so callers read fields without narrowing', async () => {
    const result = await createEsewa({ environment: 'sandbox', ...UAT }).initiate(base);
    expectTypeOf(result).toEqualTypeOf<FormInitiateResult>();
    expect(result.fields.signature).toBeTypeOf('string');
  });

  it('returns a signed form for the sandbox', async () => {
    const { fetch, calls } = mockFetch();
    const esewa = createEsewa({ environment: 'sandbox', ...UAT, fetch });
    const result = await esewa.initiate({ ...base, failureUrl: 'https://shop.example/esewa/fail' });

    expect(result.action).toBe('https://rc-epay.esewa.com.np/api/epay/main/v2/form');
    expect(result.reference).toBe('ORD-1');
    expect(result.fields).toEqual({
      amount: '100',
      tax_amount: '0',
      product_service_charge: '0',
      product_delivery_charge: '0',
      total_amount: '100',
      transaction_uuid: 'ORD-1',
      product_code: 'EPAYTEST',
      success_url: 'https://shop.example/esewa/ok',
      failure_url: 'https://shop.example/esewa/fail',
      signed_field_names: 'total_amount,transaction_uuid,product_code',
      signature: nodeHmac(UAT.secretKey, 'total_amount=100,transaction_uuid=ORD-1,product_code=EPAYTEST'),
    });
    expect(calls).toHaveLength(0); // building the form never calls eSewa
  });

  it('posts to the production form URL in production', async () => {
    const esewa = createEsewa({ environment: 'production', productCode: 'MERCHANT', secretKey: 'live-secret' });
    const result = await esewa.initiate(base);
    expect(result.action).toBe('https://epay.esewa.com.np/api/epay/main/v2/form');
    expect(result.fields.product_code).toBe('MERCHANT');
    expect(result.fields.signature).toBe(nodeHmac('live-secret', 'total_amount=100,transaction_uuid=ORD-1,product_code=MERCHANT'));
  });

  it('requires https callback URLs in production', async () => {
    const esewa = createEsewa({ environment: 'production', productCode: 'MERCHANT', secretKey: 's' });
    await expect(esewa.initiate({ ...base, returnUrl: 'http://shop.example/ok' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'esewa: "returnUrl" must be an absolute https URL in production',
    });
    await expect(esewa.initiate({ ...base, failureUrl: 'http://shop.example/fail' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'esewa: "failureUrl" must be an absolute https URL in production',
    });
  });

  it('allows http callback URLs in the sandbox (local development)', async () => {
    const result = await createEsewa({ environment: 'sandbox', ...UAT }).initiate({ ...base, returnUrl: 'http://localhost:3000/cb' });
    expect(result.fields.success_url).toBe('http://localhost:3000/cb');
  });

  it('takes a paymentAttemptId as the transaction_uuid for each retry', async () => {
    const esewa = createEsewa({ environment: 'sandbox', ...UAT });
    const first = await esewa.initiate({ ...base, orderId: paymentAttemptId('ORD-1') });
    const retry = await esewa.initiate({ ...base, orderId: paymentAttemptId('ORD-1') });
    expect(first.fields.transaction_uuid).toMatch(/^ORD-1-[a-z0-9]{8}$/);
    expect(retry.fields.transaction_uuid).not.toBe(first.fields.transaction_uuid);
  });

  it('defaults failure_url to returnUrl', async () => {
    const result = await createEsewa({ environment: 'sandbox', ...UAT }).initiate(base);
    expect(result.fields.failure_url).toBe(base.returnUrl);
  });

  it.each([
    [100, '100'],
    [10.5, '10.5'],
    [1234.56, '1234.56'],
    [0.1 + 0.2, '0.3'],
  ])('formats %s rupees as "%s" in both amount fields and the signature', async (amount, text) => {
    const result = await createEsewa({ environment: 'sandbox', ...UAT }).initiate({ ...base, amount });
    expect(result.fields.amount).toBe(text);
    expect(result.fields.total_amount).toBe(text);
    expect(result.fields.signature).toBe(
      nodeHmac(UAT.secretKey, `total_amount=${text},transaction_uuid=ORD-1,product_code=EPAYTEST`),
    );
  });

  it('accepts letters, digits, "-" and "_" in orderId', async () => {
    const esewa = createEsewa({ environment: 'sandbox', ...UAT });
    await expect(esewa.initiate({ ...base, orderId: 'Ab9_x-1' })).resolves.toMatchObject({ reference: 'Ab9_x-1' });
  });

  it.each([
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -10 }],
    ['3 decimals', { amount: 10.555 }],
    ['NaN amount', { amount: Number.NaN }],
    ['empty orderId', { orderId: '' }],
    ['orderId with a comma', { orderId: 'ORD,1' }],
    ['orderId with a space', { orderId: 'ORD 1' }],
    ['orderId with a slash', { orderId: 'ORD/1' }],
    ['relative returnUrl', { returnUrl: '/esewa/ok' }],
    ['javascript: returnUrl', { returnUrl: 'javascript:alert(1)' }],
    ['bad failureUrl', { failureUrl: 'not a url' }],
  ])('rejects %s with INVALID_INPUT', async (_label, override) => {
    const esewa = createEsewa({ environment: 'sandbox', ...UAT });
    await expect(esewa.initiate({ ...base, ...override })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      gateway: 'esewa',
    });
  });
});
