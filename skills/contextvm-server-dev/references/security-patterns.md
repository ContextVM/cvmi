# Security Patterns for ContextVM Servers

## Pattern 1: Fully Private Server (Default)

Only specific clients can connect:

```typescript
new NostrServerTransport({
  signer,
  relayHandler: relayPool,
  allowedPublicKeys: [client1, client2, client3],
  isPublicServer: false, // No announcements. This is the default
});
```

## Pattern 2: Public Discovery, Private Access

Anyone can discover the server, only authorized clients can use it:

```typescript
new NostrServerTransport({
  signer,
  relayHandler: relayPool,
  isPublicServer: true, // Announce to network
  allowedPublicKeys: [client1, client2],
  excludedCapabilities: [
    { method: "tools/list" }, // Public: anyone can see tools
  ],
});
```

## Pattern 3: Tiered Access

Different access levels based on client identity:

```typescript
new NostrServerTransport({
  signer,
  relayHandler: relayPool,
  injectClientPubkey: true, // Access client identity in tools
});

// In tool handler:
async (args, extra) => {
  const clientPubkey = extra._meta?.clientPubkey;
  const tier = await getClientTier(clientPubkey);

  if (tier === "premium") {
    return premiumResult;
  } else if (tier === "basic") {
    return basicResult;
  } else {
    throw new Error("Unauthorized");
  }
};
```

## Pattern 4: Rate Limiting

Track and limit usage per client:

```typescript
const usageStore = new Map<string, number>();

async (args, extra) => {
  const clientPubkey = extra._meta?.clientPubkey;
  const current = usageStore.get(clientPubkey) || 0;

  if (current > 100) {
    throw new Error("Rate limit exceeded");
  }

  usageStore.set(clientPubkey, current + 1);
  return result;
};
```
