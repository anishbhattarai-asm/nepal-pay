import { afterEach, describe, expect, it } from 'vitest';
import { createConnectips } from '../src/client';
import { PKCS1_PEM, SANDBOX } from './helpers';

describe('createConnectips', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('accepts the merchant id as a number or a string, and a PKCS#1 key', () => {
    expect(() => createConnectips(SANDBOX)).not.toThrow();
    expect(() => createConnectips({ ...SANDBOX, merchantId: '550', privateKey: PKCS1_PEM })).not.toThrow();
  });

  it.each([
    ['no environment', { environment: undefined }],
    ['a non-numeric merchantId', { merchantId: 'MER-550' }],
    ['an empty appId', { appId: '' }],
    ['an appId over 15 characters', { appId: 'x'.repeat(16) }],
    ['an appName over 30 characters', { appName: 'x'.repeat(31) }],
    ['an appName with a comma', { appName: 'Shop, Inc' }],
    ['no password', { password: '' }],
    ['no private key', { privateKey: '' }],
    ['a private key that is not PEM', { privateKey: 'C:\\keys\\CREDITOR.pfx' }],
  ])('rejects %s with INVALID_CONFIG at startup', (_label, change) => {
    expect(() => createConnectips({ ...SANDBOX, ...change } as never)).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('refuses to start in a browser page', () => {
    Object.assign(globalThis, { window: {}, document: {} });
    expect(() => createConnectips(SANDBOX)).toThrow(expect.objectContaining({ code: 'BROWSER_ENVIRONMENT' }));
  });
});
