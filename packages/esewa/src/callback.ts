import { isRecord, PaymentError } from '@nepalpay/core';

/** A real callback is about 400 characters; anything this large is not from eSewa. */
const MAX_DATA_LENGTH = 4096;

const invalid = (message: string, cause?: unknown) =>
  new PaymentError('INVALID_INPUT', `esewa: ${message}`, { gateway: 'esewa', cause });

/**
 * Decodes the base64 `data` param eSewa appends to success_url.
 * Every value keeps its exact text: eSewa signs "total_amount=1000.0" but sends 1000.0 as a JSON number,
 * which JSON.parse would turn into 1000 and break the signature.
 */
export function decodeCallbackData(data: unknown): Record<string, string> {
  if (typeof data !== 'string' || data.trim() === '') throw invalid('callback "data" is missing');
  if (data.length > MAX_DATA_LENGTH) throw invalid('callback "data" is too large');

  let json: string;
  try {
    const binary = atob(normalizeBase64(data.trim()));
    json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch (err) {
    throw invalid('callback "data" is not valid base64', err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(quoteBareNumbers(json));
  } catch (err) {
    throw invalid('callback "data" is not valid JSON', err);
  }
  if (!isRecord(parsed)) throw invalid('callback "data" is not a JSON object');

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/** Undo common transport damage: "+" decoded to " " by query parsers, base64url, missing padding. */
function normalizeBase64(value: string): string {
  const std = value.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return std + '='.repeat((4 - (std.length % 4)) % 4);
}

/** Wraps bare JSON numbers in quotes so 1000.0 stays "1000.0". */
function quoteBareNumbers(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += json[i + 1] ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(json.slice(i));
      if (match) {
        out += `"${match[0]}"`;
        i += match[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}
