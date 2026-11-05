import { randomUUID } from 'node:crypto';
import express from 'express';
import { isPaymentError, paymentAttemptId } from '@nepalpay/esewa';

/**
 * Demo checkout with in-memory orders. Each order has one or more payment attempts with unique ids;
 * earlier attempts are re-verified before a new one starts, and an order is paid only after verify().
 */
export function createApp({ esewa, khalti, baseUrl, maxOrders = 500, maxAttempts = 10 }) {
  const orders = new Map(); // order id -> order
  const attempts = new Map(); // attempt reference -> attempt
  const starting = new Set(); // order ids with a payment start in progress
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

  /** Re-verifies earlier attempts, so a payment that completed late is not charged twice. */
  async function refreshAttempts(order) {
    for (const attempt of order.attempts) {
      if (attempt.status !== 'COMPLETED' && attempt.status !== 'REFUNDED') await check(attempt);
    }
  }

  /**
   * Starts one payment attempt for an unpaid order. One start runs per order at a time, so two
   * simultaneous requests (double click, two tabs) cannot open two payments; a database-backed app
   * gets the same guarantee from a row lock or a conditional update on the order.
   */
  async function startPayment(req, res, begin) {
    const order = findOrder(req, res);
    if (!order) return;
    const back = `<a href="/orders/${escapeHtml(order.id)}">Back to the order</a>`;
    if (starting.has(order.id)) {
      return res.status(409).send(page('Payment already starting', `<p>A payment for this order is starting. ${back}.</p>`));
    }
    starting.add(order.id);
    res.locals.orderId = order.id;
    try {
      await refreshAttempts(order);
      if (order.status !== 'UNPAID') return res.redirect(303, `/orders/${order.id}`);
      if (order.attempts.length >= maxAttempts) {
        const body = `<p>This order has reached ${maxAttempts} payment attempts. <a href="/">New order</a></p>`;
        return res.status(429).send(page('Too many attempts', body));
      }
      await begin(order);
    } finally {
      starting.delete(order.id);
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
    const amount = Number(raw);
    // The pattern alone allows hundreds of digits, so the amount must also be a safe number of paisa.
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      return res.status(400).send(page('Bad request', '<p><code>INVALID_INPUT</code> Enter an amount in rupees, like 100 or 99.50.</p>'));
    }
    res.redirect(303, `/orders/${createOrder(amount).id}`);
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
  app.post('/orders/:id/pay/esewa', (req, res) =>
    startPayment(req, res, async (order) => {
      const attemptId = paymentAttemptId(order.id);
      const result = await esewa.initiate({
        amount: order.amount,
        orderId: attemptId,
        returnUrl: `${baseUrl}/esewa/callback`,
        failureUrl: `${baseUrl}/esewa/failure/${attemptId}`,
      });
      addAttempt(order, 'esewa', result.reference);
      if (order.status !== 'UNPAID') return res.redirect(303, `/orders/${order.id}`); // paid meanwhile, see below
      res.send(autoPostForm(result.action, result.fields));
    }),
  );

  app.get('/esewa/callback', async (req, res) => {
    const claim = await esewa.parseCallback({ data: firstString(req.query.data) });
    console.log('[esewa] callback', claim.reference, claim.claimedStatus);
    const attempt = attempts.get(claim.reference);
    if (!attempt || attempt.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown payment', '<p>No eSewa payment matches this callback.</p>'));
    }
    res.locals.orderId = attempt.orderId;
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with eSewa: ${attempt.status}`, Boolean(khalti)));
  });

  app.get('/esewa/failure/:attemptId', async (req, res) => {
    const attempt = attempts.get(req.params.attemptId);
    if (!attempt || attempt.gateway !== 'esewa') {
      return res.status(404).send(page('Unknown payment', '<p>No such eSewa payment.</p>'));
    }
    res.locals.orderId = attempt.orderId;
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with eSewa: ${attempt.status}`, Boolean(khalti)));
  });

  // Khalti: initiate returns a payment_url to redirect the browser to.
  app.post('/orders/:id/pay/khalti', (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    return startPayment(req, res, async (order) => {
      const attemptId = paymentAttemptId(order.id);
      const input = { amount: order.amount, orderId: attemptId, returnUrl: `${baseUrl}/khalti/callback`, productName: 'nepal-pay demo order' };
      const result = await khalti.initiate(input).catch((err) => {
        // Khalti may have created a pidx before its reply was lost. That payment URL never reached the
        // customer, so it cannot be paid and expires unused; the attempt id finds it in Khalti's dashboard.
        if (isPaymentError(err) && err.retryable) console.warn(`[khalti] no reply for attempt ${attemptId}`);
        throw err;
      });
      addAttempt(order, 'khalti', result.reference); // the pidx
      // A late callback for an earlier attempt can pay the order during this round trip. The new
      // payment is then never shown, so it expires unpaid.
      if (order.status !== 'UNPAID') return res.redirect(303, `/orders/${order.id}`);
      res.redirect(303, result.url);
    });
  });

  app.get('/khalti/callback', async (req, res) => {
    if (!khalti) return res.status(503).send(khaltiOff());
    const claim = await khalti.parseCallback(req.query);
    console.log('[khalti] callback', claim.reference, claim.claimedStatus); // raw params include the payer's mobile
    // Unsigned redirect: matched by the stored pidx, not by purchase_order_id.
    const attempt = attempts.get(claim.reference);
    if (!attempt || attempt.gateway !== 'khalti') {
      return res.status(404).send(page('Unknown payment', '<p>No Khalti payment matches this callback.</p>'));
    }
    res.locals.orderId = attempt.orderId;
    const order = await check(attempt);
    res.send(orderPage(order, `Checked with Khalti: ${attempt.status}`, Boolean(khalti)));
  });

  app.use((err, _req, res, _next) => {
    if (isPaymentError(err)) {
      console.warn(`[${err.gateway ?? 'payment'}] ${err.code}: ${err.message}`);
      // Gateway down or slow: the outcome is unknown, so the order is neither paid nor failed. The order
      // page's "Pay again" re-verifies earlier attempts before starting a new one.
      if (err.retryable) {
        const id = res.locals.orderId;
        const next = id ? `<a href="/orders/${escapeHtml(id)}">Check the order</a> before paying again.` : '<a href="/">Start again</a>';
        const body = `<p><code>${escapeHtml(err.code)}</code> The payment gateway did not answer in time, so this step did not finish. The order was not marked paid or failed.</p><p>${next}</p>`;
        return res.status(503).send(page('Gateway did not answer', body));
      }
      const status = { INVALID_INPUT: 400, SIGNATURE_MISMATCH: 400, AMOUNT_MISMATCH: 409 }[err.code] ?? 502;
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
<p>eSewa sandbox login: eSewa ID <code>9711111111</code>, MPIN <code>1122</code>.</p>`,
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
