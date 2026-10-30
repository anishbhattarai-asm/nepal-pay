import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKhalti } from '../src/client';
import { resolveConfig, type KhaltiConfig } from '../src/config';
import { SANDBOX } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('khalti config', () => {
  it('resolves sandbox URLs and a 15s default timeout', () => {
    const cfg = resolveConfig(SANDBOX);
    expect(cfg.urls).toEqual({
      initiate: 'https://dev.khalti.com/api/v2/epayment/initiate/',
      lookup: 'https://dev.khalti.com/api/v2/epayment/lookup/',
    });
    expect(cfg.timeoutMs).toBe(15_000);
  });

  it('resolves production URLs and a custom timeout', () => {
    const cfg = resolveConfig({ ...SANDBOX, environment: 'production', timeoutMs: 3000 });
    expect(cfg.urls).toEqual({
      initiate: 'https://khalti.com/api/v2/epayment/initiate/',
      lookup: 'https://khalti.com/api/v2/epayment/lookup/',
    });
    expect(cfg.timeoutMs).toBe(3000);
  });

  it.each([
    ['no config', undefined],
    ['no environment', { secretKey: 'k', websiteUrl: 'https://shop.example' }],
    ['unknown environment', { ...SANDBOX, environment: 'test' }],
    ['empty secretKey', { ...SANDBOX, secretKey: '' }],
    ['missing websiteUrl', { ...SANDBOX, websiteUrl: undefined }],
    ['relative websiteUrl', { ...SANDBOX, websiteUrl: 'shop.example' }],
  ])('rejects %s with INVALID_CONFIG', (_label, config) => {
    expect(() => resolveConfig(config as unknown as KhaltiConfig)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG', gateway: 'khalti' }),
    );
  });

  it('requires an https websiteUrl in production but allows http in the sandbox', () => {
    expect(() => resolveConfig({ ...SANDBOX, environment: 'production', websiteUrl: 'http://shop.example' })).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: 'khalti: "websiteUrl" must be an absolute https URL in production',
      }),
    );
    expect(resolveConfig({ ...SANDBOX, websiteUrl: 'http://localhost:3000' }).websiteUrl).toBe('http://localhost:3000');
  });

  it('refuses to run in a browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => createKhalti(SANDBOX)).toThrow(expect.objectContaining({ code: 'BROWSER_ENVIRONMENT' }));
  });
});
