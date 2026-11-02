import { shop } from '@/lib/shop';
import { htmlPage, paymentErrorResponse, seeOther } from '@/lib/respond';

/** eSewa's failure redirect carries no data, so the attempt named in the path is checked with eSewa. */
export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  try {
    const order = await shop.esewaFailed(attemptId);
    if (!order) return htmlPage(404, 'Unknown payment', '<p>No such eSewa payment.</p>');
    return seeOther(`/orders/${encodeURIComponent(order.id)}?checked=esewa`);
  } catch (err) {
    return paymentErrorResponse(err);
  }
}
