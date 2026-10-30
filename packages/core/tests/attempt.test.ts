import { describe, expect, it } from 'vitest';
import { paymentAttemptId } from '../src/attempt';

describe('paymentAttemptId', () => {
  it('is the order id plus 8 random lowercase letters and digits', () => {
    expect(paymentAttemptId('ORD-1001')).toMatch(/^ORD-1001-[a-z0-9]{8}$/);
  });

  it('only uses characters eSewa accepts in transaction_uuid', () => {
    for (let i = 0; i < 200; i++) expect(paymentAttemptId('A_1')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('gives every attempt a new id', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => paymentAttemptId('ORD-1')));
    expect(ids.size).toBe(5000);
  });

  it.each(['', '   ', undefined])('rejects an empty order id (%j)', (orderId) => {
    expect(() => paymentAttemptId(orderId as string)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});
