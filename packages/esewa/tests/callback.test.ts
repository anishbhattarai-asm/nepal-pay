import { describe, expect, it } from 'vitest';
import { decodeCallbackData } from '../src/callback';
import { createEsewa } from '../src/client';
import { verifySignature } from '../src/signing';
import { esewaCallbackData, mockFetch, UAT } from './helpers';

const esewa = createEsewa({ environment: 'sandbox', ...UAT });

/** eSewa's documented success response, byte for byte: total_amount is the JSON number 1000.0. */
const DOCUMENTED_JSON =
  '{"transaction_code":"000AWEO","status":"COMPLETE","total_amount":1000.0,"transaction_uuid":"250610-162413",' +
  '"product_code":"EPAYTEST","signed_field_names":"transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names",' +
  '"signature":"62GcfZTmVkzhtUeh+QJ1AqiJrjoWWGof3U+eTPTZ7fA="}';
const DOCUMENTED_DATA = Buffer.from(DOCUMENTED_JSON).toString('base64');

const completeFields = {
  transaction_code: { raw: '000AWEO' },
  status: { raw: 'COMPLETE' },
  total_amount: { raw: '1000.0', json: 'number' as const },
  transaction_uuid: { raw: 'ORD-1' },
  product_code: { raw: 'EPAYTEST' },
};

describe('esewa.parseCallback', () => {
  it("accepts eSewa's documented success response (1000.0 must not become 1000)", async () => {
    await expect(esewa.parseCallback({ data: DOCUMENTED_DATA })).resolves.toEqual({
      reference: '250610-162413',
      orderId: '250610-162413',
      transactionId: '000AWEO',
      claimedStatus: 'COMPLETED',
      amount: 1000,
      signatureValid: true,
      raw: {
        transaction_code: '000AWEO',
        status: 'COMPLETE',
        total_amount: '1000.0',
        transaction_uuid: '250610-162413',
        product_code: 'EPAYTEST',
        signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
        signature: '62GcfZTmVkzhtUeh+QJ1AqiJrjoWWGof3U+eTPTZ7fA=',
      },
    });
  });

  it('accepts a total sent as a string with a thousands separator', async () => {
    const data = esewaCallbackData({ ...completeFields, total_amount: { raw: '1,000.0' } });
    await expect(esewa.parseCallback({ data })).resolves.toMatchObject({ amount: 1000, signatureValid: true });
  });

  it('never calls the network', async () => {
    const { fetch, calls } = mockFetch();
    await createEsewa({ environment: 'sandbox', ...UAT, fetch }).parseCallback({ data: DOCUMENTED_DATA });
    expect(calls).toHaveLength(0);
  });

  it('survives "+" turned into spaces by a query parser', async () => {
    // ASCII JSON only encodes to "+" around ">" or "~", so add a ">>>" field and pick an
    // order id that puts it on a 3-byte boundary.
    const data = Array.from({ length: 10 }, (_, i) =>
      esewaCallbackData({ ...completeFields, transaction_uuid: { raw: `ORD-${'1'.repeat(i + 1)}` }, note: { raw: '>>>' } }),
    ).find((d) => d.includes('+'));
    expect(data).toBeDefined();
    await expect(esewa.parseCallback({ data: data!.replace(/\+/g, ' ') })).resolves.toMatchObject({
      signatureValid: true,
    });
  });

  describe('forged callbacks', () => {
    // Amount as a JSON string so re-encoding below changes nothing but the tampered field.
    const signedPending = { ...completeFields, status: { raw: 'PENDING' }, total_amount: { raw: '1000.0' } };
    const reencode = (changes: Record<string, string>) => {
      const original = JSON.parse(Buffer.from(esewaCallbackData(signedPending), 'base64').toString('utf8'));
      return Buffer.from(JSON.stringify({ ...original, ...changes })).toString('base64');
    };

    it('control: re-encoding without changes still verifies', async () => {
      await expect(esewa.parseCallback({ data: reencode({}) })).resolves.toMatchObject({ claimedStatus: 'PENDING' });
    });

    it.each([
      ['status changed to COMPLETE', { status: 'COMPLETE' }],
      ['amount lowered', { total_amount: '1.0' }],
      ['order swapped', { transaction_uuid: 'ORD-2' }],
      ['fewer fields signed', { signed_field_names: 'transaction_uuid' }],
    ])('rejects %s with SIGNATURE_MISMATCH', async (_label, changes) => {
      await expect(esewa.parseCallback({ data: reencode(changes) })).rejects.toMatchObject({
        code: 'SIGNATURE_MISMATCH',
      });
    });
  });

  it('rejects a callback signed with another secret', async () => {
    const data = esewaCallbackData(completeFields, 'someone-elses-secret');
    await expect(esewa.parseCallback({ data })).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
  });

  it('maps the claimed status of a signed non-complete callback', async () => {
    const data = esewaCallbackData({ ...completeFields, status: { raw: 'CANCELED' } });
    await expect(esewa.parseCallback({ data })).resolves.toMatchObject({ claimedStatus: 'CANCELED' });
  });

  it.each([
    ['missing data', undefined],
    ['empty data', ''],
    ['non-base64 data', '%%%not-base64%%%'],
    ['base64 of non-JSON', Buffer.from('hello').toString('base64')],
    ['base64 of a JSON array', Buffer.from('[1,2]').toString('base64')],
    ['no signature', Buffer.from('{"transaction_uuid":"ORD-1","signed_field_names":"transaction_uuid"}').toString('base64')],
    ['no signed_field_names', Buffer.from('{"transaction_uuid":"ORD-1","signature":"abc"}').toString('base64')],
    [
      'a signed field that is absent',
      Buffer.from(
        '{"signed_field_names":"status,total_amount,transaction_uuid,product_code","signature":"abc",' +
          '"status":"COMPLETE","transaction_uuid":"X","product_code":"EPAYTEST"}',
      ).toString('base64'),
    ],
  ])('rejects %s with INVALID_INPUT', async (_label, data) => {
    await expect(esewa.parseCallback({ data: data as string })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a validly signed callback with an empty transaction_uuid', async () => {
    const data = esewaCallbackData({ ...completeFields, transaction_uuid: { raw: '' } });
    await expect(esewa.parseCallback({ data })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'esewa: callback has no transaction_uuid',
    });
  });

  describe('signature coverage', () => {
    const encode = (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64');
    // Amount as a JSON string so re-encoding below changes nothing but what each test adds.
    const stringTotal = { ...completeFields, total_amount: { raw: '1000.0' } };
    const values: Record<string, string> = {
      status: 'COMPLETE',
      total_amount: '1000.0',
      transaction_uuid: 'ORD-1',
      product_code: 'EPAYTEST',
    };

    async function signedForm() {
      const form = await esewa.initiate({ amount: 100, orderId: 'ORD-77', returnUrl: 'https://shop.example/cb' });
      if (form.type !== 'form') throw new Error('expected a form result');
      return form.fields;
    }

    it('rejects the initiate form signature reused as a success callback', async () => {
      const f = await signedForm();
      const forged = {
        total_amount: f.total_amount,
        transaction_uuid: f.transaction_uuid,
        product_code: f.product_code,
        status: 'COMPLETE',
        transaction_code: 'FAKE01',
        signed_field_names: f.signed_field_names,
        signature: f.signature,
      };
      await expect(esewa.parseCallback({ data: encode(forged) })).rejects.toMatchObject({
        code: 'SIGNATURE_MISMATCH',
        message: 'esewa: callback signature does not cover status; do not trust it',
      });
    });

    it('rejects the form signature stretched over one field that swallows the rest', async () => {
      const f = await signedForm();
      const forged = {
        total_amount: `${f.total_amount},transaction_uuid=${f.transaction_uuid},product_code=${f.product_code}`,
        transaction_uuid: 'ORD-OTHER',
        product_code: 'EPAYTEST',
        status: 'COMPLETE',
        signed_field_names: 'total_amount',
        signature: f.signature!,
      };
      // Control: the HMAC itself matches, so only the coverage rule stops this.
      expect(await verifySignature(UAT.secretKey, forged, 'total_amount', forged.signature)).toBe(true);
      await expect(esewa.parseCallback({ data: encode(forged) })).rejects.toMatchObject({
        code: 'SIGNATURE_MISMATCH',
        message: 'esewa: callback signature does not cover status, transaction_uuid, product_code; do not trust it',
      });
    });

    it.each(['status', 'total_amount', 'transaction_uuid', 'product_code'])(
      'rejects a valid signature that leaves %s unsigned',
      async (field) => {
        const signed: Record<string, { raw: string; json?: 'number' }> = { ...stringTotal };
        delete signed[field];
        const payload = JSON.parse(Buffer.from(esewaCallbackData(signed), 'base64').toString('utf8'));
        payload[field] = values[field];

        await expect(esewa.parseCallback({ data: encode(payload) })).rejects.toMatchObject({
          code: 'SIGNATURE_MISMATCH',
          message: `esewa: callback signature does not cover ${field}; do not trust it`,
        });
      },
    );

    it('reports transaction_code only when it is signed', async () => {
      const { transaction_code: _omit, ...signed } = stringTotal;
      const payload = JSON.parse(Buffer.from(esewaCallbackData(signed), 'base64').toString('utf8'));
      payload.transaction_code = 'FAKE01';

      await expect(esewa.parseCallback({ data: encode(payload) })).resolves.toMatchObject({
        claimedStatus: 'COMPLETED',
        transactionId: undefined,
        signatureValid: true,
      });
    });
  });
});

describe('decodeCallbackData', () => {
  // ">>>" encodes to "Pj4+" and "???" to "Pz8/", so this payload exercises both special characters.
  const text = '{"a":">>>???","n":-12.50,"e":1e3,"b":true,"z":null,"u":"नमस्ते","q":"say \\"hi\\" 1.0"}';
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const expected = { a: '>>>???', n: '-12.50', e: '1e3', b: 'true', z: 'null', u: 'नमस्ते', q: 'say "hi" 1.0' };

  it('keeps raw number text and decodes UTF-8', () => {
    expect(decodeCallbackData(b64)).toEqual(expected);
  });

  it('accepts "+" decoded to spaces', () => {
    expect(decodeCallbackData(b64.replace(/\+/g, ' '))).toEqual(expected);
  });

  it('accepts base64url without padding', () => {
    const url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(b64).toMatch(/[+/]/);
    expect(decodeCallbackData(url)).toEqual(expected);
  });
});
