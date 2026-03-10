# Server payments setup

Server payments are implemented as middleware that gates priced requests.

## 1) Define priced capabilities

You price capabilities by `method` + `name` patterns.

```ts
import type { PricedCapability } from '@contextvm/sdk/payments';

const pricedCapabilities: PricedCapability[] = [
  {
    method: 'tools/call',
    name: 'add',
    amount: 10,
    currencyUnit: 'sats',
    description: 'Paid demo tool',
  },
];
```

## 2) Configure processors (PMIs the server can accept)

Processors create `pay_req` and later verify settlement.

Built-in Lightning rail (NWC):

```ts
import { LnBolt11NwcPaymentProcessor, withServerPayments } from '@contextvm/sdk/payments';

const processor = new LnBolt11NwcPaymentProcessor({
  nwcConnectionString: process.env.NWC_SERVER_CONNECTION!,
});

const paidTransport = withServerPayments(baseTransport, {
  processors: [processor],
  pricedCapabilities,
});
```

## 3) Dynamic pricing with `resolvePrice`

Use `resolvePrice` when the final quote depends on request parameters, client identity, tiering, or currency conversion.

```ts
import type { ResolvePriceFn } from '@contextvm/sdk/payments';

const resolvePrice: ResolvePriceFn = async ({ capability, request }) => {
  const requestSize = JSON.stringify(request.params ?? {}).length;
  const extra = Math.ceil(requestSize / 1024);
  return {
    amount: Math.max(1, Math.round(capability.amount + extra)),
    description: `Request size: ${requestSize} bytes`,
    _meta: { requestSize },
  };
};
```

Important: the amount returned by `resolvePrice` must be in the unit expected by the selected processor.

## 4) Rejecting requests without charging

To reject a priced request before issuing an invoice, return `{ reject: true, message? }`.

```ts
import type { ResolvePriceFn } from '@contextvm/sdk/payments';

const resolvePrice: ResolvePriceFn = async ({ capability, clientPubkey }) => {
  const isBlocked = await isUserBlocked(clientPubkey);
  if (isBlocked) return { reject: true, message: 'Access denied' };
  return { amount: capability.amount };
};
```

The server emits `notifications/payment_rejected` correlated to the request, and the request is not forwarded.

## 5) Waiving payment (prepaid / subscription)

To allow a request to proceed without requiring payment (e.g., user has prepaid balance or active subscription), return `{ waive: true }`. Optionally include `meta` for auditing.

```ts
import type { ResolvePriceFn } from '@contextvm/sdk/payments';

const resolvePrice: ResolvePriceFn = async ({ capability, clientPubkey }) => {
  const balance = await getUserBalance(clientPubkey);
  if (balance > capability.amount) {
    return { waive: true, meta: { reason: 'prepaid_balance' } };
  }
  return { amount: capability.amount };
};
```

When payment is waived, the request is forwarded immediately without emitting `payment_required` or `payment_accepted` notifications.
