# Monitoring ContextVM Services

## Structured Logging

Use the SDK's structured logger for machine-parseable output:

```typescript
import { createLogger } from "@contextvm/sdk/core";

const logger = createLogger("server");

// Request logging
logger.info("request.received", {
  module: "server",
  method: "tools/call",
  tool: args.name,
  clientPubkey: extra._meta?.clientPubkey?.slice(0, 8),
});

// Response logging
logger.info("request.completed", {
  module: "server",
  method: "tools/call",
  tool: args.name,
  durationMs: Date.now() - startTime,
  status: "success",
});

// Error logging
logger.error("request.failed", {
  module: "server",
  method: "tools/call",
  tool: args.name,
  error: {
    message: error.message,
    stack: error.stack,
  },
});
```

## Metrics Collection

### Request Metrics

```typescript
class MetricsCollector {
  private requests = new Map<string, number>();
  private errors = new Map<string, number>();
  private latencies: number[] = [];

  recordRequest(method: string, durationMs: number) {
    this.requests.set(method, (this.requests.get(method) || 0) + 1);
    this.latencies.push(durationMs);
  }

  recordError(method: string) {
    this.errors.set(method, (this.errors.get(method) || 0) + 1);
  }

  getStats() {
    return {
      requests: Object.fromEntries(this.requests),
      errors: Object.fromEntries(this.errors),
      avgLatency:
        this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length,
      p95Latency: this.latencies.sort((a, b) => a - b)[
        Math.floor(this.latencies.length * 0.95)
      ],
    };
  }
}
```
