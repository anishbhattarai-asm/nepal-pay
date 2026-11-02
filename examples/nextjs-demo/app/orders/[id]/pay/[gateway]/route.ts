import { shop } from '@/lib/shop';
import { autoPostForm, htmlPage, orderLink, paymentErrorResponse, seeOther } from '@/lib/respond';

/** Starts a payment: eSewa needs a signed form posted by the browser, Khalti a redirect. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; gateway: string }> }) {
  const { id, gateway } = await params;
  if (gateway !== 'esewa' && gateway !== 'khalti') return htmlPage(404, 'Unknown gateway', '<p><a href="/">Start again</a></p>');
  if (gateway === 'khalti' && !shop.khaltiEnabled) {
    return htmlPage(503, 'Khalti not configured', '<p>Set <code>KHALTI_SECRET_KEY</code> (from test-admin.khalti.com) and restart.</p>');
  }
  try {
    const result = await shop.startPayment(id, gateway);
    switch (result.kind) {
      case 'form':
        return autoPostForm(result.action, result.fields);
      case 'redirect':
        return Response.redirect(result.url, 303);
      case 'settled':
        return seeOther(`/orders/${encodeURIComponent(id)}`);
      case 'busy':
        return htmlPage(409, 'Payment already starting', `<p>A payment for this order is starting. ${orderLink(id)}.</p>`);
      case 'limit':
        return htmlPage(429, 'Too many attempts', '<p>This order has reached its limit of payment attempts. <a href="/">New order</a></p>');
      case 'unknown':
        return htmlPage(404, 'Unknown order', '<p>No such order. <a href="/">Start again</a></p>');
    }
  } catch (err) {
    return paymentErrorResponse(err, id);
  }
}
