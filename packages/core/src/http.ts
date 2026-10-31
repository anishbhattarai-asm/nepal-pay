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
  /** Largest response body to read. Default 1 MB; gateway replies are a few hundred bytes. */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

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
    throw transportError(err, opts.gateway);
  }

  // The body can still time out or break after the headers arrive.
  let text: string;
  try {
    text = await readText(res, opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, opts.gateway);
  } catch (err) {
    throw err instanceof PaymentError ? err : transportError(err, opts.gateway);
  }
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
      {
        gateway: opts.gateway,
        details: { status: res.status, body: data },
        retryable: res.status === 429 || res.status >= 500,
      },
    );
  }
  return data as T;
}

/** Maps a failed request or body read to TIMEOUT or NETWORK_ERROR. */
function transportError(err: unknown, gateway: string): PaymentError {
  const timedOut = err instanceof Error && err.name === 'TimeoutError';
  return new PaymentError(
    timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
    timedOut ? `${gateway} request timed out` : `${gateway} request failed`,
    { gateway, cause: err },
  );
}

/** Reads the body as text, stopping once it passes `limit` bytes. */
async function readText(res: Response, limit: number, gateway: string): Promise<string> {
  const tooLarge = () =>
    new PaymentError('GATEWAY_ERROR', `${gateway} response is larger than ${limit} bytes`, {
      gateway,
      details: { status: res.status },
    });
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!res.body) return '';

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
