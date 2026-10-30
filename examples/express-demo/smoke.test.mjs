// Drives the demo's real routes against the live eSewa sandbox. Run with: npm run test:live
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createEsewa } from '@nepalpay/esewa';
import { createApp } from './app.js';

const UAT = { productCode: 'EPAYTEST', secretKey: '8gBm/:&EnhH.1/q' };
const ESEWA_FORM = 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const created = createApp({ esewa: createEsewa({ environment: 'sandbox', ...UAT }), khalti: null, baseUrl: base });
  server.on('request', created.app);
});

after(() => server.close());

const post = (url, form = {}) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });

const unescapeHtml = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

/** Fields of the auto-submitting eSewa form the demo renders. */
const formFields = (html) =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(([, k, v]) => [k, unescapeHtml(v)]),
  );

/** A callback signed with the real UAT key, the way eSewa builds it (total_amount as a JSON number by default). */
function signedCallback({ attemptId, status, total, totalAsString = false }) {
  const signed = 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names';
  const message =
    `transaction_code=000TEST,status=${status},total_amount=${total},transaction_uuid=${attemptId},` +
    `product_code=EPAYTEST,signed_field_names=${signed}`;
  const signature = createHmac('sha256', UAT.secretKey).update(message).digest('base64');
  const json =
    `{"transaction_code":"000TEST","status":"${status}","total_amount":${totalAsString ? JSON.stringify(total) : total},` +
    `"transaction_uuid":"${attemptId}",` +
    `"product_code":"EPAYTEST","signed_field_names":"${signed}","signature":"${signature}"}`;
  return Buffer.from(json).toString('base64');
}

const callback = (data) => fetch(`${base}/esewa/callback?data=${encodeURIComponent(data)}`);
const status = async (orderId) => (await fetch(`${base}/orders/${orderId}/status`)).json();

describe('express demo against the eSewa sandbox', { timeout: 90_000 }, () => {
  let orderId;
  let form;

  it('renders the home page', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /nepal-pay demo/);
  });

  it('creates an order, then a first payment attempt with its own id', async () => {
    const created = await post(`${base}/orders`, { amount: '100' });
    assert.equal(created.status, 303);
    orderId = created.headers.get('location').split('/').pop();

    const res = await post(`${base}/orders/${orderId}/pay/esewa`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(/<form id="pay" method="post" action="([^"]+)"/.exec(html)?.[1], ESEWA_FORM);
    form = formFields(html);
    assert.match(form.transaction_uuid, new RegExp(`^${orderId}-[a-z0-9]{8}$`));
    assert.equal(form.total_amount, '100');
    assert.equal(form.success_url, `${base}/esewa/callback`);
    assert.equal(form.failure_url, `${base}/esewa/failure/${form.transaction_uuid}`);
  });

  it('eSewa accepts the form the demo rendered', async () => {
    assert.equal((await post(ESEWA_FORM, form)).status, 302);
  });

  it('a correctly signed COMPLETE callback still does not mark an unpaid order as paid', async () => {
    const res = await callback(signedCallback({ attemptId: form.transaction_uuid, status: 'COMPLETE', total: '100.0' }));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Not paid yet/);
    const s = await status(orderId);
    assert.equal(s.status, 'UNPAID');
    assert.deepEqual(s.attempts, [{ gateway: 'esewa', status: 'PENDING' }]); // eSewa says the user has not paid
  });

  it('rejects the visible form signature replayed as a COMPLETE callback', async () => {
    const forged = {
      total_amount: form.total_amount,
      transaction_uuid: form.transaction_uuid,
      product_code: form.product_code,
      status: 'COMPLETE',
      signed_field_names: form.signed_field_names,
      signature: form.signature,
    };
    const res = await callback(Buffer.from(JSON.stringify(forged)).toString('base64'));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /SIGNATURE_MISMATCH/);
    assert.equal((await status(orderId)).status, 'UNPAID');
  });

  it('rejects a tampered callback with SIGNATURE_MISMATCH', async () => {
    // Amount as a JSON string so re-encoding changes nothing but the status.
    const signed = signedCallback({ attemptId: form.transaction_uuid, status: 'PENDING', total: '100.0', totalAsString: true });
    const good = JSON.parse(Buffer.from(signed, 'base64').toString());
    const control = await callback(Buffer.from(JSON.stringify(good)).toString('base64'));
    assert.equal(control.status, 200, 'untampered re-encode must still verify');

    const res = await callback(Buffer.from(JSON.stringify({ ...good, status: 'COMPLETE' })).toString('base64'));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /SIGNATURE_MISMATCH/);
  });

  it('rejects a callback with garbage data', async () => {
    const res = await fetch(`${base}/esewa/callback?data=not-base64!!`);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /INVALID_INPUT/);
  });

  it('answers 404 for a signed callback about an unknown attempt', async () => {
    const res = await callback(signedCallback({ attemptId: 'ORD-unknown-12345678', status: 'COMPLETE', total: '100.0' }));
    assert.equal(res.status, 404);
  });

  it('checks the real status on the failure URL', async () => {
    const res = await fetch(`${base}/esewa/failure/${form.transaction_uuid}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Not paid yet/);
  });

  it('pays again under a new id that eSewa accepts, keeping both attempts', async () => {
    const html = await (await post(`${base}/orders/${orderId}/pay/esewa`)).text();
    const retry = formFields(html);
    assert.notEqual(retry.transaction_uuid, form.transaction_uuid);
    assert.match(retry.transaction_uuid, new RegExp(`^${orderId}-[a-z0-9]{8}$`));
    assert.equal((await post(ESEWA_FORM, retry)).status, 302);
    assert.equal((await status(orderId)).attempts.length, 2);
  });

  it('shows why: eSewa refuses the first attempt id a second time', async () => {
    const res = await post(ESEWA_FORM, form);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Duplicate transaction UUID/);
  });
});
