---
'cvmi': minor
---

Added `.cvmb` (CVM Bundle) support: a new `cvmi pack` command packages an MCP server into a signed `.cvmb` bundle (ZIP archive with a `manifest.json`), and `cvmi serve <bundle.cvmb>` extracts, verifies, and runs it. Bundles support both `stdio` (Gateway-wrapped) and `cvm` (native Nostr transport) modes, typed `user_config` with secrets handling, Merkle-tree `content_hash` integrity binding, and Nostr Schnorr manifest signatures via `nostr-tools`.
