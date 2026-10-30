import { PaymentError, type PaymentErrorCode } from './errors';

export function assertServerSide(gateway: string): void {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
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

export function assertHttpUrl(
  value: unknown,
  field: string,
  gateway: string,
  code: PaymentErrorCode = 'INVALID_INPUT',
): asserts value is string {
  if (!isHttpUrl(value)) {
    throw new PaymentError(code, `${gateway}: "${field}" must be an absolute http(s) URL`, { gateway });
  }
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
