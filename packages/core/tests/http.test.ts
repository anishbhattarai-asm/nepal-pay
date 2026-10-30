import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../src/http';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: Response | Error) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const URL_ = 'https://gateway.test/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('sends a GET with Accept and no body by default', async () => {
    const { fetch, calls } = fakeFetch(json({ ok: true }));
    await expect(requestJson({ gateway: 'g', url: URL_, fetch })).resolves.toEqual({ ok: true });

    const init = calls[0]!.init;
    expect(calls[0]!.url).toBe(URL_);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends a JSON body with Content-Type and custom headers', async () => {
    const { fetch, calls } = fakeFetch(json({ id: 1 }));
    await requestJson({
      gateway: 'g',
      url: URL_,
      method: 'POST',
      headers: { Authorization: 'Key abc' },
      body: { amount: 1000 },
      fetch,
    });

    const init = calls[0]!.init;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"amount":1000}');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Key abc',
    });
  });

  it('returns null for an empty body and raw text for a non-JSON body', async () => {
    await expect(requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(new Response('')).fetch })).resolves.toBeNull();
    await expect(
      requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(new Response('<html>hi</html>')).fetch }),
    ).resolves.toBe('<html>hi</html>');
  });

  it('turns HTTP errors into GATEWAY_ERROR with status, body and a readable reason', async () => {
    const body = { detail: 'Invalid token.', status_code: 401 };
    const promise = requestJson({ gateway: 'khalti', url: URL_, fetch: fakeFetch(json(body, 401)).fetch });
    await expect(promise).rejects.toMatchObject({
      name: 'PaymentError',
      code: 'GATEWAY_ERROR',
      gateway: 'khalti',
      message: 'khalti responded with HTTP 401: Invalid token.',
      details: { status: 401, body },
    });
  });

  it('describes field validation errors', async () => {
    const body = { return_url: ['This field may not be blank.'], amount: ['Too small.'], error_key: 'validation_error' };
    await expect(
      requestJson({ gateway: 'khalti', url: URL_, fetch: fakeFetch(json(body, 400)).fetch }),
    ).rejects.toMatchObject({
      message: 'khalti responded with HTTP 400: return_url: This field may not be blank.; amount: Too small.',
    });
  });

  it('uses eSewa style "message" and plain status when nothing readable is present', async () => {
    await expect(
      requestJson({ gateway: 'esewa', url: URL_, fetch: fakeFetch(json({ code: 'ES104', message: 'Invalid payload signature.' }, 400)).fetch }),
    ).rejects.toMatchObject({ message: 'esewa responded with HTTP 400: Invalid payload signature.' });
    await expect(
      requestJson({ gateway: 'esewa', url: URL_, fetch: fakeFetch(new Response('Bad Gateway', { status: 502 })).fetch }),
    ).rejects.toMatchObject({ message: 'esewa responded with HTTP 502', details: { status: 502, body: 'Bad Gateway' } });
  });

  it('turns fetch failures into NETWORK_ERROR and keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    await expect(requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(cause).fetch })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'g request failed',
      cause,
    });
  });

  it('turns a timeout into TIMEOUT', async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch;

    await expect(requestJson({ gateway: 'g', url: URL_, fetch: hanging, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'g request timed out',
    });
  });

  it('refuses a response that declares more than the size limit', async () => {
    const big = new Response('{}', { headers: { 'Content-Length': '2000000' } });
    await expect(requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(big).fetch })).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      message: 'g response is larger than 1000000 bytes',
    });
  });

  it('stops reading a streamed response once it passes the limit', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(400));
        if (pulled > 50) controller.close();
      },
    });
    const res = new Response(stream);
    await expect(
      requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(res).fetch, maxResponseBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'GATEWAY_ERROR', message: 'g response is larger than 1000 bytes' });
    expect(pulled).toBeLessThan(10);
  });

  it('reads a body that fits the limit exactly', async () => {
    const body = JSON.stringify({ ok: 'x'.repeat(100) });
    await expect(
      requestJson({ gateway: 'g', url: URL_, fetch: fakeFetch(new Response(body)).fetch, maxResponseBytes: body.length }),
    ).resolves.toEqual({ ok: 'x'.repeat(100) });
  });

  it('falls back to globalThis.fetch', async () => {
    const { fetch, calls } = fakeFetch(json({ global: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(requestJson({ gateway: 'g', url: URL_ })).resolves.toEqual({ global: true });
    expect(calls).toHaveLength(1);
  });
});
