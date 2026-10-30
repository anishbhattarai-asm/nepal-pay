// Drives the demo's real routes against the live eSewa sandbox. Run with: npm run test:live
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createEsewa } from '@anishbhattarai/esewa';
import { createApp } from './app.js';

const UAT = { productCode: 'EPAYTEST', secretKey: '8gBm/:&EnhH.1/q' };

let server;
let base;
let orders;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const created = createApp({ esewa: createEsewa({ environment: 'sandbox', ...UAT }), khalti: null, baseUrl: base });
  orders = created.orders;
  server.on('request', created.app);
});

after(() => server.close());

const post = (path, form) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });

const unescapeHtml = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

/** A callback signed with the real UAT key, the way eSewa builds it (total_amount as a JSON number by default). */
function signedCallback({ orderId, status, total, totalAsString = false }) {
  const signed = 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names';
  const message =
    `transaction_code=000TEST,status=${status},total_amount=${total},transaction_uuid=${orderId},` +
    `product_code=EPAYTEST,signed_field_names=${signed}`;
  const signature = createHmac('sha256', UAT.secretKey).update(message).digest('base64');
  const json =
    `{"transaction_code":"000TEST","status":"${status}","total_amount":${totalAsString ? JSON.stringify(total) : total},` +
    `"transaction_uuid":"${orderId}",` +
    `"product_code":"EPAYTEST","signed_field_names":"${signed}","signature":"${signature}"}`;
  return Buffer.from(json).toString('base64');
}

describe('express demo against the eSewa sandbox', { timeout: 60_000 }, () => {
  let orderId;
  let form;

  it('renders the home page', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /nepal-pay demo/);
  });

  it('creates an order and renders an auto-submitting eSewa form', async () => {
    const res = await post('/pay/esewa', { amount: '100' });
    assert.equal(res.status, 200);
    const html = await res.text();
    const action = /<form id="pay" method="post" action="([^"]+)"/.exec(html)?.[1];
    assert.equal(action, 'https://rc-epay.esewa.com.np/api/epay/main/v2/form');
    form = Object.fromEntries(
      [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(([, k, v]) => [k, unescapeHtml(v)]),
    );
    orderId = form.transaction_uuid;
    assert.equal(form.total_amount, '100');
    assert.equal(form.success_url, `${base}/esewa/callback`);
    assert.equal(form.failure_url, `${base}/esewa/failure/${orderId}`);
    assert.equal(orders.get(orderId).status, 'CREATED');
  });

  it('eSewa accepts the form the demo rendered', async () => {
    const res = await fetch('https://rc-epay.esewa.com.np/api/epay/main/v2/form', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    assert.equal(res.status, 302);
  });

  it('a correctly signed COMPLETE callback still does not mark an unpaid order as paid', async () => {
    const data = signedCallback({ orderId, status: 'COMPLETE', total: '100.0' });
    const res = await fetch(`${base}/esewa/callback?data=${encodeURIComponent(data)}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Payment not complete/);
    assert.equal(orders.get(orderId).status, 'PENDING'); // eSewa says the user has not paid yet
  });

  it('rejects a tampered callback with SIGNATURE_MISMATCH', async () => {
    // Amount as a JSON string so re-encoding changes nothing but the status.
    const signed = signedCallback({ orderId, status: 'PENDING', total: '100.0', totalAsString: true });
    const good = JSON.parse(Buffer.from(signed, 'base64').toString());
    const control = await fetch(`${base}/esewa/callback?data=${encodeURIComponent(Buffer.from(JSON.stringify(good)).toString('base64'))}`);
    assert.equal(control.status, 200, 'untampered re-encode must still verify');

    const forged = Buffer.from(JSON.stringify({ ...good, status: 'COMPLETE' })).toString('base64');
    const res = await fetch(`${base}/esewa/callback?data=${encodeURIComponent(forged)}`);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /SIGNATURE_MISMATCH/);
    assert.equal(orders.get(orderId).status, 'PENDING');
  });

  it('rejects a callback with garbage data', async () => {
    const res = await fetch(`${base}/esewa/callback?data=not-base64!!`);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /INVALID_INPUT/);
  });

  it('answers 404 for a signed callback about an unknown order', async () => {
    const data = signedCallback({ orderId: 'ORD-unknown', status: 'COMPLETE', total: '100.0' });
    const res = await fetch(`${base}/esewa/callback?data=${encodeURIComponent(data)}`);
    assert.equal(res.status, 404);
  });

  it('checks the real status on the failure URL', async () => {
    const res = await fetch(`${base}/esewa/failure/${orderId}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Payment not complete/);
    assert.equal(orders.get(orderId).status, 'PENDING');
  });

  it('rejects a bad amount without keeping an order', async () => {
    const before = orders.size;
    for (const amount of ['', 'abc', '-5', '10.555']) {
      const res = await post('/pay/esewa', { amount });
      assert.equal(res.status, 400, `amount ${JSON.stringify(amount)}`);
      assert.match(await res.text(), /INVALID_INPUT/);
    }
    assert.equal(orders.size, before);
  });

  it('turns Khalti off cleanly without a key', async () => {
    assert.equal((await post('/pay/khalti', { amount: '100' })).status, 503);
    assert.equal((await fetch(`${base}/khalti/callback?pidx=x`)).status, 503);
  });

  it('serves orders as JSON', async () => {
    const res = await fetch(`${base}/orders/${orderId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      { id: (await res.json()).id },
      { id: orderId },
    );
    assert.equal((await fetch(`${base}/orders/nope`)).status, 404);
  });
});
