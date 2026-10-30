import { describe, expect, it } from 'vitest';
import type { InitiateResult } from '@nepalpay/core';
import { createEsewa, paymentAttemptId } from '../../src';
import { UAT } from '../helpers';

// Talks to the real eSewa sandbox. Run with: npm run test:live
const esewa = createEsewa({ environment: 'sandbox', ...UAT });
const orderId = `live-${Date.now()}`;

function postForm(result: InitiateResult, override: Record<string, string> = {}) {
  if (result.type !== 'form') throw new Error('expected a form result');
  return fetch(result.action, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...result.fields, ...override }),
  });
}

describe('paying again (live)', { timeout: 30_000 }, () => {
  const order = `retry-${Date.now()}`;
  const first = paymentAttemptId(order);

  it('eSewa rejects a reused transaction_uuid, even after an abandoned attempt', async () => {
    const result = await esewa.initiate({ amount: 100, orderId: first, returnUrl: 'https://example.com/ok' });
    expect((await postForm(result)).status).toBe(302);

    const again = await postForm(result);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error_message: 'Duplicate transaction UUID.' });
  });

  it('accepts the retry under a fresh paymentAttemptId', async () => {
    const retry = await esewa.initiate({ amount: 100, orderId: paymentAttemptId(order), returnUrl: 'https://example.com/ok' });
    expect((await postForm(retry)).status).toBe(302);
  });

  it('keeps the abandoned attempt PENDING, so it must be checked before charging again', async () => {
    await expect(esewa.verify({ orderId: first, amount: 100 })).resolves.toMatchObject({ status: 'PENDING' });
  });
});

describe('eSewa sandbox (live)', { timeout: 30_000 }, () => {
  it('accepts our signed form and redirects to the payment page', async () => {
    const result = await esewa.initiate({
      amount: 100,
      orderId,
      returnUrl: 'https://example.com/esewa/ok',
      failureUrl: 'https://example.com/esewa/fail',
    });
    const res = await postForm(result);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('bookingId=');
  });

  it('accepts decimal amounts', async () => {
    const result = await esewa.initiate({ amount: 10.5, orderId: `${orderId}-dec`, returnUrl: 'https://example.com/ok' });
    expect((await postForm(result)).status).toBe(302);
  });

  it('rejects a tampered signature (ES104)', async () => {
    const result = await esewa.initiate({ amount: 100, orderId: `${orderId}-bad`, returnUrl: 'https://example.com/ok' });
    const res = await postForm(result, { total_amount: '1', amount: '1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ES104' });
  });

  it('reports the started order as PENDING', async () => {
    await expect(esewa.verify({ orderId, amount: 100 })).resolves.toMatchObject({
      status: 'PENDING',
      amount: 100,
      orderId,
      transactionId: undefined,
    });
  });

  it('reports the started order as FAILED when asked with the wrong amount', async () => {
    await expect(esewa.verify({ orderId, amount: 1 })).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('reports an unknown order as FAILED', async () => {
    await expect(esewa.verify({ orderId: `${orderId}-never`, amount: 100 })).resolves.toMatchObject({ status: 'FAILED' });
  });
});
