'use server';

import { redirect } from 'next/navigation';
import { parseRupees } from '@/lib/checkout';
import { shop } from '@/lib/shop';

export async function createOrder(formData: FormData) {
  const amount = parseRupees(formData.get('amount'));
  if (amount === null) redirect('/?invalid=1');
  redirect(`/orders/${shop.createOrder(amount).id}`);
}
