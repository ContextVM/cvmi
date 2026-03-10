# Client payments setup

Client payments are implemented as middleware around your client transport.

## 1) Configure handlers (PMIs the client can pay)

A `PaymentHandler` executes payment for one PMI.

Built-in Lightning rail (NWC):

```ts
import { LnBolt11NwcPaymentHandler, withClientPayments } from '@contextvm/sdk/payments';

const handler = new LnBolt11NwcPaymentHandler({
  nwcConnectionString: process.env.NWC_CLIENT_CONNECTION!,
});

const paidTransport = withClientPayments(baseTransport, {
  handlers: [handler],
});
```

## 2) PMI advertisement (`pmi` tags)

CEP-8 allows clients to advertise supported PMIs by attaching `pmi` tags to requests.

When you wrap a transport with `withClientPayments(...)`, the SDK injects `pmi` tags derived from your configured handler list (preserving order as preference).

## 3) Multiple handlers

```ts
const paidTransport = withClientPayments(baseTransport, {
  handlers: [lightningHandler /*, futureHandler */],
});
```

The first handler that matches the server-selected PMI is used.

## 4) Handling rejection

If the server rejects without charging, it emits `notifications/payment_rejected` correlated to the request.

Recommended behavior:

- treat it as a hard failure for that request id
- surface the optional `message` to users/operators
