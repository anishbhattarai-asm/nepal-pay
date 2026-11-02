// The route handlers with the real eSewa sandbox client; eSewa's status API is replaced by a stub.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as pay } from '@/app/orders/[id]/pay/[gateway]/route';
import { GET as esewaCallback } from '@/app/esewa/callback/route';
import { shop } from '@/lib/shop';

const SANDBOX_SECRET = '8gBm/:&EnhH.1/q';
const SIGNED = 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names';

const post = (path: string) => new Request(`http://localhost:3000${path}`, { method: 'POST' });
const context = <T>(params: T) => ({ params: Promise.resolve(params) });

/** A success redirect as eSewa sends it: base64 JSON signed over SIGNED. */
function callback(uuid: string, secret = SANDBOX_SECRET) {
  const fields: Record<string, string> = {
    transaction_code: '000TEST',
    status: 'COMPLETE',
    total_amount: '100.0',
    transaction_uuid: uuid,
    product_code: 'EPAYTEST',
    signed_field_names: SIGNED,
  };
  const message = SIGNED.split(',').map((name) => `${name}=${fields[name]}`).join(',');
  const signature = createHmac('sha256', secret).update(message).digest('base64');
  const data = Buffer.from(JSON.stringify({ ...fields, signature })).toString('base64');
  return new Request(`http://localhost:3000/esewa/callback?data=${encodeURIComponent(data)}`);
}

/** Answers eSewa status lookups with `status` for whatever was asked. */
function statusApi(status: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    const q = new URL(url).searchParams;
    const body = { product_code: q.get('product_code'), transaction_uuid: q.get('transaction_uuid'), total_amount: Number(q.get('total_amount')), status, ref_id: status === 'COMPLETE' ? '000TEST' : null };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
}

/** Creates an order and starts an eSewa payment; returns the order and the attempt id. */
async function startEsewa() {
  const order = shop.createOrder(100);
  const res = await pay(post(`/orders/${order.id}/pay/esewa`), context({ id: order.id, gateway: 'esewa' }));
  return { order, res, uuid: order.attempts[0]?.reference };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /orders/[id]/pay/[gateway]', () => {
  it('returns a signed form for the eSewa sandbox', async () => {
    const { res, uuid } = await startEsewa();
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('action="https://rc-epay.esewa.com.np/api/epay/main/v2/form"');
    expect(html).toContain(`name="transaction_uuid" value="${uuid}"`);
    expect(html).toMatch(/name="signature" value="[A-Za-z0-9+/=]{44}"/);
    expect(html).toContain('value="http://localhost:3000/esewa/callback"');
  });

  it('answers 503 for Khalti without a key, 404 for an unknown gateway or order', async () => {
    const order = shop.createOrder(100);
    expect((await pay(post('/'), context({ id: order.id, gateway: 'khalti' }))).status).toBe(503);
    expect((await pay(post('/'), context({ id: order.id, gateway: 'paypal' }))).status).toBe(404);
    expect((await pay(post('/'), context({ id: 'ORD-missing', gateway: 'esewa' }))).status).toBe(404);
  });
});

describe('GET /esewa/callback', () => {
  it('marks the order paid only when the status API says COMPLETE', async () => {
    const { order, uuid } = await startEsewa();

    statusApi('PENDING');
    const pending = await esewaCallback(callback(uuid));
    expect(pending.status).toBe(303);
    expect(pending.headers.get('location')).toBe(`http://localhost:3000/orders/${order.id}?checked=esewa`);
    expect(order.status).toBe('UNPAID');

    statusApi('COMPLETE');
    await esewaCallback(callback(uuid));
    expect(order.status).toBe('PAID');
  });

  it('refuses a callback signed with another key and changes nothing', async () => {
    const { order, uuid } = await startEsewa();
    statusApi('COMPLETE');
    const res = await esewaCallback(callback(uuid, 'not-the-secret'));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('SIGNATURE_MISMATCH');
    expect(order.status).toBe('UNPAID');
  });

  it('answers 404 for a correctly signed callback about an attempt it never started', async () => {
    statusApi('COMPLETE');
    expect((await esewaCallback(callback('ORD-elsewhere-1'))).status).toBe(404);
  });

  it('answers 503 and leaves the order unpaid when the status API is down', async () => {
    const { order, uuid } = await startEsewa();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const res = await esewaCallback(callback(uuid));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('was not marked paid or failed');
    expect(order.status).toBe('UNPAID');
  });
});
