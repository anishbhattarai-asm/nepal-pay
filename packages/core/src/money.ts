import { PaymentError } from './errors';

export function assertAmount(amount: number, gateway?: string): void {
  const prefix = gateway ? `${gateway}: ` : '';
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError('INVALID_INPUT', `${prefix}amount must be a positive number in rupees`, { gateway });
  }
  const paisa = amount * 100;
  if (Math.abs(paisa - Math.round(paisa)) > 1e-6) {
    throw new PaymentError('INVALID_INPUT', `${prefix}amount can have at most 2 decimal places`, { gateway });
  }
  if (!Number.isSafeInteger(Math.round(paisa))) {
    throw new PaymentError('INVALID_INPUT', `${prefix}amount is too large`, { gateway });
  }
}

/** True for a finite, non-negative rupee amount in whole paisa (at most 2 decimals). */
export function isRupeeAmount(value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  const paisa = value * 100;
  return Math.abs(paisa - Math.round(paisa)) <= 1e-6 && Number.isSafeInteger(Math.round(paisa));
}

export const toPaisa = (rupees: number): number => Math.round(rupees * 100);
export const fromPaisa = (paisa: number): number => paisa / 100;

/** Compare rupee amounts without floating-point surprises. */
export const sameAmount = (a: number, b: number): boolean => toPaisa(a) === toPaisa(b);

/** Rupees as a plain decimal string ("100", "10.5"), the format gateways expect in forms and query strings. */
export const formatRupees = (rupees: number): string => String(toPaisa(rupees) / 100);

/** Reads an amount a gateway sent as a number or a string such as "1,000.0". */
export function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/,/g, '').trim();
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}
