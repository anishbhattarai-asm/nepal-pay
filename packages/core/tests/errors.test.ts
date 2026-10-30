import { describe, expect, it } from 'vitest';
import { isPaymentError, PaymentError } from '../src/errors';

describe('PaymentError', () => {
  it('carries code, gateway, details and cause', () => {
    const cause = new Error('socket hang up');
    const err = new PaymentError('NETWORK_ERROR', 'esewa request failed', {
      gateway: 'esewa',
      details: { attempt: 1 },
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PaymentError');
    expect(err.message).toBe('esewa request failed');
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.gateway).toBe('esewa');
    expect(err.details).toEqual({ attempt: 1 });
    expect(err.cause).toBe(cause);
  });

  it('works without options', () => {
    const err = new PaymentError('NOT_IMPLEMENTED', 'later');
    expect(err.gateway).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe('isPaymentError', () => {
  it('accepts a PaymentError', () => {
    expect(isPaymentError(new PaymentError('TIMEOUT', 'slow'))).toBe(true);
  });

  it('accepts a PaymentError from another copy of core (duck-typed)', () => {
    const foreign = Object.assign(new Error('x'), { name: 'PaymentError', code: 'GATEWAY_ERROR' });
    expect(isPaymentError(foreign)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isPaymentError(new Error('plain'))).toBe(false);
    expect(isPaymentError({ name: 'PaymentError' })).toBe(false);
    expect(isPaymentError(null)).toBe(false);
    expect(isPaymentError(undefined)).toBe(false);
    expect(isPaymentError('PaymentError')).toBe(false);
  });
});
