---
'cvmi': minor
---

Add CEP-8 capability pricing and explicit payment gating to `cvmi call` and `cvmi use`.

- `cvmi call`: new `--payment-mode` flag (`transparent` default | `explicit_gating`). In `explicit_gating`, a priced tool surfaces a `-32042 Payment Required` JSON-RPC error carrying payment options; the caller pays one and retries the same invocation to consume the paid authorization. Transparent mode is now PMI-agnostic — it advertises no client PMIs, letting the server select the settlement rail.
- `cvmi use`: defaults to `explicit_gating` so agent hosts over stdio see priced tools as `Payment Required` errors instead of silent notifications. Override with `--payment-mode transparent`.
- Pricing discovery: the tool list and per-tool `--help` output now show advertised per-tool prices (parsed from server `cap` tags) and accepted payment methods (PMIs), with a footnote that the final charge is confirmed at call time.
- `cvmi serve`: payment interaction configuration support.
- Pricing parser hardened against malformed `cap` prices: negative values and out-of-order ranges are rejected per the CEP-8 spec (fixed = integer, range = `min-max` inclusive) rather than coerced into bogus ranges.
- Bumps `@contextvm/sdk` to ^0.13.9 and `@modelcontextprotocol/sdk` to ^1.29.
