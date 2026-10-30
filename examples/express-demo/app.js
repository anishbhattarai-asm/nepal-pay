import express from 'express';
import { isPaymentError } from '@nepalpay/esewa';

/**
 * Demo checkout for eSewa and Khalti. Orders live in memory; a real app keeps them in its database.
 * A gateway redirect is only a claim: every callback route calls verify() before it changes an order.
 */
export function createApp({ esewa, khalti, baseUrl }) {
  const orders = new Map();
  const app = express();
  // Forms are never compressed; refusing compressed bodies keeps client bytes away from zlib (CVE-2026-111497).
  app.use(express.urlencoded({ extended: false, inflate: false }));

  function createOrder(gateway, amount) {
    const id = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const order = { id, gateway, amount, status: 'CREATED', reference: null, transactionId: null, verifiedAt: null };
    orders.set(id, order);
    return order;
  }

  function settle(order, result) {
    order.status = result.status;
    order.transactionId = result.transactionId ?? null;
    order.verifiedAt = new Date().toISOString();
  }

  app.get('/', (_req, res) => {
    res.send(homePage([...orders.values()].reverse(), Boolean(khalti)));
  });

  // eSewa: initiate returns a signed form that the browser must POST to eSewa.
  app.post('/pay/esewa', async (req, res) => {
    const amount = Number(req.body?.amount);
    const order = createOrder('esewa', amount);
    try {
      const result = await esewa.initiate({
        amount,
        orderId: order.id,
        returnUrl: `${baseUrl}/esewa/callback`,
        failureUrl: `${baseUrl}/esewa/failure/${order.id}`,
      });
      order.reference = result.reference;
      res.send(autoPostForm(result.action, result.fields));
    } catch (err) {
      orders.delete(order.id);
      throw err;
    }
  });

  app.get('/esewa/callback', async (req, res) => {
    const claim = await esewa.parseCallback({ data: firstString(req.query.data) });
    console.log('[esewa] signed callback', claim.raw);
    const order = orders.get(claim.orderId);
    if (!order || order.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown order', `<p>No eSewa order ${escapeHtml(claim.orderId)}.</p>`));
    }
    settle(order, await esewa.verify({ orderId: order.id, amount: order.amount }));
    res.send(resultPage(order, claim.claimedStatus));
  });

  app.get('/esewa/failure/:orderId', async (req, res) => {
    const order = orders.get(req.params.orderId);
    if (!order || order.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown order', '<p>No such eSewa order.</p>'));
    }
    settle(order, await esewa.verify({ orderId: order.id, amount: order.amount }));
    res.send(resultPage(order, null));
  });

  // Khalti: initiate returns a payment_url to redirect the browser to.
  app.post('/pay/khalti', async (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    const amount = Number(req.body?.amount);
    const order = createOrder('khalti', amount);
    try {
      const result = await khalti.initiate({
        amount,
        orderId: order.id,
        returnUrl: `${baseUrl}/khalti/callback`,
        productName: 'nepal-pay demo order',
      });
      order.reference = result.reference;
      res.redirect(303, result.url);
    } catch (err) {
      orders.delete(order.id);
      throw err;
    }
  });

  app.get('/khalti/callback', async (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    const claim = await khalti.parseCallback(req.query);
    console.log('[khalti] callback', claim.raw);
    // The redirect is unsigned: find the order by the pidx stored at initiate, not by purchase_order_id.
    const order = [...orders.values()].find((o) => o.gateway === 'khalti' && o.reference === claim.reference);
    if (!order) {
      return res.status(404).send(page('Unknown order', '<p>No Khalti order matches this callback.</p>'));
    }
    settle(order, await khalti.verify({ pidx: claim.reference, expectedAmount: order.amount }));
    res.send(resultPage(order, claim.claimedStatus));
  });

  app.get('/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json(order);
  });

  app.use((err, _req, res, _next) => {
    if (isPaymentError(err)) {
      const status = { INVALID_INPUT: 400, SIGNATURE_MISMATCH: 400, AMOUNT_MISMATCH: 409 }[err.code] ?? 502;
      console.warn(`[${err.gateway ?? 'payment'}] ${err.code}: ${err.message}`);
      return res
        .status(status)
        .send(page('Payment error', `<p><code>${escapeHtml(err.code)}</code> ${escapeHtml(err.message)}</p>`));
    }
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).send(page('Bad request', `<p>${escapeHtml(err.message)}</p>`));
    }
    console.error(err);
    res.status(500).send(page('Server error', '<p>Something went wrong.</p>'));
  });

  return { app, orders };
}

const firstString = (value) => (Array.isArray(value) ? value[0] : value);

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const khaltiOff = () =>
  page('Khalti not configured', '<p>Set <code>KHALTI_SECRET_KEY</code> (from test-admin.khalti.com) and restart.</p>');

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1f2328; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d0d7de; font-size: 14px; }
  input, button { font: inherit; padding: 8px 12px; }
  .ok { color: #1a7f37; } .bad { color: #cf222e; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

function homePage(orders, khaltiOn) {
  const rows = orders
    .map(
      (o) =>
        `<tr><td><a href="/orders/${escapeHtml(o.id)}">${escapeHtml(o.id)}</a></td><td>${escapeHtml(o.gateway)}</td>` +
        `<td>Rs ${escapeHtml(o.amount)}</td><td>${escapeHtml(o.status)}</td></tr>`,
    )
    .join('');
  return page(
    'nepal-pay demo',
    `<form method="post">
  <label>Amount (Rs) <input name="amount" type="number" min="1" step="0.01" value="100" required></label>
  <p>
    <button formaction="/pay/esewa">Pay with eSewa (sandbox)</button>
    <button formaction="/pay/khalti"${khaltiOn ? '' : ' disabled title="Set KHALTI_SECRET_KEY"'}>Pay with Khalti (sandbox)</button>
  </p>
</form>
<p>eSewa sandbox login: eSewa ID <code>9806800001</code>, password <code>Nepal@123</code>, token <code>123456</code>.</p>
${rows ? `<table><tr><th>Order</th><th>Gateway</th><th>Amount</th><th>Status</th></tr>${rows}</table>` : ''}`,
  );
}

function autoPostForm(action, fields) {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n');
  return page(
    'Redirecting to eSewa',
    `<form id="pay" method="post" action="${escapeHtml(action)}">
${inputs}
<noscript><button>Continue to eSewa</button></noscript>
</form>
<script>document.getElementById('pay').submit();</script>`,
  );
}

function resultPage(order, claimed) {
  const paid = order.status === 'COMPLETED';
  return page(
    paid ? 'Payment complete' : 'Payment not complete',
    `<p class="${paid ? 'ok' : 'bad'}">Verified with ${escapeHtml(order.gateway)}: <strong>${escapeHtml(order.status)}</strong></p>
<table>
  <tr><th>Order</th><td>${escapeHtml(order.id)}</td></tr>
  <tr><th>Amount</th><td>Rs ${escapeHtml(order.amount)}</td></tr>
  <tr><th>Redirect claimed</th><td>${escapeHtml(claimed ?? 'nothing')}</td></tr>
  <tr><th>Transaction id</th><td>${escapeHtml(order.transactionId ?? 'none')}</td></tr>
</table>
<p><a href="/">Back</a></p>`,
  );
}
