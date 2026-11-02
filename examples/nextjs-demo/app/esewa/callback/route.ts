import { shop } from '@/lib/shop';
import { htmlPage, paymentErrorResponse, seeOther } from '@/lib/respond';

/** eSewa's success redirect: ?data= carries a signed claim; the order changes only after verify(). */
export async function GET(request: Request) {
  const data = new URL(request.url).searchParams.get('data') ?? '';
  try {
    const order = await shop.esewaReturned(data);
    if (!order) return htmlPage(404, 'Unknown payment', '<p>No eSewa payment matches this callback.</p>');
    return seeOther(`/orders/${encodeURIComponent(order.id)}?checked=esewa`);
  } catch (err) {
    return paymentErrorResponse(err);
  }
}
