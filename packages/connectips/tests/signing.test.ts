import { describe, expect, it } from 'vitest';
import { checkoutMessage, importSigningKey, privateKeyDer, sign, validationMessage } from '../src/signing';
import { EC_PEM, nodeSign, nodeVerify, PKCS1_PEM, PKCS8_PEM } from './helpers';

const PEM_LINE = (label: string) => `${'-'.repeat(5)}${label}${'-'.repeat(5)}`;

describe('token messages', () => {
  it("builds the payment form text exactly as NCHL's example", () => {
    const message = checkoutMessage({
      MERCHANTID: '550',
      APPID: 'MER-550-APP-1',
      APPNAME: 'Test',
      TXNID: 'txn123',
      TXNDATE: '15-03-2022',
      TXNCRNCY: 'NPR',
      TXNAMT: '500',
      REFERENCEID: 'REF-001',
      REMARKS: 'RMKS-001',
      PARTICULARS: 'PART-001',
    });
    expect(message).toBe(
      'MERCHANTID=550,APPID=MER-550-APP-1,APPNAME=Test,TXNID=txn123,TXNDATE=15-03-2022,TXNCRNCY=NPR,TXNAMT=500,REFERENCEID=REF-001,REMARKS=RMKS-001,PARTICULARS=PART-001,TOKEN=TOKEN',
    );
  });

  it("builds the validation text exactly as NCHL's example", () => {
    expect(validationMessage('550', 'MER-550-APP-1', 'txn-123', 500)).toBe(
      'MERCHANTID=550,APPID=MER-550-APP-1,REFERENCEID=txn-123,TXNAMT=500',
    );
  });
});

describe('sign', () => {
  const message = validationMessage('550', 'MER-550-APP-1', 'txn-123', 500);

  it('matches node:crypto RSA-SHA256 byte for byte (one SHA-256, then PKCS#1 v1.5)', async () => {
    const signature = await sign(await importSigningKey(PKCS8_PEM), message);
    expect(signature).toBe(nodeSign(message));
    expect(nodeVerify(message, signature)).toBe(true);
  });

  it('gives the same signature from a PKCS#1 ("RSA PRIVATE KEY") export', async () => {
    expect(PKCS1_PEM).toContain('BEGIN RSA PRIVATE KEY');
    expect(await sign(await importSigningKey(PKCS1_PEM), message)).toBe(nodeSign(message));
  });

  it('accepts Windows line endings in the PEM', async () => {
    expect(await sign(await importSigningKey(PKCS8_PEM.replace(/\n/g, '\r\n')), message)).toBe(nodeSign(message));
  });
});

describe('privateKeyDer', () => {
  it.each([
    ['not PEM', 'hello'],
    ['an encrypted key', `${PEM_LINE('BEGIN ENCRYPTED PRIVATE KEY')}\nMIIB\n${PEM_LINE('END ENCRYPTED PRIVATE KEY')}`],
    [
      'a legacy encrypted key',
      `${PEM_LINE('BEGIN RSA PRIVATE KEY')}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nMIIB\n${PEM_LINE('END RSA PRIVATE KEY')}`,
    ],
    ['a certificate', `${PEM_LINE('BEGIN CERTIFICATE')}\nMIIB\n${PEM_LINE('END CERTIFICATE')}`],
    ['broken base64', `${PEM_LINE('BEGIN PRIVATE KEY')}\n!!!!\n${PEM_LINE('END PRIVATE KEY')}`],
  ])('rejects %s with INVALID_CONFIG', (_label, pem) => {
    expect(() => privateKeyDer(pem)).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG', gateway: 'connectips' }));
  });

  it('rejects a key that is not RSA when it is imported', async () => {
    await expect(importSigningKey(EC_PEM)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: 'connectips: "privateKey" is not an RSA private key',
    });
  });
});
