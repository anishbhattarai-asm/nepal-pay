export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that replays the given responses in order and records each call. */
export function mockFetch(...responses: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error('mockFetch: no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const SANDBOX = {
  environment: 'sandbox',
  secretKey: 'test_secret_key_abc',
  websiteUrl: 'https://shop.example',
} as const;

/** Lookup body in the shape docs.khalti.com shows for every status. */
export const lookupBody = (status: string, extra: Record<string, unknown> = {}) => ({
  pidx: 'HT6o6PEZRWFJ5ygavzHWd5',
  total_amount: 1000,
  status,
  transaction_id: null,
  fee: 0,
  refunded: false,
  ...extra,
});
