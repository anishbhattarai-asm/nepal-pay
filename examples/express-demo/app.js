import { randomUUID } from 'node:crypto';
import express from 'express';
import { isPaymentError, paymentAttemptId } from '@nepalpay/esewa';

/**
 * Demo checkout for eSewa and Khalti. Orders live in memory; a real app keeps them in its database.
 *
 * One order can have many payment attempts ("pay again" after a failed or abandoned payment):
 * - every attempt gets its own id, because eSewa rejects a reused transaction_uuid;
 * - before a new attempt, earlier ones are checked with the gateway, so a payment that went
 *   through late is never charged twice;
 * - a callback is matched by its attempt reference (eSewa transaction_uuid, Khalti pidx), and an
 *   order is only marked paid after verify() says COMPLETED.
 */
export function createApp({ esewa, khalti, baseUrl, maxOrders = 500 }) {
  const orders = new Map(); // order id -> order
  const attempts = new Map(); // attempt reference -> attempt
  const app = express();
  // Forms are never compressed; refusing compressed bodies keeps client bytes away from zlib (CVE-2026-111497).
  app.use(express.urlencoded({ extended: false, inflate: false }));

  function createOrder(amount) {
    const order = { id: `ORD-${randomUUID().replace(/-/g, '').slice(0, 16)}`, amount, status: 'UNPAID', paidBy: null, attempts: [] };
    orders.set(order.id, order);
    // Keep memory bounded: forget the oldest order (a real app has a database instead).
    if (orders.size > maxOrders) forgetOrder(orders.keys().next().value);
    return order;
  }

  function forgetOrder(id) {
    for (const attempt of orders.get(id).attempts) attempts.delete(attempt.reference);
    orders.delete(id);
  }

  function addAttempt(order, gateway, reference) {
    const attempt = { orderId: order.id, gateway, reference, status: 'STARTED', transactionId: null };
    order.attempts.push(attempt);
    attempts.set(reference, attempt);
    return attempt;
  }

  /** Asks the gateway about one attempt and updates its order. */
  async function check(attempt) {
    const order = orders.get(attempt.orderId);
    const result =
      attempt.gateway === 'esewa'
        ? await esewa.verify({ orderId: attempt.reference, amount: order.amount })
        : await khalti.verify({ pidx: attempt.reference, expectedAmount: order.amount });
    attempt.status = result.status;
    attempt.transactionId = result.transactionId ?? null;
    if (result.status === 'COMPLETED') {
      if (!order.paidBy) {
        order.paidBy = attempt.reference;
        order.status = 'PAID';
      } else if (order.paidBy !== attempt.reference) {
        order.status = 'PAID_TWICE';
        console.warn(`[order ${order.id}] paid twice (${order.paidBy} and ${attempt.reference}); refund one`);
      }
    }
    return order;
  }

  /** Before charging again, make sure no earlier attempt went through in the meantime. */
  async function refreshAttempts(order) {
    for (const attempt of order.attempts) {
      if (attempt.status !== 'COMPLETED' && attempt.status !== 'REFUNDED') await check(attempt);
    }
  }

  function findOrder(req, res) {
    const order = orders.get(req.params.id);
    if (!order) res.status(404).send(page('Unknown order', '<p>No such order. <a href="/">Start again</a>.</p>'));
    return order;
  }

  app.get('/', (_req, res) => {
    res.send(homePage());
  });

  app.post('/orders', (req, res) => {
    const raw = String(req.body?.amount ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) {
      return res.status(400).send(page('Bad request', '<p><code>INVALID_INPUT</code> Enter an amount in rupees, like 100 or 99.50.</p>'));
    }
    res.redirect(303, `/orders/${createOrder(Number(raw)).id}`);
  });

  app.get('/orders/:id', (req, res) => {
    const order = findOrder(req, res);
    if (order) res.send(orderPage(order, null, Boolean(khalti)));
  });

  /** Minimal status for scripts and tests: no transaction ids. */
  app.get('/orders/:id/status', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json({ id: order.id, status: order.status, attempts: order.attempts.map(({ gateway, status }) => ({ gateway, status })) });
  });

  // eSewa: initiate returns a signed form that the browser must POST to eSewa.
  app.post('/orders/:id/pay/esewa', async (req, res) => {
    const order = findOrder(req, res);
    if (!order) return;
    await refreshAttempts(order);
    if (order.status !== 'UNPAID') return res.redirect(303, `/orders/${order.id}`);

    const attemptId = paymentAttemptId(order.id);
    const result = await esewa.initiate({
      amount: order.amount,
      orderId: attemptId,
      returnUrl: `${baseUrl}/esewa/callback`,
      failureUrl: `${baseUrl}/esewa/failure/${attemptId}`,
    });
    addAttempt(order, 'esewa', result.reference);
    res.send(autoPostForm(result.action, result.fields));
  });

  app.get('/esewa/callback', async (req, res) => {
    const claim = await esewa.parseCallback({ data: firstString(req.query.data) });
    console.log('[esewa] signed callback', claim.raw);
    const attempt = attempts.get(claim.reference);
    if (!attempt || attempt.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown payment', '<p>No eSewa payment matches this callback.</p>'));
    }
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with eSewa: ${attempt.status}`, Boolean(khalti)));
  });

  app.get('/esewa/failure/:attemptId', async (req, res) => {
    const attempt = attempts.get(req.params.attemptId);
    if (!attempt || attempt.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown payment', '<p>No such eSewa payment.</p>'));
    }
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with eSewa: ${attempt.status}`, Boolean(khalti)));
  });

  // Khalti: initiate returns a payment_url to redirect the browser to.
  app.post('/orders/:id/pay/khalti', async (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    const order = findOrder(req, res);
    if (!order) return;
    await refreshAttempts(order);
    if (order.status !== 'UNPAID') return res.redirect(303, `/orders/${order.id}`);

    const result = await khalti.initiate({
      amount: order.amount,
      orderId: paymentAttemptId(order.id),
      returnUrl: `${baseUrl}/khalti/callback`,
      productName: 'nepal-pay demo order',
    });
    addAttempt(order, 'khalti', result.reference); // the pidx
    res.redirect(303, result.url);
  });

  app.get('/khalti/callback', async (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    const claim = await khalti.parseCallback(req.query);
    console.log('[khalti] callback', claim.raw);
    // The redirect is unsigned: match it by the pidx stored at initiate, never by purchase_order_id.
    const attempt = attempts.get(claim.reference);
    if (!attempt || attempt.gateway !== 'khalti') {
      return res.status(404).send(page('Unknown payment', '<p>No Khalti payment matches this callback.</p>'));
    }
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with Khalti: ${attempt.status}`, Boolean(khalti)));
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
  .note { background: #fff8c5; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
</style>
</head>
<body>
<p class="note">Local sandbox demo. Orders live in memory; do not deploy this as is.</p>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

function homePage() {
  return page(
    'nepal-pay demo',
    `<form method="post" action="/orders">
  <label>Amount (Rs) <input name="amount" inputmode="decimal" value="100" required></label>
  <button>Create order</button>
</form>
<p>eSewa sandbox login: eSewa ID <code>9806800001</code>, password <code>Nepal@123</code>, token <code>123456</code>.</p>`,
  );
}

const headline = { UNPAID: 'Not paid yet', PAID: 'Payment complete', PAID_TWICE: 'Paid twice: refund one payment' };

function orderPage(order, notice, khaltiOn) {
  const paid = order.status !== 'UNPAID';
  const again = order.attempts.length > 0 ? ' again' : '';
  const rows = order.attempts
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.gateway)}</td><td><code>${escapeHtml(a.reference)}</code></td><td>${escapeHtml(a.status)}</td></tr>`,
    )
    .join('');
  const pay = paid
    ? ''
    : `<form method="post"><p>
  <button formaction="/orders/${escapeHtml(order.id)}/pay/esewa">Pay${again} with eSewa</button>
  <button formaction="/orders/${escapeHtml(order.id)}/pay/khalti"${khaltiOn ? '' : ' disabled title="Set KHALTI_SECRET_KEY"'}>Pay${again} with Khalti</button>
</p></form>`;
  return page(
    headline[order.status],
    `<p class="${order.status === 'PAID' ? 'ok' : 'bad'}">Order <code>${escapeHtml(order.id)}</code>, Rs ${escapeHtml(order.amount)}: <strong>${escapeHtml(order.status)}</strong></p>
${notice ? `<p>${escapeHtml(notice)}</p>` : ''}
${pay}
${rows ? `<table><tr><th>Gateway</th><th>Attempt</th><th>Status</th></tr>${rows}</table>` : ''}
<p><a href="/">New order</a></p>`,
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
