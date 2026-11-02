import Link from 'next/link';
import { notFound } from 'next/navigation';
import { shop } from '@/lib/shop';

export const dynamic = 'force-dynamic';

const headline = { UNPAID: 'Not paid yet', PAID: 'Payment complete', PAID_TWICE: 'Paid twice: refund one payment' };
const gatewayName: Record<string, string> = { esewa: 'eSewa', khalti: 'Khalti' };

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checked?: string }>;
}) {
  const { id } = await params;
  const { checked } = await searchParams;
  const order = shop.getOrder(id);
  if (!order) notFound();

  const last = order.attempts.findLast((a) => a.gateway === checked);
  const again = order.attempts.length > 0 ? ' again' : '';
  return (
    <>
      <h1>{headline[order.status]}</h1>
      <p className={order.status === 'PAID' ? 'ok' : 'bad'}>
        Order <code>{order.id}</code>, Rs {order.amount}: <strong>{order.status}</strong>
      </p>
      {last && (
        <p>
          Checked with {gatewayName[last.gateway]}: {last.status}
        </p>
      )}
      {order.status === 'UNPAID' && (
        <form method="post">
          <button formAction={`/orders/${order.id}/pay/esewa`}>Pay{again} with eSewa</button>{' '}
          <button
            formAction={`/orders/${order.id}/pay/khalti`}
            disabled={!shop.khaltiEnabled}
            title={shop.khaltiEnabled ? undefined : 'Set KHALTI_SECRET_KEY'}
          >
            Pay{again} with Khalti
          </button>
        </form>
      )}
      {order.attempts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Gateway</th>
              <th>Attempt</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {order.attempts.map((a) => (
              <tr key={a.reference}>
                <td>{gatewayName[a.gateway]}</td>
                <td>
                  <code>{a.reference}</code>
                </td>
                <td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href="/">New order</Link>
      </p>
    </>
  );
}
