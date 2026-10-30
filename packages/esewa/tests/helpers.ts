import { createHmac } from 'node:crypto';

/** eSewa's published UAT credentials. */
export const UAT = { productCode: 'EPAYTEST', secretKey: '8gBm/:&EnhH.1/q' } as const;

export interface FetchCall {
  url: string;
  method: string;
}

/** A fetch that replays the given responses in order and records each call. */
export function mockFetch(...responses: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET' });
    const next = responses.shift();
    if (next === undefined) throw new Error('mockFetch: no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Independent HMAC (node:crypto) to cross-check the Web Crypto implementation. */
export const nodeHmac = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message).digest('base64');

/**
 * Builds the base64 `data` param exactly like eSewa: signs the raw text of each field, then
 * writes the JSON by hand so numbers such as 1000.0 keep their decimal.
 */
export function esewaCallbackData(
  fields: Record<string, { raw: string; json?: 'number' }>,
  secret: string = UAT.secretKey,
): string {
  const signedNames = [...Object.keys(fields), 'signed_field_names'].join(',');
  const message = signedNames
    .split(',')
    .map((name) => `${name}=${name === 'signed_field_names' ? signedNames : fields[name]!.raw}`)
    .join(',');
  const signature = nodeHmac(secret, message);

  const parts = Object.entries(fields).map(([name, f]) =>
    f.json === 'number' ? `"${name}":${f.raw}` : `"${name}":${JSON.stringify(f.raw)}`,
  );
  parts.push(`"signed_field_names":${JSON.stringify(signedNames)}`, `"signature":${JSON.stringify(signature)}`);
  return Buffer.from(`{${parts.join(',')}}`, 'utf8').toString('base64');
}
