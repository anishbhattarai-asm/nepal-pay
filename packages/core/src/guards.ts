import { PaymentError, type PaymentErrorCode } from './errors';

/** Throws BROWSER_ENVIRONMENT in a browser page or worker. Detects misuse; not a security boundary. */
export function assertServerSide(gateway: string): void {
  const g = globalThis as { window?: unknown; document?: unknown; importScripts?: unknown };
  const browserPage = typeof g.window !== 'undefined' && typeof g.document !== 'undefined';
  const browserWorker = typeof g.importScripts === 'function';
  if (browserPage || browserWorker) {
    throw new PaymentError(
      'BROWSER_ENVIRONMENT',
      `${gateway}: never use your secret key in the browser. Run this on your server.`,
      { gateway },
    );
  }
}

export function assertNonEmpty(
  value: unknown,
  field: string,
  gateway: string,
  code: PaymentErrorCode = 'INVALID_CONFIG',
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PaymentError(code, `${gateway}: "${field}" is required`, { gateway });
  }
}

/** Accepts absolute http(s) URLs; only https when `requireHttps` is set (production). */
export function assertHttpUrl(
  value: unknown,
  field: string,
  gateway: string,
  code: PaymentErrorCode = 'INVALID_INPUT',
  requireHttps = false,
): asserts value is string {
  const protocol = urlProtocol(value);
  if (protocol === 'https:' || (protocol === 'http:' && !requireHttps)) return;
  throw new PaymentError(
    code,
    requireHttps
      ? `${gateway}: "${field}" must be an absolute https URL in production`
      : `${gateway}: "${field}" must be an absolute http(s) URL`,
    { gateway },
  );
}

export const isHttpsUrl = (value: unknown): value is string => urlProtocol(value) === 'https:';

function urlProtocol(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
