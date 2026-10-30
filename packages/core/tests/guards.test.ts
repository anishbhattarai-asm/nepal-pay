import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertHttpUrl, assertNonEmpty, assertServerSide, isHttpsUrl, isRecord } from '../src/guards';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertServerSide', () => {
  it('passes on Node', () => {
    expect(() => assertServerSide('esewa')).not.toThrow();
  });

  it('throws BROWSER_ENVIRONMENT when window and document exist', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => assertServerSide('esewa')).toThrow(
      expect.objectContaining({ code: 'BROWSER_ENVIRONMENT', gateway: 'esewa' }),
    );
  });

  it('throws BROWSER_ENVIRONMENT in a browser web or service worker (importScripts)', () => {
    vi.stubGlobal('importScripts', () => undefined);
    expect(() => assertServerSide('khalti')).toThrow(
      expect.objectContaining({ code: 'BROWSER_ENVIRONMENT', gateway: 'khalti' }),
    );
  });

  it('passes when only a window shim exists (server-side rendering)', () => {
    vi.stubGlobal('window', {});
    expect(() => assertServerSide('esewa')).not.toThrow();
  });
});

describe('assertNonEmpty', () => {
  it('accepts a non-empty string', () => {
    expect(() => assertNonEmpty('x', 'f', 'g')).not.toThrow();
  });

  it.each([undefined, null, '', '   ', 42])('rejects %j as INVALID_CONFIG by default', (value) => {
    expect(() => assertNonEmpty(value, 'secretKey', 'esewa')).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG', message: 'esewa: "secretKey" is required' }),
    );
  });

  it('uses the given error code', () => {
    expect(() => assertNonEmpty('', 'orderId', 'esewa', 'INVALID_INPUT')).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });
});

describe('assertHttpUrl', () => {
  it.each(['http://localhost:3000/cb', 'https://shop.example.com/pay?x=1'])('accepts %s', (url) => {
    expect(() => assertHttpUrl(url, 'returnUrl', 'g')).not.toThrow();
  });

  it.each(['/relative/path', 'shop.example.com', 'javascript:alert(1)', 'ftp://x.example', '', 7, undefined])(
    'rejects %j as INVALID_INPUT',
    (url) => {
      expect(() => assertHttpUrl(url, 'returnUrl', 'g')).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT', message: 'g: "returnUrl" must be an absolute http(s) URL' }),
      );
    },
  );

  it('uses the given error code', () => {
    expect(() => assertHttpUrl('nope', 'websiteUrl', 'khalti', 'INVALID_CONFIG')).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' }),
    );
  });

  it('requires https when asked (production)', () => {
    expect(() => assertHttpUrl('https://shop.example/cb', 'returnUrl', 'g', 'INVALID_INPUT', true)).not.toThrow();
    for (const url of ['http://shop.example/cb', 'http://localhost:3000/cb', 'nope']) {
      expect(() => assertHttpUrl(url, 'returnUrl', 'g', 'INVALID_INPUT', true)).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT', message: 'g: "returnUrl" must be an absolute https URL in production' }),
      );
    }
  });
});

describe('isHttpsUrl', () => {
  it('is true only for absolute https URLs', () => {
    expect(isHttpsUrl('https://pay.khalti.com/?pidx=1')).toBe(true);
    expect(isHttpsUrl('http://pay.khalti.com/')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('/relative')).toBe(false);
    expect(isHttpsUrl(42)).toBe(false);
  });
});

describe('isRecord', () => {
  it('is true only for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});
