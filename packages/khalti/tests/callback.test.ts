import { describe, expect, it } from 'vitest';
import { createKhalti } from '../src/client';
import { mockFetch, SANDBOX } from './helpers';

/** Sample success callback URL from docs.khalti.com. */
const DOCS_URL =
  'http://example.com/?pidx=bZQLD9wRVWo4CdESSfuSsB&txnId=4H7AhoXDJWg5WjrcPT9ixW&amount=1000&total_amount=1000' +
  '&status=Completed&mobile=98XXXXX904&tidx=4H7AhoXDJWg5WjrcPT9ixW&purchase_order_id=test12' +
  '&purchase_order_name=test&transaction_id=4H7AhoXDJWg5WjrcPT9ixW';

const expected = {
  reference: 'bZQLD9wRVWo4CdESSfuSsB',
  orderId: 'test12',
  transactionId: '4H7AhoXDJWg5WjrcPT9ixW',
  claimedStatus: 'COMPLETED',
  amount: 10,
  signatureValid: null,
};

const khalti = createKhalti(SANDBOX);
const query = Object.fromEntries(new URL(DOCS_URL).searchParams);

describe('khalti.parseCallback', () => {
  it('reads the documented callback from req.query', async () => {
    await expect(khalti.parseCallback(query)).resolves.toEqual({ ...expected, raw: query });
  });

  it.each([
    ['the full URL', DOCS_URL],
    ['a query string', `?${new URL(DOCS_URL).searchParams}`],
    ['a query string without "?"', String(new URL(DOCS_URL).searchParams)],
    ['URLSearchParams', new URL(DOCS_URL).searchParams],
  ])('accepts %s', async (_label, input) => {
    await expect(khalti.parseCallback(input)).resolves.toMatchObject(expected);
  });

  it('takes the first value when a param is repeated', async () => {
    await expect(khalti.parseCallback({ ...query, status: ['Completed', 'Pending'] })).resolves.toMatchObject({
      claimedStatus: 'COMPLETED',
    });
    await expect(khalti.parseCallback(`${String(new URL(DOCS_URL).searchParams)}&pidx=SECOND`)).resolves.toMatchObject({
      reference: 'bZQLD9wRVWo4CdESSfuSsB',
    });
  });

  it('reads a callback captured from a real sandbox payment', async () => {
    // Recorded 2026-10-31 from a Rs 100 sandbox payment; the mobile number is masked.
    const real = {
      pidx: 'kMz6UsMqChP3EjGyBNpi3h',
      transaction_id: 'AhDTwUwX883j3skXnFgTyD',
      tidx: 'AhDTwUwX883j3skXnFgTyD',
      txnId: 'AhDTwUwX883j3skXnFgTyD',
      amount: '10000',
      total_amount: '10000',
      mobile: '98XXXXXXXX',
      status: 'Completed',
      purchase_order_id: 'ORD-262baabd0c9b4215-vsvdjl56',
      purchase_order_name: 'nepal-pay demo order',
    };
    await expect(khalti.parseCallback(real)).resolves.toEqual({
      reference: 'kMz6UsMqChP3EjGyBNpi3h',
      orderId: 'ORD-262baabd0c9b4215-vsvdjl56',
      transactionId: 'AhDTwUwX883j3skXnFgTyD',
      claimedStatus: 'COMPLETED',
      amount: 100,
      signatureValid: null,
      raw: real,
    });
  });

  it('reads a cancelled payment', async () => {
    await expect(
      khalti.parseCallback({ pidx: 'vNTeXkSEaEXK2J4i7cQU6e', status: 'User canceled', purchase_order_id: 'ORD-9' }),
    ).resolves.toEqual({
      reference: 'vNTeXkSEaEXK2J4i7cQU6e',
      orderId: 'ORD-9',
      transactionId: undefined,
      claimedStatus: 'CANCELED',
      amount: undefined,
      signatureValid: null,
      raw: { pidx: 'vNTeXkSEaEXK2J4i7cQU6e', status: 'User canceled', purchase_order_id: 'ORD-9' },
    });
  });

  it('falls back to amount, then tidx / txnId for the transaction id', async () => {
    await expect(khalti.parseCallback({ pidx: 'p', amount: '2500', tidx: 'T1' })).resolves.toMatchObject({
      amount: 25,
      transactionId: 'T1',
    });
    await expect(khalti.parseCallback({ pidx: 'p', amount: 2500, txnId: 'T2' })).resolves.toMatchObject({
      amount: 25,
      transactionId: 'T2',
    });
  });

  it('leaves a non-numeric or fractional paisa amount undefined', async () => {
    await expect(khalti.parseCallback({ pidx: 'p', amount: 'abc' })).resolves.toMatchObject({ amount: undefined });
    await expect(khalti.parseCallback({ pidx: 'p', amount: '1000.5' })).resolves.toMatchObject({ amount: undefined });
  });

  it('never calls the network', async () => {
    const { fetch, calls } = mockFetch();
    await createKhalti({ ...SANDBOX, fetch }).parseCallback(query);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['no pidx', { status: 'Completed' }],
    ['an empty pidx', { pidx: '' }],
    ['an empty query string', ''],
    ['a non-object', 42 as unknown as string],
  ])('rejects %s with INVALID_INPUT', async (_label, input) => {
    await expect(khalti.parseCallback(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
