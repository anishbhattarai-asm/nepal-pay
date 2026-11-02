import { shop } from '@/lib/shop';
import { htmlPage, paymentErrorResponse, seeOther } from '@/lib/respond';

/** Khalti's return redirect is unsigned; the stored pidx finds the attempt and verify() decides. */
export async function GET(request: Request) {
  if (!shop.khaltiEnabled) return htmlPage(503, 'Khalti not configured', '<p>Set <code>KHALTI_SECRET_KEY</code> and restart.</p>');
  try {
    const order = await shop.khaltiReturned(new URL(request.url).searchParams);
    if (!order) return htmlPage(404, 'Unknown payment', '<p>No Khalti payment matches this callback.</p>');
    return seeOther(`/orders/${encodeURIComponent(order.id)}?checked=khalti`);
  } catch (err) {
    return paymentErrorResponse(err);
  }
}
