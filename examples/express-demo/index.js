import { createEsewa } from '@nepalpay/esewa';
import { createKhalti } from '@nepalpay/khalti';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

// eSewa publishes these UAT credentials for sandbox testing.
const esewa = createEsewa({
  environment: 'sandbox',
  productCode: process.env.ESEWA_PRODUCT_CODE ?? 'EPAYTEST',
  secretKey: process.env.ESEWA_SECRET_KEY ?? '8gBm/:&EnhH.1/q',
});

// Khalti has no shared test key: sign up at test-admin.khalti.com and set KHALTI_SECRET_KEY.
const khaltiKey = process.env.KHALTI_SECRET_KEY;
const khalti = khaltiKey ? createKhalti({ environment: 'sandbox', secretKey: khaltiKey, websiteUrl: baseUrl }) : null;

const { app } = createApp({ esewa, khalti, baseUrl });
app.listen(port, (err) => {
  if (err) {
    console.error(`Could not start the demo on port ${port}: ${err.code ?? err.message}. Is another copy running?`);
    process.exit(1);
  }
  console.log(`nepal-pay demo on ${baseUrl}`);
  console.log(khalti ? 'Khalti: sandbox' : 'Khalti: off (set KHALTI_SECRET_KEY to enable)');
});
