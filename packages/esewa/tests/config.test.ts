import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEsewa } from '../src/client';
import { resolveConfig, type EsewaConfig } from '../src/config';
import { UAT } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('esewa config', () => {
  it('resolves sandbox URLs and a 15s default timeout', () => {
    const cfg = resolveConfig({ environment: 'sandbox', ...UAT });
    expect(cfg.urls).toEqual({
      form: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
      status: 'https://rc.esewa.com.np/api/epay/transaction/status/',
    });
    expect(cfg.timeoutMs).toBe(15_000);
  });

  it('resolves production URLs and a custom timeout', () => {
    const cfg = resolveConfig({ environment: 'production', ...UAT, timeoutMs: 5000 });
    expect(cfg.urls).toEqual({
      form: 'https://epay.esewa.com.np/api/epay/main/v2/form',
      status: 'https://epay.esewa.com.np/api/epay/transaction/status/',
    });
    expect(cfg.timeoutMs).toBe(5000);
  });

  it.each([
    ['no config', undefined],
    ['no environment', { ...UAT }],
    ['unknown environment', { environment: 'staging', ...UAT }],
    ['empty productCode', { environment: 'sandbox', productCode: '', secretKey: 'x' }],
    ['blank secretKey', { environment: 'sandbox', productCode: 'EPAYTEST', secretKey: '   ' }],
  ])('rejects %s with INVALID_CONFIG', (_label, config) => {
    expect(() => resolveConfig(config as unknown as EsewaConfig)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG', gateway: 'esewa' }),
    );
  });

  it('refuses to run in a browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => createEsewa({ environment: 'sandbox', ...UAT })).toThrow(
      expect.objectContaining({ code: 'BROWSER_ENVIRONMENT' }),
    );
  });
});
