# Payments overview (CEP-8)

This page summarizes the CEP-8 model implemented by the TypeScript SDK payments layer.

## The CEP-8 contract (high level)

- A server marks specific capabilities as priced.
- When a client calls a priced capability, the server emits `notifications/payment_required`.
- The client pays the opaque `pay_req` via a PMI-matched handler.
- The server verifies settlement and emits `notifications/payment_accepted`.
- Only after acceptance does the server fulfill the original request.

## Correlated notifications

Payment notifications are correlated to the original request using an `e` tag that references the **request event id**.

Notifications used by the SDK:

- `notifications/payment_required`
- `notifications/payment_accepted`
- `notifications/payment_rejected` (CEP-21)

## Middleware model (why it matters)

Payments are a middleware layer around transports:

- transports handle Nostr ↔ JSON-RPC conversion, encryption, routing, and correlation
- payments middleware handles pricing decisions, payment notifications, and gating

Security invariant for servers: priced requests must **fail closed** (no unpaid forwarding).
