import { describe, expect, it } from 'vitest';
import { createKhalti } from '../src/client';
import { jsonResponse, lookupBody, mockFetch, SANDBOX } from './helpers';

const PIDX = 'HT6o6PEZRWFJ5ygavzHWd5';
const input = { pidx: PIDX, expectedAmount: 10 };

function setup(...responses: Array<Response | Error>) {
  const { fetch, calls } = mockFetch(...responses);
  return { khalti: createKhalti({ ...SANDBOX, fetch }), calls };
}

describe('khalti.verify', () => {
  it('confirms a Completed payment', async () => {
    const body = lookupBody('Completed', { transaction_id: 'GFq9PFS7b2iYvL8Lir9oXe' });
    const { khalti, calls } = setup(jsonResponse(body));

    await expect(khalti.verify(input)).resolves.toEqual({
      status: 'COMPLETED',
      amount: 10,
      transactionId: 'GFq9PFS7b2iYvL8Lir9oXe',
      raw: body,
    });
    expect(calls[0]).toMatchObject({
      url: 'https://dev.khalti.com/api/v2/epayment/lookup/',
      method: 'POST',
      headers: { Authorization: 'Key test_secret_key_abc' },
      body: { pidx: PIDX },
    });
  });

  it('uses the production lookup URL in production', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(lookupBody('Completed')));
    await createKhalti({ ...SANDBOX, environment: 'production', fetch }).verify(input);
    expect(calls[0]!.url).toBe('https://khalti.com/api/v2/epayment/lookup/');
  });

  // HTTP codes from the "Payment Status Code (Lookup)" table on docs.khalti.com.
  it.each([
    ['Pending', 200, 'PENDING'],
    ['Initiated', 200, 'PENDING'],
    ['Refunded', 200, 'REFUNDED'],
    ['Partially Refunded', 200, 'REFUNDED'],
    ['Partially refunded', 200, 'REFUNDED'],
    ['Expired', 400, 'FAILED'],
    ['User canceled', 400, 'CANCELED'],
  ])('maps "%s" (HTTP %s) to %s without throwing', async (khaltiStatus, http, expected) => {
    const { khalti } = setup(jsonResponse(lookupBody(khaltiStatus), http));
    await expect(khalti.verify(input)).resolves.toMatchObject({ status: expected, amount: 10, transactionId: undefined });
  });

  it('throws AMOUNT_MISMATCH when a Completed payment has a different amount', async () => {
    const { khalti } = setup(jsonResponse(lookupBody('Completed', { total_amount: 100 })));
    await expect(khalti.verify(input)).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
      details: { expected: 10, actual: 1 },
    });
  });

  it('does not flag an amount difference on a payment that is not complete', async () => {
    const { khalti } = setup(jsonResponse(lookupBody('Pending', { total_amount: 100 })));
    await expect(khalti.verify(input)).resolves.toMatchObject({ status: 'PENDING', amount: 1 });
  });

  it.each([
    ['400 without a lookup body', jsonResponse({ detail: 'Not found.', error_key: 'validation_error' }, 400), 'HTTP 400: Not found.'],
    ['404 even with a status', jsonResponse(lookupBody('Expired'), 404), 'HTTP 404'],
    ['401 wrong key', jsonResponse({ detail: 'Invalid token.', status_code: 401 }, 401), 'HTTP 401: Invalid token.'],
    ['500 error', new Response('Internal Server Error', { status: 500 }), 'HTTP 500'],
  ])('throws GATEWAY_ERROR on %s', async (_label, response, message) => {
    const { khalti } = setup(response);
    await expect(khalti.verify(input)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: expect.stringContaining(message),
    });
  });

  it.each([
    ['another pidx', lookupBody('Completed', { pidx: 'OTHER' }), 'different pidx'],
    ['no status', { pidx: PIDX, total_amount: 1000 }, 'unexpected lookup response'],
    ['no total_amount', lookupBody('Completed', { total_amount: null }), 'no total_amount'],
    ['a non-numeric total_amount', lookupBody('Completed', { total_amount: 'lots' }), 'no total_amount'],
  ])('throws GATEWAY_ERROR for a lookup with %s', async (_label, body, message) => {
    const { khalti } = setup(jsonResponse(body));
    await expect(khalti.verify(input)).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: expect.stringContaining(message),
    });
  });

  it('passes through network failures', async () => {
    const { khalti } = setup(new TypeError('fetch failed'));
    await expect(khalti.verify(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it.each([
    ['empty pidx', { pidx: '', expectedAmount: 10 }],
    ['missing expectedAmount', { pidx: PIDX } as unknown as typeof input],
    ['negative expectedAmount', { pidx: PIDX, expectedAmount: -1 }],
  ])('rejects %s with INVALID_INPUT before calling Khalti', async (_label, bad) => {
    const { khalti, calls } = setup();
    await expect(khalti.verify(bad)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls).toHaveLength(0);
  });
});
