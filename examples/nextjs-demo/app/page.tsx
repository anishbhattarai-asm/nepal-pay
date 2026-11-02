import { createOrder } from './actions';

export default async function Home({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  return (
    <>
      <h1>nepal-pay demo</h1>
      <form action={createOrder}>
        <label>
          Amount (Rs) <input name="amount" inputMode="decimal" defaultValue="100" required />
        </label>{' '}
        <button>Create order</button>
      </form>
      {invalid && (
        <p className="bad">
          <code>INVALID_INPUT</code> Enter an amount in rupees, like 100 or 99.50.
        </p>
      )}
      <p>
        eSewa sandbox login: eSewa ID <code>9711111111</code>, MPIN <code>1122</code>.
      </p>
    </>
  );
}
