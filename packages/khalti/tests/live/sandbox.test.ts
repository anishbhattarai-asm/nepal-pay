import { describe, expect, it } from 'vitest';
import { createKhalti } from '../../src';

// Talks to the real Khalti sandbox. Run with: npm run test:live
// Set KHALTI_SECRET_KEY (from test-admin.khalti.com) to also run the full initiate + lookup flow.
const secretKey = process.env.KHALTI_SECRET_KEY;
const websiteUrl = 'https://example.com';

describe('Khalti sandbox (live)', { timeout: 30_000 }, () => {
  it('rejects a wrong key with 401 Invalid token.', async () => {
    const khalti = createKhalti({ environment: 'sandbox', secretKey: 'not-a-real-key', websiteUrl });
    await expect(
      khalti.initiate({ amount: 10, orderId: `live-${Date.now()}`, returnUrl: 'https://example.com/r' }),
    ).rejects.toMatchObject({ code: 'GATEWAY_ERROR', message: 'khalti responded with HTTP 401: Invalid token.' });
    await expect(khalti.verify({ pidx: 'nope', expectedAmount: 10 })).rejects.toMatchObject({
      code: 'GATEWAY_ERROR',
      details: { status: 401 },
    });
  });

  it.skipIf(!secretKey)('initiates a payment and looks it up as PENDING', async () => {
    const khalti = createKhalti({ environment: 'sandbox', secretKey: secretKey!, websiteUrl });
    const result = await khalti.initiate({
      amount: 10,
      orderId: `live-${Date.now()}`,
      returnUrl: 'https://example.com/khalti/return',
      productName: 'nepal-pay live test',
    });
    if (result.type !== 'redirect') throw new Error('expected a redirect result');
    expect(result.url).toContain(result.reference);

    await expect(khalti.verify({ pidx: result.reference, expectedAmount: 10 })).resolves.toMatchObject({
      status: 'PENDING',
      amount: 10,
    });
  });
});
