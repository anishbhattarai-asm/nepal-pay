import { describe, expect, it } from 'vitest';
import { createEsewa } from '../src/client';
import { jsonResponse, mockFetch, UAT } from './helpers';

/** Shape of eSewa's status API response (captured from the live sandbox). */
const statusBody = (status: string, extra: Record<string, unknown> = {}) => ({
  product_code: 'EPAYTEST',
  transaction_uuid: 'ORD-1',
  total_amount: 100.0,
  status,
  ref_id: null,
  ...extra,
});

function setup(...responses: Array<Response | Error>) {
  const { fetch, calls } = mockFetch(...responses);
  return { esewa: createEsewa({ environment: 'sandbox', ...UAT, fetch }), calls };
}

describe('esewa.verify', () => {
  it('confirms a COMPLETE payment', async () => {
    const body = statusBody('COMPLETE', { ref_id: '0001TS9' });
    const { esewa, calls } = setup(jsonResponse(body));

    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).resolves.toEqual({
      status: 'COMPLETED',
      amount: 100,
      orderId: 'ORD-1',
      transactionId: '0001TS9',
      raw: body,
    });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://rc.esewa.com.np/api/epay/transaction/status/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product_code: 'EPAYTEST',
      total_amount: '100',
      transaction_uuid: 'ORD-1',
    });
    expect(calls[0]!.method).toBe('GET');
  });

  it('queries the production status URL in production', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(statusBody('COMPLETE', { product_code: 'MERCHANT' })));
    const esewa = createEsewa({ environment: 'production', productCode: 'MERCHANT', secretKey: 's', fetch });
    await esewa.verify({ orderId: 'ORD-1', amount: 100 });
    expect(calls[0]!.url.startsWith('https://epay.esewa.com.np/api/epay/transaction/status/?')).toBe(true);
  });

  it.each([
    ['PENDING', 'PENDING'],
    ['AMBIGUOUS', 'PENDING'],
    ['NOT_FOUND', 'FAILED'],
    ['CANCELED', 'CANCELED'],
    ['FULL_REFUND', 'REFUNDED'],
    ['PARTIAL_REFUND', 'REFUNDED'],
    ['SOMETHING_NEW', 'FAILED'],
  ])('maps eSewa %s to %s', async (esewaStatus, expected) => {
    const { esewa } = setup(jsonResponse(statusBody(esewaStatus)));
    const result = await esewa.verify({ orderId: 'ORD-1', amount: 100 });
    expect(result.status).toBe(expected);
    expect(result.transactionId).toBeUndefined();
  });

  it('formats decimal amounts in the query and accepts "1,000.0" style totals', async () => {
    const { esewa, calls } = setup(jsonResponse(statusBody('COMPLETE', { total_amount: '1,000.5' })));
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 1000.5 })).resolves.toMatchObject({ amount: 1000.5 });
    expect(new URL(calls[0]!.url).searchParams.get('total_amount')).toBe('1000.5');
  });

  it('throws AMOUNT_MISMATCH when a COMPLETE payment has a different amount', async () => {
    const { esewa } = setup(jsonResponse(statusBody('COMPLETE', { total_amount: 1.0 })));
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
      details: { expected: 100, actual: 1 },
    });
  });

  it('does not flag an amount difference on a payment that is not complete', async () => {
    const { esewa } = setup(jsonResponse(statusBody('NOT_FOUND', { total_amount: 1.0 })));
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).resolves.toMatchObject({ status: 'FAILED' });
  });

  it.each([
    ['another transaction', statusBody('COMPLETE', { transaction_uuid: 'ORD-2' }), 'different transaction'],
    ['no transaction_uuid', statusBody('COMPLETE', { transaction_uuid: undefined }), 'different transaction'],
    ['another product code', statusBody('COMPLETE', { product_code: 'OTHER' }), 'different product code'],
    ['no product_code', statusBody('COMPLETE', { product_code: undefined }), 'different product code'],
    ['no status', { transaction_uuid: 'ORD-1', total_amount: 100 }, 'unexpected status response'],
    ['a JSON array', [], 'unexpected status response'],
    ['plain text', 'OK', 'unexpected status response'],
    ['no total_amount', statusBody('COMPLETE', { total_amount: null }), 'no total_amount'],
  ])('throws GATEWAY_ERROR for a response with %s', async (_label, body, message) => {
    const response = typeof body === 'string' ? new Response(body) : jsonResponse(body);
    const { esewa } = setup(response);
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: expect.stringContaining(message),
    });
  });

  it('passes through HTTP and network failures', async () => {
    const { esewa } = setup(jsonResponse({ error_message: 'Service unavailable' }, 503), new TypeError('fetch failed'));
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'esewa responded with HTTP 503: Service unavailable',
    });
    await expect(esewa.verify({ orderId: 'ORD-1', amount: 100 })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it.each([
    ['empty orderId', { orderId: '', amount: 100 }],
    ['unsafe orderId', { orderId: 'ORD&x=1', amount: 100 }],
    ['zero amount', { orderId: 'ORD-1', amount: 0 }],
  ])('rejects %s with INVALID_INPUT before calling eSewa', async (_label, input) => {
    const { esewa, calls } = setup();
    await expect(esewa.verify(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls).toHaveLength(0);
  });
});
