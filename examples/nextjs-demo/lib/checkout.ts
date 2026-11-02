import { randomUUID } from 'node:crypto';
import { paymentAttemptId, type EsewaClient } from '@nepalpay/esewa';
import { isPaymentError, type KhaltiClient } from '@nepalpay/khalti';

export type Gateway = 'esewa' | 'khalti';

export interface Attempt {
  orderId: string;
  gateway: Gateway;
  /** eSewa transaction_uuid or Khalti pidx. */
  reference: string;
  status: string;
  transactionId: string | null;
}

export interface Order {
  id: string;
  amount: number;
  status: 'UNPAID' | 'PAID' | 'PAID_TWICE';
  paidBy: string | null;
  attempts: Attempt[];
}

export type StartResult =
  | { kind: 'form'; action: string; fields: Record<string, string> }
  | { kind: 'redirect'; url: string }
  | { kind: 'settled'; order: Order }
  | { kind: 'busy' }
  | { kind: 'limit' }
  | { kind: 'unknown' };

export interface CheckoutOptions {
  esewa: EsewaClient;
  khalti: KhaltiClient | null;
  baseUrl: string;
  maxOrders?: number;
  maxAttempts?: number;
}

/** Rupees with at most two decimals, as a safe number of paisa; null otherwise. */
export function parseRupees(text: unknown): number | null {
  const raw = String(text ?? '').trim();
  const amount = Number(raw);
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
  return amount;
}

/**
 * In-memory checkout: each order has payment attempts with unique ids, earlier attempts are
 * re-verified before a new one starts, and an order is paid only after verify(). A real app keeps
 * the same records in its database.
 */
export function createCheckout({ esewa, khalti, baseUrl, maxOrders = 500, maxAttempts = 10 }: CheckoutOptions) {
  const orders = new Map<string, Order>();
  const attempts = new Map<string, Attempt>();
  const starting = new Set<string>(); // order ids with a payment start in progress

  function createOrder(amount: number): Order {
    const order: Order = { id: `ORD-${randomUUID().replace(/-/g, '').slice(0, 16)}`, amount, status: 'UNPAID', paidBy: null, attempts: [] };
    orders.set(order.id, order);
    // Keep memory bounded: forget the oldest order.
    if (orders.size > maxOrders) {
      const oldest = orders.values().next().value!;
      for (const attempt of oldest.attempts) attempts.delete(attempt.reference);
      orders.delete(oldest.id);
    }
    return order;
  }

  /** Asks the gateway about one attempt and updates its order. */
  async function check(attempt: Attempt): Promise<Order> {
    const order = orders.get(attempt.orderId)!;
    const result =
      attempt.gateway === 'esewa'
        ? await esewa.verify({ orderId: attempt.reference, amount: order.amount })
        : await khalti!.verify({ pidx: attempt.reference, expectedAmount: order.amount });
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
  async function refreshAttempts(order: Order): Promise<void> {
    for (const attempt of order.attempts) {
      if (attempt.status !== 'COMPLETED' && attempt.status !== 'REFUNDED') await check(attempt);
    }
  }

  function addAttempt(order: Order, gateway: Gateway, reference: string): void {
    const attempt: Attempt = { orderId: order.id, gateway, reference, status: 'STARTED', transactionId: null };
    order.attempts.push(attempt);
    attempts.set(reference, attempt);
  }

  /**
   * Starts one payment attempt for an unpaid order. One start runs per order at a time, so a double
   * click or a second tab cannot open two payments; with a database, use a row lock or a conditional
   * update on the order instead.
   */
  async function startPayment(orderId: string, gateway: Gateway): Promise<StartResult> {
    const order = orders.get(orderId);
    if (!order) return { kind: 'unknown' };
    if (starting.has(order.id)) return { kind: 'busy' };
    starting.add(order.id);
    try {
      await refreshAttempts(order);
      if (order.status !== 'UNPAID') return { kind: 'settled', order };
      if (order.attempts.length >= maxAttempts) return { kind: 'limit' };
      const attemptId = paymentAttemptId(order.id);
      if (gateway === 'esewa') {
        const form = await esewa.initiate({
          amount: order.amount,
          orderId: attemptId,
          returnUrl: `${baseUrl}/esewa/callback`,
          failureUrl: `${baseUrl}/esewa/failure/${attemptId}`,
        });
        if (form.type !== 'form') throw new Error('eSewa returned no form');
        addAttempt(order, 'esewa', form.reference);
        return { kind: 'form', action: form.action, fields: form.fields };
      }
      const input = { amount: order.amount, orderId: attemptId, returnUrl: `${baseUrl}/khalti/callback`, productName: 'nepal-pay demo order' };
      const started = await khalti!.initiate(input).catch((err: unknown) => {
        // Khalti may have created a pidx before its reply was lost. That payment URL never reached the
        // customer, so it expires unpaid; the attempt id finds it in Khalti's dashboard.
        if (isPaymentError(err) && err.retryable) console.warn(`[khalti] no reply for attempt ${attemptId}`);
        throw err;
      });
      if (started.type !== 'redirect') throw new Error('Khalti returned no payment URL');
      addAttempt(order, 'khalti', started.reference); // the pidx
      return { kind: 'redirect', url: started.url };
    } finally {
      starting.delete(order.id);
    }
  }

  /** eSewa return: the signed callback names the attempt, then the status API decides. */
  async function esewaReturned(data: string): Promise<Order | null> {
    const claim = await esewa.parseCallback({ data });
    console.log('[esewa] callback', claim.reference, claim.claimedStatus);
    const attempt = attempts.get(claim.reference);
    return attempt?.gateway === 'esewa' ? check(attempt) : null;
  }

  /** eSewa failure page: no data, so the attempt id in the path is checked with eSewa. */
  async function esewaFailed(attemptId: string): Promise<Order | null> {
    const attempt = attempts.get(attemptId);
    return attempt?.gateway === 'esewa' ? check(attempt) : null;
  }

  /** Khalti return: unsigned, so it is matched by the stored pidx, never by purchase_order_id. */
  async function khaltiReturned(params: URLSearchParams): Promise<Order | null> {
    const claim = await khalti!.parseCallback(params);
    console.log('[khalti] callback', claim.reference, claim.claimedStatus); // raw params include the payer's mobile
    const attempt = attempts.get(claim.reference);
    return attempt?.gateway === 'khalti' ? check(attempt) : null;
  }

  return {
    khaltiEnabled: khalti !== null,
    createOrder,
    getOrder: (id: string) => orders.get(id),
    startPayment,
    esewaReturned,
    esewaFailed,
    khaltiReturned,
  };
}

export type Checkout = ReturnType<typeof createCheckout>;
