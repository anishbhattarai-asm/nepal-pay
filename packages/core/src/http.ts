import { PaymentError } from './errors';
import { isRecord } from './guards';
import type { FetchLike } from './types';

export interface RequestOptions {
  gateway: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export async function requestJson<T = unknown>(opts: RequestOptions): Promise<T> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const hasBody = opts.body !== undefined;

  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new PaymentError(
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      timedOut ? `${opts.gateway} request timed out` : `${opts.gateway} request failed`,
      { gateway: opts.gateway, cause: err },
    );
  }

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  if (!res.ok) {
    const reason = describeError(data);
    throw new PaymentError(
      'GATEWAY_ERROR',
      `${opts.gateway} responded with HTTP ${res.status}${reason ? `: ${reason}` : ''}`,
      { gateway: opts.gateway, details: { status: res.status, body: data } },
    );
  }
  return data as T;
}

/** Pulls a readable reason out of common gateway error bodies. */
function describeError(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  for (const key of ['detail', 'message', 'error_message']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  // Field validation errors, e.g. { "return_url": ["This field may not be blank."] }
  const fieldErrors = Object.entries(body)
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((m) => typeof m === 'string'))
    .map(([field, messages]) => `${field}: ${messages.join(' ')}`);
  return fieldErrors.length > 0 ? fieldErrors.join('; ') : undefined;
}
