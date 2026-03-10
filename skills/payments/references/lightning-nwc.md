# Lightning BOLT11 over NWC (NIP-47)

The SDK includes a real payment rail using **Lightning BOLT11 invoices** and **Nostr Wallet Connect (NIP-47)**.

PMI: `bitcoin-lightning-bolt11`

Components:

- Server processor: `LnBolt11NwcPaymentProcessor`
- Client handler: `LnBolt11NwcPaymentHandler`

## Configuration

### Server processor

```ts
import { LnBolt11NwcPaymentProcessor } from '@contextvm/sdk/payments';

const processor = new LnBolt11NwcPaymentProcessor({
  nwcConnectionString: process.env.NWC_SERVER_CONNECTION!,
});
```

The server-side NWC wallet must be able to **create invoices** and support the processor’s verification strategy.

### Client handler

```ts
import { LnBolt11NwcPaymentHandler } from '@contextvm/sdk/payments';

const handler = new LnBolt11NwcPaymentHandler({
  nwcConnectionString: process.env.NWC_CLIENT_CONNECTION!,
});
```

The client-side NWC wallet must be able to **pay invoices**.

## Operational notes

- Treat NWC connection strings as secrets.
- Use separate wallets/permissions for server and client roles.
- Tune polling/TTL options on the processor/handler only if required by your wallet/relay setup.

## Troubleshooting checklist

- `payment_required` never arrives: verify the capability is priced and the request matches `method` + `name`.
- Payment fails: verify client wallet permissions and available balance.
- Payment succeeds but `payment_accepted` never arrives: verify server relay connectivity and processor verification.
