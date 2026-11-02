import { createEsewa } from '@nepalpay/esewa';
import { createKhalti } from '@nepalpay/khalti';
import { createCheckout, type Checkout } from './checkout';

// Not BASE_URL: Vite and Vitest set that to "/".
export const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';

function open(): Checkout {
  // eSewa publishes these UAT credentials for sandbox testing.
  const esewa = createEsewa({
    environment: 'sandbox',
    productCode: process.env.ESEWA_PRODUCT_CODE ?? 'EPAYTEST',
    secretKey: process.env.ESEWA_SECRET_KEY ?? '8gBm/:&EnhH.1/q',
  });
  // Khalti has no shared test key: sign up at test-admin.khalti.com and set KHALTI_SECRET_KEY.
  const key = process.env.KHALTI_SECRET_KEY;
  const khalti = key ? createKhalti({ environment: 'sandbox', secretKey: key, websiteUrl: baseUrl }) : null;
  return createCheckout({ esewa, khalti, baseUrl });
}

// One shop per server process. Dev mode reloads modules, so it lives on globalThis.
const holder = globalThis as typeof globalThis & { nepalPayShop?: Checkout };
export const shop = (holder.nepalPayShop ??= open());
