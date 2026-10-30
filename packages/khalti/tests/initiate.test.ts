import { describe, expect, it } from 'vitest';
import type { InitiateInput } from '@nepalpay/core';
import { createKhalti } from '../src/client';
import { jsonResponse, mockFetch, SANDBOX } from './helpers';

const base: InitiateInput = { amount: 100, orderId: 'ORD-1', returnUrl: 'https://shop.example/khalti/return' };

/** Initiate success response from docs.khalti.com. */
const success = {
  pidx: 'bZQLD9wRVWo4CdESSfuSsB',
  payment_url: 'https://test-pay.khalti.com/?pidx=bZQLD9wRVWo4CdESSfuSsB',
  expires_at: '2023-05-25T16:26:16.471649+05:45',
  expires_in: 1800,
};

function setup(...responses: Array<Response | Error>) {
  const { fetch, calls } = mockFetch(...responses);
  return { khalti: createKhalti({ ...SANDBOX, fetch }), calls };
}

describe('khalti.initiate', () => {
  it('posts the payment and returns the redirect URL', async () => {
    const { khalti, calls } = setup(jsonResponse(success));

    await expect(khalti.initiate(base)).resolves.toEqual({
      type: 'redirect',
      url: success.payment_url,
      reference: success.pidx,
      raw: success,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: 'https://dev.khalti.com/api/v2/epayment/initiate/',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Key test_secret_key_abc',
      },
      body: {
        return_url: 'https://shop.example/khalti/return',
        website_url: 'https://shop.example',
        amount: 10000,
        purchase_order_id: 'ORD-1',
        purchase_order_name: 'ORD-1',
      },
    });
  });

  it('uses the production URL in production', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(success));
    await createKhalti({ ...SANDBOX, environment: 'production', fetch }).initiate(base);
    expect(calls[0]!.url).toBe('https://khalti.com/api/v2/epayment/initiate/');
  });

  it('sends productName and only the customer fields that are set', async () => {
    const { khalti, calls } = setup(jsonResponse(success));
    await khalti.initiate({
      ...base,
      productName: '  Momo platter  ',
      customer: { name: 'Sita', email: ' ', phone: '9800000001' },
    });
    expect(calls[0]!.body).toMatchObject({
      purchase_order_name: 'Momo platter',
      customer_info: { name: 'Sita', phone: '9800000001' },
    });
  });

  it('leaves customer_info out when no customer field is set', async () => {
    const { khalti, calls } = setup(jsonResponse(success));
    await khalti.initiate({ ...base, productName: '   ', customer: { email: '' } });
    expect(calls[0]!.body).not.toHaveProperty('customer_info');
    expect(calls[0]!.body).toMatchObject({ purchase_order_name: 'ORD-1' });
  });

  it.each([
    [10, 1000],
    [10.5, 1050],
    [0.1 + 9.9, 1000],
    [1234.56, 123456],
  ])('sends %s rupees as %s paisa', async (amount, paisa) => {
    const { khalti, calls } = setup(jsonResponse(success));
    await khalti.initiate({ ...base, amount });
    expect(calls[0]!.body).toMatchObject({ amount: paisa });
  });

  it.each([
    ['below Rs 10', { amount: 9.99 }, 'khalti: minimum amount is Rs 10'],
    ['zero amount', { amount: 0 }, 'khalti: amount must be a positive number in rupees'],
    ['3 decimals', { amount: 10.555 }, 'khalti: amount can have at most 2 decimal places'],
    ['empty orderId', { orderId: ' ' }, 'khalti: "orderId" is required'],
    ['relative returnUrl', { returnUrl: '/khalti/return' }, 'khalti: "returnUrl" must be an absolute http(s) URL'],
  ])('rejects %s with INVALID_INPUT before calling Khalti', async (_label, override, message) => {
    const { khalti, calls } = setup();
    await expect(khalti.initiate({ ...base, ...override })).rejects.toMatchObject({ code: 'INVALID_INPUT', message });
    expect(calls).toHaveLength(0);
  });

  it('reports a 400 validation error with the field messages', async () => {
    const body = { return_url: ['This field may not be blank.'], error_key: 'validation_error' };
    const { khalti } = setup(jsonResponse(body, 400));
    await expect(khalti.initiate(base)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'khalti responded with HTTP 400: return_url: This field may not be blank.',
      details: { status: 400, body },
    });
  });

  it('reports a wrong key (401 Invalid token.)', async () => {
    const { khalti } = setup(jsonResponse({ detail: 'Invalid token.', status_code: 401 }, 401));
    await expect(khalti.initiate(base)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'khalti responded with HTTP 401: Invalid token.',
    });
  });

  it.each([
    ['no payment_url', { pidx: 'abc' }],
    ['no pidx', { payment_url: 'https://test-pay.khalti.com/?pidx=abc' }],
    ['an empty pidx', { pidx: '', payment_url: 'https://test-pay.khalti.com/?pidx=' }],
    ['an empty body', null],
  ])('throws GATEWAY_ERROR for a 200 response with %s', async (_label, body) => {
    const { khalti } = setup(jsonResponse(body));
    await expect(khalti.initiate(base)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'khalti: initiate response has no pidx or payment_url',
    });
  });

  it.each([
    ['plain http', 'http://test-pay.khalti.com/?pidx=abc'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', '/pay?pidx=abc'],
  ])('refuses to redirect the customer to a payment_url that is %s', async (_label, payment_url) => {
    const { khalti } = setup(jsonResponse({ pidx: 'abc', payment_url }));
    await expect(khalti.initiate(base)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'khalti: payment_url is not an https URL',
    });
  });

  it('requires an https returnUrl in production', async () => {
    const { fetch, calls } = mockFetch();
    const khalti = createKhalti({ ...SANDBOX, environment: 'production', fetch });
    await expect(khalti.initiate({ ...base, returnUrl: 'http://shop.example/khalti/return' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'khalti: "returnUrl" must be an absolute https URL in production',
    });
    expect(calls).toHaveLength(0);
  });

  it('allows an http returnUrl in the sandbox (local development)', async () => {
    const { khalti, calls } = setup(jsonResponse(success));
    await khalti.initiate({ ...base, returnUrl: 'http://localhost:3000/khalti/callback' });
    expect(calls[0]!.body).toMatchObject({ return_url: 'http://localhost:3000/khalti/callback' });
  });

  it('passes through network failures', async () => {
    const { khalti } = setup(new TypeError('fetch failed'));
    await expect(khalti.initiate(base)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
