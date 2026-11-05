// Checks the demo's order and retry logic with fake gateway clients, so no network is needed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { brotliCompressSync } from 'node:zlib';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from './app.js';

/** Gateways report COMPLETED only for references in this set. */
const completed = new Set();

/**
 * Test switches: a slow initiate(); an outage (`down` set to an error code) that fails every gateway
 * call before it reaches the gateway; and `loseReply`, where Khalti creates the payment but its reply
 * is lost on the way back.
 */
const gateway = { initiateDelayMs: 0, down: false, loseReply: false };
const createdPidx = []; // every pidx the fake Khalti created, delivered or not

const outage = (name, code) =>
  Object.assign(new Error(`${name} request failed`), { name: 'PaymentError', code, gateway: name, retryable: true });

function call(name) {
  if (gateway.down) throw outage(name, gateway.down);
}

const fakeEsewa = {
  async initiate(input) {
    await sleep(gateway.initiateDelayMs);
    call('esewa');
    const fields = { transaction_uuid: input.orderId, failure_url: input.failureUrl };
    return { type: 'form', action: 'https://esewa.test/form', fields, reference: input.orderId };
  },
  async parseCallback({ data }) {
    return { reference: data, orderId: data, claimedStatus: 'COMPLETED', signatureValid: true, raw: {} };
  },
  async verify({ orderId, amount }) {
    call('esewa');
    const done = completed.has(orderId);
    return { status: done ? 'COMPLETED' : 'PENDING', amount, orderId, transactionId: done ? `T-${orderId}` : undefined, raw: {} };
  },
};

let pidx = 0;
const fakeKhalti = {
  async initiate() {
    await sleep(gateway.initiateDelayMs);
    call('khalti');
    const reference = `PIDX${++pidx}`;
    createdPidx.push(reference);
    if (gateway.loseReply) throw outage('khalti', 'TIMEOUT');
    return { type: 'redirect', url: `https://pay.khalti.test/?pidx=${reference}`, reference, raw: {} };
  },
  async parseCallback(query) {
    return { reference: query.pidx, orderId: query.purchase_order_id, claimedStatus: 'COMPLETED', signatureValid: null, raw: query };
  },
  async verify({ pidx: ref, expectedAmount }) {
    call('khalti');
    const done = completed.has(ref);
    return { status: done ? 'COMPLETED' : 'PENDING', amount: expectedAmount, transactionId: done ? `K-${ref}` : undefined, raw: {} };
  },
};

let server;
let base;
let orders;

async function start(options) {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const created = createApp({ esewa: fakeEsewa, khalti: fakeKhalti, baseUrl: base, ...options });
  orders = created.orders;
  server.on('request', created.app);
}

const post = (path, form = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });

async function newOrder(amount = '100') {
  const res = await post('/orders', { amount });
  assert.equal(res.status, 303);
  return res.headers.get('location').split('/').pop();
}

async function payEsewa(orderId) {
  const html = await (await post(`/orders/${orderId}/pay/esewa`)).text();
  return /name="transaction_uuid" value="([^"]+)"/.exec(html)?.[1];
}

async function payKhalti(orderId) {
  const res = await post(`/orders/${orderId}/pay/khalti`);
  assert.equal(res.status, 303);
  return new URL(res.headers.get('location')).searchParams.get('pidx');
}

const status = async (orderId) => (await fetch(`${base}/orders/${orderId}/status`)).json();

before(() => start());
after(() => server.close());
beforeEach(() => {
  completed.clear();
  gateway.initiateDelayMs = 0;
  gateway.down = false;
  gateway.loseReply = false;
});

describe('orders and payment attempts', () => {
  it('creates an order with a random id and shows it unpaid', async () => {
    const a = await newOrder();
    const b = await newOrder();
    assert.match(a, /^ORD-[0-9a-f]{16}$/);
    assert.notEqual(a, b);
    const html = await (await fetch(`${base}/orders/${a}`)).text();
    assert.match(html, /Not paid yet/);
    assert.match(html, /Pay with eSewa/);
  });

  it('gives every attempt its own id, and labels the button "Pay again"', async () => {
    const order = await newOrder();
    const first = await payEsewa(order);
    const second = await payEsewa(order);
    assert.match(first, new RegExp(`^${order}-[a-z0-9]{8}$`));
    assert.notEqual(first, second);
    assert.match(await (await fetch(`${base}/orders/${order}`)).text(), /Pay again with eSewa/);
    assert.equal((await status(order)).attempts.length, 2);
  });

  it('marks the order paid only after verify() says COMPLETED', async () => {
    const order = await newOrder();
    const attempt = await payEsewa(order);
    await fetch(`${base}/esewa/callback?data=${attempt}`);
    assert.equal((await status(order)).status, 'UNPAID');

    completed.add(attempt);
    const html = await (await fetch(`${base}/esewa/callback?data=${attempt}`)).text();
    assert.match(html, /Payment complete/);
    assert.equal((await status(order)).status, 'PAID');
  });

  it('does not charge again when an earlier attempt completed late', async () => {
    const order = await newOrder();
    const attempt = await payEsewa(order);
    completed.add(attempt); // the customer finished the first payment after all

    const res = await post(`/orders/${order}/pay/khalti`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/orders/${order}`);
    const s = await status(order);
    assert.equal(s.status, 'PAID');
    assert.equal(s.attempts.length, 1);
  });

  it('shows the order, not a new payment, when an earlier attempt completes while the new one is created', async () => {
    const order = await newOrder();
    const first = await payEsewa(order);
    gateway.initiateDelayMs = 150;
    const starting = post(`/orders/${order}/pay/khalti`);
    await sleep(50); // the start has re-verified the first attempt (still pending) and is waiting on Khalti
    completed.add(first);
    await fetch(`${base}/esewa/callback?data=${first}`); // the late completion lands mid-start

    const res = await starting;
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `/orders/${order}`);
    const s = await status(order);
    assert.equal(s.status, 'PAID');
    assert.equal(s.attempts.length, 2); // the Khalti payment exists but was never shown, so it expires
  });

  it('flags an order paid by two attempts so one can be refunded', async () => {
    const order = await newOrder();
    const esewaAttempt = await payEsewa(order);
    const khaltiAttempt = await payKhalti(order);
    completed.add(esewaAttempt);
    completed.add(khaltiAttempt);

    await fetch(`${base}/esewa/callback?data=${esewaAttempt}`);
    assert.equal((await status(order)).status, 'PAID');
    const html = await (await fetch(`${base}/khalti/callback?pidx=${khaltiAttempt}`)).text();
    assert.match(html, /Paid twice: refund one payment/);
    assert.equal((await status(order)).status, 'PAID_TWICE');
  });

  it('finds a Khalti callback by its stored pidx, ignoring purchase_order_id', async () => {
    const victim = await newOrder();
    const attacker = await newOrder();
    const attackerPidx = await payKhalti(attacker);
    completed.add(attackerPidx);

    await fetch(`${base}/khalti/callback?pidx=${attackerPidx}&purchase_order_id=${victim}`);
    assert.equal((await status(attacker)).status, 'PAID');
    assert.equal((await status(victim)).status, 'UNPAID');
  });

  it('answers 404 for a callback about an unknown attempt', async () => {
    assert.equal((await fetch(`${base}/esewa/callback?data=ORD-nope-12345678`)).status, 404);
    assert.equal((await fetch(`${base}/khalti/callback?pidx=NOPE`)).status, 404);
    assert.equal((await fetch(`${base}/esewa/failure/ORD-nope-12345678`)).status, 404);
  });

  it('shows only order id and statuses in /status, never transaction ids', async () => {
    const order = await newOrder();
    const attempt = await payEsewa(order);
    completed.add(attempt);
    await fetch(`${base}/esewa/callback?data=${attempt}`);
    const s = await status(order);
    assert.deepEqual(Object.keys(s).sort(), ['attempts', 'id', 'status']);
    assert.deepEqual(s.attempts, [{ gateway: 'esewa', status: 'COMPLETED' }]);
    assert.equal((await fetch(`${base}/orders/ORD-unknown/status`)).status, 404);
  });

  it('does not list other orders on the home page', async () => {
    const order = await newOrder();
    assert.ok(!(await (await fetch(base)).text()).includes(order));
  });

  it('rejects bad amounts without creating an order', async () => {
    const before = orders.size;
    for (const amount of ['', 'abc', '-5', '0', '10.555', '1e3', '9'.repeat(400), `1${'0'.repeat(17)}`]) {
      const res = await post('/orders', { amount });
      assert.equal(res.status, 400, `amount ${JSON.stringify(amount)}`);
    }
    assert.equal(orders.size, before);
  });

  it('starts one payment at a time when two requests for an order arrive together', async () => {
    const order = await newOrder();
    gateway.initiateDelayMs = 50;
    const [a, b] = await Promise.all([post(`/orders/${order}/pay/esewa`), post(`/orders/${order}/pay/esewa`)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await status(order)).attempts.length, 1);

    const [c, d] = await Promise.all([post(`/orders/${order}/pay/esewa`), post(`/orders/${order}/pay/khalti`)]);
    assert.equal([c.status, d.status].filter((code) => code === 409).length, 1);
    assert.equal((await status(order)).attempts.length, 2);
  });

  it('answers 503 when Khalti times out before accepting a payment, and the next try works', async () => {
    const order = await newOrder();
    const before = createdPidx.length;
    gateway.down = 'TIMEOUT';
    const res = await post(`/orders/${order}/pay/khalti`);
    assert.equal(res.status, 503);
    const html = await res.text();
    assert.match(html, /not marked paid or failed/);
    assert.match(html, new RegExp(`href="/orders/${order}"`));
    assert.equal(createdPidx.length, before);
    assert.equal((await status(order)).attempts.length, 0);

    gateway.down = false;
    assert.ok(await payKhalti(order));
    assert.equal((await status(order)).attempts.length, 1);
  });

  it('never shows or stores a Khalti payment whose reply was lost, and never pays an order from it', async () => {
    const order = await newOrder();
    gateway.loseReply = true;
    const res = await post(`/orders/${order}/pay/khalti`);
    assert.equal(res.status, 503);
    const lost = createdPidx.at(-1); // created at Khalti, but the reply never arrived
    assert.ok(!(await res.text()).includes(lost));
    assert.deepEqual(await status(order), { id: order, status: 'UNPAID', attempts: [] });

    // The retry is a new payment with a new pidx; the lost one cannot be reached and is never trusted.
    gateway.loseReply = false;
    const retry = await payKhalti(order);
    assert.notEqual(retry, lost);
    completed.add(lost);
    assert.equal((await fetch(`${base}/khalti/callback?pidx=${lost}`)).status, 404);
    assert.equal((await status(order)).status, 'UNPAID');

    completed.add(retry);
    await fetch(`${base}/khalti/callback?pidx=${retry}`);
    assert.deepEqual(await status(order), { id: order, status: 'PAID', attempts: [{ gateway: 'khalti', status: 'COMPLETED' }] });
  });

  it('keeps an order unpaid while verify() fails, then pays it once the gateway answers', async () => {
    const order = await newOrder();
    const attempt = await payEsewa(order);
    completed.add(attempt);

    gateway.down = 'NETWORK_ERROR';
    const res = await fetch(`${base}/esewa/callback?data=${attempt}`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), new RegExp(`href="/orders/${order}"`));
    assert.deepEqual(await status(order), { id: order, status: 'UNPAID', attempts: [{ gateway: 'esewa', status: 'STARTED' }] });

    gateway.down = false;
    await fetch(`${base}/esewa/callback?data=${attempt}`);
    assert.equal((await status(order)).status, 'PAID');
  });

  it('refuses compressed request bodies (415)', async () => {
    const res = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Encoding': 'br' },
      body: brotliCompressSync('amount=100'),
    });
    assert.equal(res.status, 415);
  });
});

describe('limits and configuration', () => {
  it('keeps at most maxOrders in memory, forgetting the oldest', async () => {
    server.close();
    await start({ maxOrders: 3 });
    const ids = [await newOrder(), await newOrder(), await newOrder(), await newOrder()];
    assert.equal(orders.size, 3);
    assert.equal((await fetch(`${base}/orders/${ids[0]}`)).status, 404);
    assert.equal((await fetch(`${base}/orders/${ids[3]}`)).status, 200);
  });

  it('stops at maxAttempts payment attempts per order', async () => {
    server.close();
    await start({ maxAttempts: 2 });
    const order = await newOrder();
    assert.ok(await payEsewa(order));
    assert.ok(await payKhalti(order));
    assert.equal((await post(`/orders/${order}/pay/esewa`)).status, 429);
    assert.equal((await status(order)).attempts.length, 2);
  });

  it('turns Khalti off cleanly without a key', async () => {
    server.close();
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const created = createApp({ esewa: fakeEsewa, khalti: null, baseUrl: base });
    orders = created.orders;
    server.on('request', created.app);

    const order = await newOrder();
    assert.equal((await post(`/orders/${order}/pay/khalti`)).status, 503);
    assert.equal((await fetch(`${base}/khalti/callback?pidx=x`)).status, 503);
  });
});
