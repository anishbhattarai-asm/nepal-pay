// The demo's order and retry logic with fake gateway clients, so no network is needed.
import { beforeEach, describe, expect, it } from 'vitest';
import { createCheckout, parseRupees, type CheckoutOptions } from '@/lib/checkout';

/** Gateways report COMPLETED only for references in this set. */
const completed = new Set<string>();
const gateway = { down: false };
/** Runs inside the fake Khalti initiate(), while the new payment is being created. */
const during: { initiate?: () => Promise<unknown> } = {};
let pidxCount = 0;

const outage = () =>
  Object.assign(new Error('esewa request failed'), { name: 'PaymentError', code: 'NETWORK_ERROR', gateway: 'esewa', retryable: true });

const esewa = {
  async initiate(input: { orderId: string }) {
    return { type: 'form', action: 'https://esewa.test/form', fields: { transaction_uuid: input.orderId }, reference: input.orderId };
  },
  async parseCallback({ data }: { data: string }) {
    return { reference: data, claimedStatus: 'COMPLETED', signatureValid: true, raw: {} };
  },
  async verify({ orderId, amount }: { orderId: string; amount: number }) {
    if (gateway.down) throw outage();
    return { status: completed.has(orderId) ? 'COMPLETED' : 'PENDING', amount, orderId, raw: {} };
  },
};

const khalti = {
  async initiate() {
    await during.initiate?.();
    const pidx = `pidx-${++pidxCount}`;
    return { type: 'redirect', url: `https://khalti.test/${pidx}`, reference: pidx, raw: {} };
  },
  async parseCallback(params: URLSearchParams) {
    return { reference: params.get('pidx'), claimedStatus: 'COMPLETED', signatureValid: null, raw: {} };
  },
  async verify({ pidx, expectedAmount }: { pidx: string; expectedAmount: number }) {
    return { status: completed.has(pidx) ? 'COMPLETED' : 'PENDING', amount: expectedAmount, raw: {} };
  },
};

const open = (options: Partial<CheckoutOptions> = {}) =>
  createCheckout({ esewa: esewa as never, khalti: khalti as never, baseUrl: 'http://shop.test', ...options });

/** Starts an eSewa attempt and returns its reference. */
async function startEsewa(shop: ReturnType<typeof open>, orderId: string) {
  const result = await shop.startPayment(orderId, 'esewa');
  if (result.kind !== 'form') throw new Error(`expected a form, got ${result.kind}`);
  return result.fields.transaction_uuid;
}

beforeEach(() => {
  completed.clear();
  gateway.down = false;
  during.initiate = undefined;
});

describe('parseRupees', () => {
  it('accepts rupees with up to two decimals', () => {
    expect(parseRupees('100')).toBe(100);
    expect(parseRupees(' 99.50 ')).toBe(99.5);
  });

  it('rejects zero, signs, exponents, commas, extra decimals and overflow', () => {
    for (const text of ['0', '-5', '1e3', '1,000', '100.123', '', null, '9'.repeat(30)]) expect(parseRupees(text)).toBeNull();
  });
});

describe('checkout', () => {
  it('marks an order paid only after verify() reports COMPLETED', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const ref = await startEsewa(shop, order.id);

    await shop.esewaReturned(ref); // the redirect claims COMPLETED, the gateway says PENDING
    expect(order.status).toBe('UNPAID');
    expect(order.attempts[0].status).toBe('PENDING');

    completed.add(ref);
    await shop.esewaReturned(ref);
    expect(order).toMatchObject({ status: 'PAID', paidBy: ref });
  });

  it('gives every attempt its own id', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const first = await startEsewa(shop, order.id);
    const second = await startEsewa(shop, order.id);
    expect(first).not.toBe(second);
    expect(first.startsWith(order.id)).toBe(true);
  });

  it('re-verifies earlier attempts and starts no new payment when one completed late', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    completed.add(await startEsewa(shop, order.id));

    const result = await shop.startPayment(order.id, 'khalti');
    expect(result.kind).toBe('settled');
    expect(order.status).toBe('PAID');
    expect(order.attempts).toHaveLength(1);
  });

  it('opens one payment for simultaneous starts', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const kinds = (await Promise.all([shop.startPayment(order.id, 'esewa'), shop.startPayment(order.id, 'esewa')])).map((r) => r.kind);
    expect(kinds.sort()).toEqual(['busy', 'form']);
    expect(order.attempts).toHaveLength(1);
  });

  it('shows the order, not a new payment, when an earlier attempt completes while the new one is created', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const first = await startEsewa(shop, order.id);
    during.initiate = async () => {
      completed.add(first); // the customer finished the first payment after all
      await shop.esewaReturned(first); // and its callback lands mid-start
    };

    const result = await shop.startPayment(order.id, 'khalti');
    expect(result.kind).toBe('settled');
    expect(order).toMatchObject({ status: 'PAID', paidBy: first });
    expect(order.attempts).toHaveLength(2); // the Khalti payment exists but was never shown, so it expires
  });

  it('matches a Khalti return by the stored pidx, never by purchase_order_id', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const started = await shop.startPayment(order.id, 'khalti');
    expect(started.kind).toBe('redirect');

    const forged = new URLSearchParams({ pidx: 'pidx-not-ours', purchase_order_id: order.attempts[0].reference, status: 'Completed' });
    expect(await shop.khaltiReturned(forged)).toBeNull();
    expect(order.status).toBe('UNPAID');
  });

  it('marks an order PAID_TWICE when two attempts complete', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const first = await startEsewa(shop, order.id);
    const second = await startEsewa(shop, order.id);
    completed.add(first).add(second);
    await shop.esewaReturned(first);
    await shop.esewaReturned(second);
    expect(order.status).toBe('PAID_TWICE');
  });

  it('stops at the attempt limit', async () => {
    const shop = open({ maxAttempts: 2 });
    const order = shop.createOrder(100);
    await startEsewa(shop, order.id);
    await startEsewa(shop, order.id);
    expect((await shop.startPayment(order.id, 'esewa')).kind).toBe('limit');
  });

  it('answers unknown for an order it does not have', async () => {
    expect((await open().startPayment('ORD-missing', 'esewa')).kind).toBe('unknown');
  });

  it('leaves the order unchanged during an outage and recovers after it', async () => {
    const shop = open();
    const order = shop.createOrder(100);
    const ref = await startEsewa(shop, order.id);

    gateway.down = true;
    await expect(shop.startPayment(order.id, 'esewa')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(order.status).toBe('UNPAID');
    expect(order.attempts).toHaveLength(1);

    gateway.down = false;
    completed.add(ref);
    expect((await shop.startPayment(order.id, 'esewa')).kind).toBe('settled');
    expect(order.status).toBe('PAID');
  });
});
