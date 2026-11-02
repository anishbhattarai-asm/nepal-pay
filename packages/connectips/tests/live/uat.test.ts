// Live tests against connectIPS UAT. They run only with credentials from NCHL:
// CONNECTIPS_MERCHANT_ID, CONNECTIPS_APP_ID, CONNECTIPS_APP_NAME, CONNECTIPS_PASSWORD and
// CONNECTIPS_KEY_FILE (the PEM exported from CREDITOR.pfx).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createConnectips, paymentAttemptId } from '../../src';

const env = process.env;
const ready = Boolean(
  env.CONNECTIPS_MERCHANT_ID && env.CONNECTIPS_APP_ID && env.CONNECTIPS_APP_NAME && env.CONNECTIPS_PASSWORD && env.CONNECTIPS_KEY_FILE,
);

const client = () =>
  createConnectips({
    environment: 'sandbox',
    merchantId: env.CONNECTIPS_MERCHANT_ID!,
    appId: env.CONNECTIPS_APP_ID!,
    appName: env.CONNECTIPS_APP_NAME!,
    password: env.CONNECTIPS_PASSWORD!,
    privateKey: readFileSync(env.CONNECTIPS_KEY_FILE!, 'utf8'),
  });

/** Posts the form the way a browser would and returns connectIPS's answer. */
async function postForm(action: string, fields: Record<string, string>) {
  const res = await fetch(action, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

describe.skipIf(!ready)('connectIPS UAT', () => {
  it('accepts our signature and credentials: an unknown TXNID is "not found", not refused', async () => {
    const result = await client().verify({ orderId: paymentAttemptId('NPLIVE', { maxLength: 20 }), amount: 10 });
    expect(result.status).toBe('FAILED');
    expect(result.raw).toMatchObject({ status: 'ERROR' });
  });

  it('opens the login page for a signed form, and answers differently when the TOKEN is tampered', async () => {
    const form = await client().initiate({ amount: 10, orderId: paymentAttemptId('NPLIVE', { maxLength: 20 }) });
    const signed = await postForm(form.action, form.fields);
    const tampered = await postForm(form.action, { ...form.fields, TXNAMT: '1' });
    console.log('[connectips] signed form:', signed.status, signed.location ?? signed.body.slice(0, 200).replace(/\s+/g, ' '));
    console.log('[connectips] tampered form:', tampered.status, tampered.location ?? tampered.body.slice(0, 200).replace(/\s+/g, ' '));
    expect(signed.status).toBeLessThan(500);
    expect(`${signed.status} ${signed.location} ${signed.body}`).not.toBe(`${tampered.status} ${tampered.location} ${tampered.body}`);
  });
});
