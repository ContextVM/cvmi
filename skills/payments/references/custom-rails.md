# Build your own payment rail (custom PMI)

To add a new settlement method, implement:

- a server-side `PaymentProcessor` (create + verify)
- a client-side `PaymentHandler` (pay)

Both are keyed by a stable PMI string (example: `acme-checkout-v1`).

## Processor skeleton

```ts
import type {
  PaymentProcessor,
  PaymentProcessorCreateParams,
  PaymentProcessorVerifyParams,
} from '@contextvm/sdk/payments';

export class MyRailPaymentProcessor implements PaymentProcessor {
  public readonly pmi = 'my-rail-v1';

  public async createPaymentRequired(
    params: PaymentProcessorCreateParams
  ): Promise<{ amount: number; pay_req: string; description?: string; pmi: string }> {
    return {
      amount: params.amount,
      description: params.description,
      pmi: this.pmi,
      pay_req: JSON.stringify({ invoiceId: '...', requestEventId: params.requestEventId }),
    };
  }

  public async verifyPayment(
    _params: PaymentProcessorVerifyParams
  ): Promise<{ _meta?: Record<string, unknown> }> {
    return { _meta: { verifiedAt: Date.now() } };
  }
}
```

Guidance:

- The processor runs on the server: never embed server secrets in `pay_req`.
- Make verification idempotent per `requestEventId`.

## Handler skeleton

```ts
import type { PaymentHandler, PaymentHandlerRequest } from '@contextvm/sdk/payments';

export class MyRailPaymentHandler implements PaymentHandler {
  public readonly pmi = 'my-rail-v1';

  public async canHandle(_req: PaymentHandlerRequest): Promise<boolean> {
    return true;
  }

  public async handle(req: PaymentHandlerRequest): Promise<void> {
    const decoded = JSON.parse(req.pay_req) as { invoiceId: string };
    await payInvoice(decoded.invoiceId);
  }
}
```

## Wiring

Server:

```ts
withServerPayments(transport, {
  processors: [new MyRailPaymentProcessor()],
  pricedCapabilities,
});
```

Client:

```ts
withClientPayments(baseTransport, {
  handlers: [new MyRailPaymentHandler()],
});
```
