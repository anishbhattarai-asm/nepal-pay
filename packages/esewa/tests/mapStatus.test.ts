import { describe, expect, it } from 'vitest';
import { mapEsewaStatus } from '../src/mapStatus';

describe('mapEsewaStatus', () => {
  it.each([
    ['COMPLETE', 'COMPLETED'],
    ['complete', 'COMPLETED'],
    ['PENDING', 'PENDING'],
    ['AMBIGUOUS', 'PENDING'],
    ['FULL_REFUND', 'REFUNDED'],
    ['PARTIAL_REFUND', 'REFUNDED'],
    ['CANCELED', 'CANCELED'],
    ['CANCELLED', 'CANCELED'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapEsewaStatus(input)).toBe(expected);
  });

  it('treats NOT_FOUND, unknown and missing as FAILED', () => {
    expect(mapEsewaStatus('NOT_FOUND')).toBe('FAILED');
    expect(mapEsewaStatus('WHATEVER')).toBe('FAILED');
    expect(mapEsewaStatus('')).toBe('FAILED');
    expect(mapEsewaStatus(undefined)).toBe('FAILED');
  });
});
