# Lightning BOLT11 via LNbits

The SDK includes a Lightning payment rail using **BOLT11 invoices** backed by the **LNbits REST API**.

PMI: `bitcoin-lightning-bolt11`

Components:

- Server processor: `LnBolt11LnbitsPaymentProcessor`
- Client handler: `LnBolt11LnbitsPaymentHandler`

This rail is an alternative to NWC and is useful when you operate LNbits directly.

## Configuration

### Server processor

```ts
import { LnBolt11LnbitsPaymentProcessor } from '@contextvm/sdk/payments';

const processor = new LnBolt11LnbitsPaymentProcessor({
  lnbitsUrl: process.env.LNBITS_URL!,
  lnbitsApiKey: process.env.LNBITS_INVOICE_KEY!,
  // lnbitsBasicAuth: 'user:password', // optional for proxied instances
});
```

Notes:

- `lnbitsApiKey` must be a key that can create/read invoices for verification.
- If your LNbits instance is behind HTTP Basic Auth, set `lnbitsBasicAuth`.

### Client handler

```ts
import { LnBolt11LnbitsPaymentHandler } from '@contextvm/sdk/payments';

const handler = new LnBolt11LnbitsPaymentHandler({
  lnbitsUrl: process.env.LNBITS_URL!,
  lnbitsAdminKey: process.env.LNBITS_ADMIN_KEY!,
  // lnbitsBasicAuth: 'user:password',
});
```

Notes:

- `lnbitsAdminKey` is required for outgoing payments.

## Operational notes

- Treat LNbits keys as secrets.
- Use separate wallets/permissions for server and client roles.
- If verification or relay propagation is slow, tune TTL/polling on the processor.
