import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import type { ConnectipsConfig } from '../src/config';

/** A throwaway 2048-bit RSA key in both PEM encodings NCHL certificates export to. */
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const PKCS8_PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const PKCS1_PEM = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
export const EC_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** The sample identifiers from NCHL's documentation. */
export const SANDBOX: ConnectipsConfig = {
  environment: 'sandbox',
  merchantId: 550,
  appId: 'MER-550-APP-1',
  appName: 'Test',
  password: 'uat-password',
  privateKey: PKCS8_PEM,
};

/** Signature from node:crypto, the way existing connectIPS integrations sign. */
export const nodeSign = (message: string) => createSign('RSA-SHA256').update(message).sign(pair.privateKey).toString('base64');

export const nodeVerify = (message: string, signature: string) =>
  createVerify('RSA-SHA256').update(message).verify(pair.publicKey, signature, 'base64');

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
      headers: (init.headers ?? {}) as Record<string, string>,
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
