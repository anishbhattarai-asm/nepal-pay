import { isPaymentError } from '@nepalpay/esewa';
import { baseUrl } from './shop';

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A small standalone HTML page, for responses that come from route handlers. */
export function htmlPage(status: number, title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; }</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** The signed eSewa form, posted by the browser as soon as it loads. */
export function autoPostForm(action: string, fields: Record<string, string>): Response {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n');
  return htmlPage(
    200,
    'Redirecting to eSewa',
    `<form id="pay" method="post" action="${escapeHtml(action)}">
${inputs}
<noscript><button>Continue to eSewa</button></noscript>
</form>
<script>document.getElementById('pay').submit();</script>`,
  );
}

export const seeOther = (path: string) => Response.redirect(new URL(path, baseUrl), 303);

export const orderLink = (id: string) => `<a href="/orders/${encodeURIComponent(id)}">Back to the order</a>`;

/** Maps an error from a payment step to a response; an outage leaves the order neither paid nor failed. */
export function paymentErrorResponse(err: unknown, orderId?: string): Response {
  if (!isPaymentError(err)) {
    console.error(err);
    return htmlPage(500, 'Server error', '<p>Something went wrong.</p>');
  }
  console.warn(`[${err.gateway ?? 'payment'}] ${err.code}: ${err.message}`);
  if (err.retryable) {
    const next = orderId ? `${orderLink(orderId)} and check it before paying again.` : '<a href="/">Start again</a>.';
    return htmlPage(
      503,
      'Gateway did not answer',
      `<p><code>${escapeHtml(err.code)}</code> The payment gateway did not answer in time, so this step did not finish. The order was not marked paid or failed.</p><p>${next}</p>`,
    );
  }
  const status = ({ INVALID_INPUT: 400, SIGNATURE_MISMATCH: 400, AMOUNT_MISMATCH: 409 } as Record<string, number>)[err.code] ?? 502;
  return htmlPage(status, 'Payment error', `<p><code>${escapeHtml(err.code)}</code> ${escapeHtml(err.message)}</p>`);
}
