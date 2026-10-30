import { describe, expect, it } from 'vitest';
import { mapKhaltiStatus } from '../src/mapStatus';

describe('mapKhaltiStatus', () => {
  it.each([
    ['Completed', 'COMPLETED'],
    ['completed', 'COMPLETED'],
    ['Pending', 'PENDING'],
    ['Initiated', 'PENDING'],
    ['Refunded', 'REFUNDED'],
    ['Partially Refunded', 'REFUNDED'],
    ['Partially refunded', 'REFUNDED'],
    ['User canceled', 'CANCELED'],
    ['User cancelled', 'CANCELED'],
    ['  User canceled  ', 'CANCELED'],
  ])('maps "%s" to %s', (input, expected) => {
    expect(mapKhaltiStatus(input)).toBe(expected);
  });

  it('treats Expired, Failed, unknown and missing as FAILED', () => {
    expect(mapKhaltiStatus('Expired')).toBe('FAILED');
    expect(mapKhaltiStatus('Failed')).toBe('FAILED');
    expect(mapKhaltiStatus('Something new')).toBe('FAILED');
    expect(mapKhaltiStatus(undefined)).toBe('FAILED');
  });
});
