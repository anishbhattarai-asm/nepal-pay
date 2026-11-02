import { describe, expect, it } from 'vitest';
import { createConnectips } from '../src/client';
import { validationMessage } from '../src/signing';
import { jsonResponse, mockFetch, nodeVerify, SANDBOX } from './helpers';

const input = { orderId: 'txn-123', amount: 100 };

/** validatetxn's documented reply, for Rs 100. */
const reply = (status: string, statusDesc: string, extra: Record<string, unknown> = {}) => ({
  merchantId: 550,
  appId: 'MER-550-APP-1',
  referenceId: 'txn-123',
  txnAmt: '10000',
  token: null,
  status,
  statusDesc,
  ...extra,
});

function setup(...responses: Array<Response | Error>) {
  const { fetch, calls } = mockFetch(...responses);
  return { connectips: createConnectips({ ...SANDBOX, fetch }), calls };
}

describe('connectips.verify', () => {
  it('posts a signed validatetxn request with Basic auth', async () => {
    const { connectips, calls } = setup(jsonResponse(reply('SUCCESS', 'TRANSACTION SUCCESSFUL')));
    await connectips.verify(input);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://uat.connectips.com/connectipswebws/api/creditor/validatetxn');
    expect(call!.method).toBe('POST');
    expect(call!.headers.Authorization).toBe(`Basic ${Buffer.from('MER-550-APP-1:uat-password').toString('base64')}`);
    const body = call!.body as Record<string, unknown>;
    expect(body).toMatchObject({ merchantId: 550, appId: 'MER-550-APP-1', referenceId: 'txn-123', txnAmt: 10000 });
    expect(nodeVerify(validationMessage('550', 'MER-550-APP-1', 'txn-123', 10000), body.token as string)).toBe(true);
  });

  it.each([
    ['SUCCESS', 'TRANSACTION SUCCESSFUL', 'COMPLETED'],
    ['FAILED', 'TRANSACTION UNSUCCESSFUL', 'FAILED'],
    ['ERROR', 'TRANSACTION NOT FOUND', 'FAILED'],
    ['ERROR', 'TRANSACTION INCOMPLETE', 'PENDING'],
    ['SOMETHING_NEW', '', 'FAILED'],
  ])('maps %s (%s) to %s', async (status, desc, expected) => {
    const { connectips } = setup(jsonResponse(reply(status, desc)));
    await expect(connectips.verify(input)).resolves.toMatchObject({ status: expected, amount: 100, orderId: 'txn-123' });
  });

  it('accepts an ERROR reply that leaves out the transaction ids', async () => {
    const { connectips } = setup(jsonResponse({ status: 'ERROR', statusDesc: 'TRANSACTION NOT FOUND' }));
    await expect(connectips.verify(input)).resolves.toMatchObject({ status: 'FAILED', amount: 100 });
  });

  it('throws AMOUNT_MISMATCH when a completed payment is for another amount', async () => {
    const { connectips } = setup(jsonResponse(reply('SUCCESS', 'TRANSACTION SUCCESSFUL', { txnAmt: '100' })));
    await expect(connectips.verify(input)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });

  it.each([
    ['another transaction', { referenceId: 'txn-999' }],
    ['another app', { appId: 'MER-551-APP-1' }],
    ['another merchant', { merchantId: 551 }],
    ['no amount on a success', { txnAmt: undefined }],
    ['a fractional paisa amount', { txnAmt: '10000.5' }],
  ])('rejects a reply for %s with GATEWAY_ERROR', async (_label, extra) => {
    const { connectips } = setup(jsonResponse(reply('SUCCESS', 'TRANSACTION SUCCESSFUL', extra)));
    await expect(connectips.verify(input)).rejects.toMatchObject({ code: 'GATEWAY_ERROR' });
  });

  it('rejects a reply without a status', async () => {
    const { connectips } = setup(jsonResponse({ message: 'ok' }));
    await expect(connectips.verify(input)).rejects.toMatchObject({ code: 'GATEWAY_ERROR', message: 'connectips: reply has no status' });
  });

  it('reports refused credentials (HTTP 401) as INVALID_CONFIG, not an outage', async () => {
    const { connectips } = setup(jsonResponse({ error: 'Unauthorized' }, 401));
    await expect(connectips.verify(input)).rejects.toMatchObject({ code: 'INVALID_CONFIG', retryable: false });
  });

  it('marks outages retryable', async () => {
    await expect(setup(jsonResponse({}, 503)).connectips.verify(input)).rejects.toMatchObject({ code: 'GATEWAY_ERROR', retryable: true });
    await expect(setup(new TypeError('fetch failed')).connectips.verify(input)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: true,
    });
  });

  it('checks the input before calling connectIPS', async () => {
    const { connectips, calls } = setup();
    await expect(connectips.verify({ orderId: 'x'.repeat(21), amount: 100 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(connectips.verify({ orderId: 'txn-123', amount: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls).toHaveLength(0);
  });
});

describe('connectips.transactionDetail', () => {
  /** gettxndetail's documented reply, for Rs 10. */
  const detail = (extra: Record<string, unknown> = {}) => ({
    status: 'SUCCESS',
    statusDesc: 'TRANSACTION SUCCESSFUL',
    merchantId: 550,
    appId: 'MER-550-APP-1',
    referenceId: 'txn-123',
    txnAmt: 1000.0,
    token: null,
    debitBankCode: '2501',
    txnId: 12422440,
    batchId: 712095958,
    txnDate: 1670482848997,
    txnCrncy: null,
    chargeAmt: 200.0,
    chargeLiability: 'CG',
    refId: '100',
    remarks: 'test remarks',
    particulars: 'test particular',
    creditStatus: '000',
    ...extra,
  });

  it("returns NCHL's records for a settled payment", async () => {
    const { connectips, calls } = setup(jsonResponse(detail()));
    await expect(connectips.transactionDetail({ orderId: 'txn-123', amount: 10 })).resolves.toMatchObject({
      status: 'COMPLETED',
      amount: 10,
      transactionId: '12422440',
      batchId: '712095958',
      debitBankCode: '2501',
      chargeAmount: 2,
      chargeLiability: 'CG',
      creditStatus: '000',
    });
    expect(calls[0]!.url).toBe('https://uat.connectips.com/connectipswebws/api/creditor/gettxndetail');
  });

  it.each(['000', '999', 'DEFER'])('counts creditStatus %s as settled', async (creditStatus) => {
    const { connectips } = setup(jsonResponse(detail({ creditStatus })));
    await expect(connectips.transactionDetail({ orderId: 'txn-123', amount: 10 })).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('reports a debit whose credit failed as FAILED', async () => {
    const { connectips } = setup(jsonResponse(detail({ creditStatus: '888' })));
    await expect(connectips.transactionDetail({ orderId: 'txn-123', amount: 10 })).resolves.toMatchObject({ status: 'FAILED' });
  });
});
