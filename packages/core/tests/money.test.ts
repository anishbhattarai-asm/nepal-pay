import { describe, expect, it } from 'vitest';
import { assertAmount, formatRupees, fromPaisa, isRupeeAmount, parseAmount, sameAmount, toPaisa } from '../src/money';

describe('money', () => {
  it('converts rupees <-> paisa', () => {
    expect(toPaisa(10.5)).toBe(1050);
    expect(toPaisa(0.1 + 0.2)).toBe(30);
    expect(toPaisa(1234567.89)).toBe(123456789);
    expect(fromPaisa(1050)).toBe(10.5);
    expect(fromPaisa(1)).toBe(0.01);
  });

  it('accepts only whole-paisa rupee amounts in isRupeeAmount()', () => {
    for (const ok of [0, 0.01, 10, 99.5, 100.25, 0.1 + 0.2, 1234567.89]) expect(isRupeeAmount(ok), String(ok)).toBe(true);
    for (const bad of [99.996, 0.001, 10.555, -1, NaN, Infinity, Number.MAX_VALUE]) expect(isRupeeAmount(bad), String(bad)).toBe(false);
  });

  it('compares amounts safely', () => {
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount(100, 100.0)).toBe(true);
    expect(sameAmount(100, 100.01)).toBe(false);
  });

  it('rejects bad amounts', () => {
    expect(() => assertAmount(0)).toThrow();
    expect(() => assertAmount(-5)).toThrow();
    expect(() => assertAmount(10.555)).toThrow();
    expect(() => assertAmount(Number.NaN)).toThrow();
    expect(() => assertAmount(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertAmount('100' as unknown as number)).toThrow();
    expect(() => assertAmount(10.55)).not.toThrow();
    expect(() => assertAmount(0.01)).not.toThrow();
  });

  it('rejects amounts whose paisa value is not a safe integer', () => {
    expect(() => assertAmount(1e12)).not.toThrow();
    expect(() => assertAmount(1e14, 'khalti')).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: 'khalti: amount is too large' }),
    );
  });

  it('reports bad amounts as INVALID_INPUT with the gateway', () => {
    expect(() => assertAmount(-1, 'esewa')).toThrow(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        gateway: 'esewa',
        message: 'esewa: amount must be a positive number in rupees',
      }),
    );
    expect(() => assertAmount(1.001)).toThrow('amount can have at most 2 decimal places');
  });

  it('formats rupees as plain decimal strings', () => {
    expect(formatRupees(100)).toBe('100');
    expect(formatRupees(10.5)).toBe('10.5');
    expect(formatRupees(10.55)).toBe('10.55');
    expect(formatRupees(0.1 + 0.2)).toBe('0.3');
    expect(formatRupees(1000000)).toBe('1000000');
  });

  it('parses amounts sent as numbers or strings', () => {
    expect(parseAmount(1000)).toBe(1000);
    expect(parseAmount('1000.0')).toBe(1000);
    expect(parseAmount('1,000.0')).toBe(1000);
    expect(parseAmount(' 10.5 ')).toBe(10.5);
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount('abc')).toBeUndefined();
    expect(parseAmount(null)).toBeUndefined();
    expect(parseAmount(undefined)).toBeUndefined();
    expect(parseAmount(Number.NaN)).toBeUndefined();
  });
});
