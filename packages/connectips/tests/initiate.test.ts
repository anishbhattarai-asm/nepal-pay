import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FormInitiateResult } from '@nepalpay/core';
import { createConnectips } from '../src/client';
import { paymentAttemptId } from '../src';
import { checkoutMessage, type CheckoutFields } from '../src/signing';
import { mockFetch, nodeVerify, SANDBOX } from './helpers';

const base = { amount: 100, orderId: 'ORD-1-abc12345', date: new Date('2026-11-02T08:00:00Z') };

describe('connectips.initiate', () => {
  it('returns a signed form for the UAT login page', async () => {
    const { fetch, calls } = mockFetch();
    const result = await createConnectips({ ...SANDBOX, fetch }).initiate(base);

    expectTypeOf(result).toEqualTypeOf<FormInitiateResult>();
    expect(result.action).toBe('https://uat.connectips.com/connectipswebgw/loginpage');
    expect(result.reference).toBe('ORD-1-abc12345');
    const { TOKEN, ...fields } = result.fields;
    expect(fields).toEqual({
      MERCHANTID: '550',
      APPID: 'MER-550-APP-1',
      APPNAME: 'Test',
      TXNID: 'ORD-1-abc12345',
      TXNDATE: '02-11-2026',
      TXNCRNCY: 'NPR',
      TXNAMT: '10000',
      REFERENCEID: 'ORD-1-abc12345',
      REMARKS: 'Payment',
      PARTICULARS: 'Payment',
    });
    expect(nodeVerify(checkoutMessage(fields as CheckoutFields), TOKEN!)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('writes the date in Nepal time (UTC+05:45)', async () => {
    const connectips = createConnectips(SANDBOX);
    const before = await connectips.initiate({ ...base, date: new Date('2026-11-01T18:14:00Z') }); // 23:59 in Nepal
    const after = await connectips.initiate({ ...base, date: new Date('2026-11-01T18:15:00Z') }); // 00:00 in Nepal
    expect(before.fields.TXNDATE).toBe('01-11-2026');
    expect(after.fields.TXNDATE).toBe('02-11-2026');
  });

  it('sends remarks, particulars and referenceId when given', async () => {
    const result = await createConnectips(SANDBOX).initiate({
      ...base,
      referenceId: 'ORD-1',
      remarks: 'Order ORD-1',
      particulars: 'Two books (Rs 100)',
    });
    expect(result.fields).toMatchObject({ REFERENCEID: 'ORD-1', REMARKS: 'Order ORD-1', PARTICULARS: 'Two books (Rs 100)' });
  });

  it('sends paisa: Rs 10.50 is 1050', async () => {
    const result = await createConnectips(SANDBOX).initiate({ ...base, amount: 10.5 });
    expect(result.fields.TXNAMT).toBe('1050');
  });

  it('uses the production login page in production', async () => {
    const result = await createConnectips({ ...SANDBOX, environment: 'production' }).initiate(base);
    expect(result.action).toBe('https://login.connectips.com/connectipswebgw/loginpage');
  });

  it('accepts a paymentAttemptId shortened to 20 characters', async () => {
    const orderId = paymentAttemptId('ORD-0123456789abcdef', { maxLength: 20 });
    await expect(createConnectips(SANDBOX).initiate({ ...base, orderId })).resolves.toMatchObject({ reference: orderId });
  });

  it.each([
    ['a TXNID over 20 characters', { orderId: 'ORD-0123456789abcdef-x' }],
    ['a TXNID with spaces', { orderId: 'ORD 1' }],
    ['an empty TXNID', { orderId: '' }],
    ['remarks with a comma', { remarks: 'a,b' }],
    ['remarks with "="', { remarks: 'TXNAMT=1' }],
    ['remarks over 50 characters', { remarks: 'x'.repeat(51) }],
    ['particulars over 100 characters', { particulars: 'x'.repeat(101) }],
    ['a referenceId over 20 characters', { referenceId: 'x'.repeat(21) }],
    ['blank remarks', { remarks: ' ' }],
    ['an amount with 3 decimals', { amount: 10.555 }],
    ['a zero amount', { amount: 0 }],
    ['an invalid date', { date: new Date('nope') }],
  ])('rejects %s with INVALID_INPUT', async (_label, change) => {
    await expect(createConnectips(SANDBOX).initiate({ ...base, ...change })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
