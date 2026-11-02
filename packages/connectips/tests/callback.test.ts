import { describe, expect, it } from 'vitest';
import { createConnectips } from '../src/client';
import { mockFetch, SANDBOX } from './helpers';

const connectips = createConnectips(SANDBOX);
const claim = { reference: 'txn-123', orderId: 'txn-123', claimedStatus: 'PENDING', signatureValid: null };

describe('connectips.parseCallback', () => {
  it.each([
    ['a query string', 'TXNID=txn-123'],
    ['a full URL', 'http://localhost:3000/connectips/success?TXNID=txn-123'],
    ['URLSearchParams', new URLSearchParams({ TXNID: 'txn-123' })],
    ['req.query', { TXNID: 'txn-123' }],
    ['req.query with a repeated param', { TXNID: ['txn-123', 'txn-999'] }],
    ['a lowercase key', { txnid: 'txn-123' }],
  ])('reads the TXNID from %s and claims nothing', async (_label, input) => {
    await expect(connectips.parseCallback(input)).resolves.toMatchObject(claim);
  });

  it('never calls the network', async () => {
    const { fetch, calls } = mockFetch();
    await createConnectips({ ...SANDBOX, fetch }).parseCallback('TXNID=txn-123');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['no TXNID', {}],
    ['an empty TXNID', 'TXNID='],
    ['a TXNID over 20 characters', { TXNID: 'x'.repeat(21) }],
    ['a TXNID with markup', { TXNID: '<script>' }],
    ['a number', 42],
  ])('rejects %s with INVALID_INPUT', async (_label, input) => {
    await expect(connectips.parseCallback(input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
