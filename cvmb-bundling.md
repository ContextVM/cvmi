# CVM Bundle Format (.cvmb)

**Status**: Draft

## Summary

Defines the `.cvmb` (CVM Bundle) packaging format for distributing ContextVM MCP servers. A `.cvmb` file is a ZIP archive containing server code, dependencies, and a `manifest.json`. The format is inspired by the [MCPB specification](https://github.com/modelcontextprotocol/mcpb) but is not bound by MCPB host compatibility — `.cvmb` bundles are designed for the ContextVM ecosystem and are consumed by `cvmi serve`.

## Key Points

- ZIP archive with `manifest.json` at the root; file extension `.cvmb`
- Two transport modes: `stdio` (Gateway-wrapped) and `cvm` (native Nostr transport)
- Reuses `user_config` and `mcp_config.env` for typed configuration and environment injection
- Nostr Schnorr signatures (`_sig`) for authorship verification — no external PKI required
- Merkle-tree content hashing (`content_hash`) binds all bundle files to the manifest
- RFC 8785 canonicalization for deterministic signing and verification
- Secrets are never shipped in plaintext; declared via `user_config` with `sensitive: true`
- Docker support as a first-class server type with image references (not bundled images)
- Fully offline-operable: signing, verification, and hashing require no network access

---

## File Format

A `.cvmb` bundle is a ZIP archive (maximum compression) containing:

```
my-server.cvmb
├── manifest.json        # Required: bundle metadata and configuration
├── server/              # Server code (for node, python, uv, binary types)
│   └── ...
├── node_modules/        # Bundled dependencies (node type)
├── pyproject.toml       # Dependencies declaration (uv type)
├── docker-compose.yml   # Multi-container orchestration (docker type, optional)
└── assets/              # Icons, screenshots, etc.
```

Excluded from the bundle: `.git`, `.cache`, `.DS_Store`, `.env`, `node_modules/.cache`, and any existing `.cvmb` or `.mcpb` files.

---

## Manifest Schema

### Required Fields

| Field              | Type   | Description                                                               |
| ------------------ | ------ | ------------------------------------------------------------------------- |
| `manifest_version` | string | Spec version this manifest conforms to (e.g., `"0.3"`)                    |
| `name`             | string | Machine-readable name (used for CLI, APIs)                                |
| `version`          | string | Semantic version (semver)                                                 |
| `description`      | string | Brief description of the server                                           |
| `author`           | object | Author information with required `name` field; optional `email` and `url` |
| `server`           | object | Server configuration (see below)                                          |

### Optional Fields

| Field               | Type     | Description                                                       |
| ------------------- | -------- | ----------------------------------------------------------------- |
| `display_name`      | string   | Human-friendly name for UI display                                |
| `long_description`  | string   | Detailed markdown description                                     |
| `repository`        | object   | Source code repository (`type` and `url`)                         |
| `homepage`          | string   | Project homepage URL                                              |
| `documentation`     | string   | Documentation URL                                                 |
| `support`           | string   | Support/issues URL                                                |
| `icon`              | string   | Path to a PNG icon file                                           |
| `icons`             | array    | Array of icon descriptors (`src`, `size`, optional `theme`)       |
| `screenshots`       | string[] | Array of screenshot paths                                         |
| `tools`             | array    | Declared tools the server provides                                |
| `tools_generated`   | boolean  | Server generates additional tools at runtime (default: `false`)   |
| `prompts`           | array    | Declared prompts the server provides                              |
| `prompts_generated` | boolean  | Server generates additional prompts at runtime (default: `false`) |
| `keywords`          | string[] | Search keywords                                                   |
| `license`           | string   | License identifier (e.g., `"MIT"`)                                |
| `privacy_policies`  | string[] | URLs to privacy policies for external services                    |
| `compatibility`     | object   | Platform and runtime requirements                                 |
| `user_config`       | object   | User-configurable options (see User Configuration)                |
| `_meta`             | object   | Reverse-DNS namespaced metadata (see CVM Metadata)                |
| `_sig`              | object   | Nostr Schnorr signature (see Signing and Verification)            |

### Server Configuration

The `server` object defines how to run the MCP server:

```json
{
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "transport": "stdio",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": {
        "API_KEY": "${user_config.api_key}"
      }
    }
  }
}
```

| Field          | Type   | Required    | Description                                                                           |
| -------------- | ------ | ----------- | ------------------------------------------------------------------------------------- |
| `type`         | enum   | Yes         | Server type: `"node"`, `"python"`, `"uv"`, `"binary"`, `"docker"`                     |
| `entry_point`  | string | See notes   | Path to the main server file. Required for node/python/uv/binary; optional for docker |
| `transport`    | enum   | No          | Transport mode: `"stdio"` (default) or `"cvm"`                                        |
| `image`        | string | docker only | Docker image reference (e.g., `"ghcr.io/dev/my-server:1.0.0"`)                        |
| `compose_file` | string | docker only | Path to `docker-compose.yml` within the bundle for multi-container setups             |
| `mcp_config`   | object | Yes         | Process spawn configuration                                                           |

#### Server Types

| Type     | Description                    | Dependencies                                    |
| -------- | ------------------------------ | ----------------------------------------------- |
| `node`   | Node.js server                 | Bundled in `node_modules/`                      |
| `python` | Python server                  | Bundled in `server/lib/` or `server/venv/`      |
| `uv`     | Python server using UV runtime | Declared in `pyproject.toml`, installed by host |
| `binary` | Pre-compiled executable        | Self-contained                                  |
| `docker` | Docker container               | Image referenced, pulled at runtime             |

#### MCP Configuration

The `mcp_config` object defines the process spawn command:

| Field     | Type     | Description                             |
| --------- | -------- | --------------------------------------- |
| `command` | string   | Command to execute                      |
| `args`    | string[] | Arguments passed to the command         |
| `env`     | object   | Environment variables (string → string) |

Variable substitution is supported in `command`, `args`, and `env` values:

- `${__dirname}` — Absolute path to the extracted bundle directory
- `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}` — Standard user directories
- `${user_config.KEY}` — User-provided configuration value

---

## Transport Modes

### `stdio` (default)

The server communicates over stdin/stdout. `cvmi serve` spawns the process and wraps it with the Gateway. The Gateway owns all CVM configuration (relays, encryption, announcements, payments). The server is completely transport-agnostic.

```
┌──────────┐    stdio    ┌─────────┐    Nostr    ┌────────┐
│  Server  │◄──────────►│ Gateway │◄──────────►│ Relays │
│ Process  │             │         │             │        │
└──────────┘             └─────────┘             └────────┘
```

### `cvm`

The server uses the CVM SDK's `NostrServerTransport` directly. `cvmi serve` spawns the process without the Gateway. CVM configuration (relays, encryption, public mode) is injected as environment variables via `mcp_config.env`. The server manages its own transport.

```
┌──────────┐    Nostr    ┌────────┐
│  Server  │◄──────────►│ Relays │
│ Process  │             │        │
└──────────┘             └────────┘
```

Use `cvm` mode when the server needs SDK-specific features:

- `injectClientPubkey` — per-client authentication and authorization
- Dynamic authorization callbacks (`isPubkeyAllowed`)
- Direct transport-level capabilities not available through the Gateway

**Environment variables are available for both transport modes.** `stdio` servers can also declare `mcp_config.env` for API keys, config paths, or any other runtime values the Gateway doesn't own.

### Transport Selection

The `transport` field declares the intended mode. At runtime, `cvmi serve` honors this but can override via CLI flags:

```bash
# Force Gateway wrap even for cvm bundles
cvmi serve --transport stdio my-server.cvmb

# Force direct spawn even for stdio bundles
cvmi serve --transport cvm my-server.cvmb
```

---

## User Configuration

The `user_config` field follows the MCPB convention for typed, user-facing configuration. Each key defines a configuration option with type, validation, and sensitivity:

```json
{
  "user_config": {
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "Your API key for authentication",
      "sensitive": true,
      "required": true
    },
    "max_file_size": {
      "type": "number",
      "title": "Maximum File Size (MB)",
      "description": "Maximum file size to process",
      "default": 10,
      "min": 1,
      "max": 100
    },
    "allowed_directories": {
      "type": "directory",
      "title": "Allowed Directories",
      "description": "Directories the server can access",
      "multiple": true,
      "required": true,
      "default": ["${HOME}/Desktop"]
    }
  }
}
```

### Configuration Types

| Type        | UI Control       | `multiple` Support            | `sensitive` Support |
| ----------- | ---------------- | ----------------------------- | ------------------- |
| `string`    | Text input       | No                            | Yes (masks input)   |
| `number`    | Numeric input    | No                            | No                  |
| `boolean`   | Checkbox/toggle  | No                            | No                  |
| `directory` | Directory picker | Yes (array expansion in args) | No                  |
| `file`      | File picker      | Yes (array expansion in args) | No                  |

### Secrets Handling

Fields marked `sensitive: true` are never stored in plaintext. `cvmi serve` prompts for them on first run or reads them from environment variables. They are never included in `_meta.com.contextvm.defaults`.

### Variable Substitution

User config values are injected through `mcp_config` using `${user_config.KEY}`:

```json
{
  "mcp_config": {
    "env": {
      "API_KEY": "${user_config.api_key}",
      "BASE_URL": "${user_config.base_url}"
    },
    "args": ["${user_config.allowed_directories}"]
  }
}
```

When `multiple: true`, array values are expanded as separate arguments.

---

## CVM Metadata (`_meta.com.contextvm`)

CVM-specific configuration lives under the `_meta.com.contextvm` namespace:

```json
{
  "_meta": {
    "com.contextvm": {
      "content_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
}
```

| Field          | Type   | Description                                                      |
| -------------- | ------ | ---------------------------------------------------------------- |
| `content_hash` | string | SHA-256 Merkle hash of all bundle files, prefixed with `sha256:` |

The `content_hash` is computed during packing and included in the manifest before signing. This cryptographically binds all bundle contents to the manifest signature.

Future CVM-specific fields (relay defaults, encryption preferences, pricing configuration) may be added to this namespace as the design evolves.

---

## Signing and Verification

Bundles are signed using the author's Nostr keypair. **All cryptography is delegated to [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools)** (`finalizeEvent` / `verifyEvent`) — `cvmi` performs no manual curve operations and does not depend on `@noble/curves` directly. The signature lives in the `_sig` field:

```json
{
  "_sig": {
    "pubkey": "abc123...",
    "id": "def456...",
    "signature": "86f25c...",
    "created_at": 1718123456
  }
}
```

### The Signing Event

The signature is a real Nostr event (never published to relays) whose `content` is the canonical manifest. Using `finalizeEvent` / `verifyEvent` binds the author's Nostr identity to the exact manifest bytes without any manual curve math:

```json
{
  "kind": "<MANIFEST_SIGNATURE_KIND>",
  "tags": [],
  "content": "<RFC 8785 canonical manifest, _sig removed>",
  "created_at": 1718123456,
  "pubkey": "abc123...",
  "id": "def456...",
  "sig": "86f25c..."
}
```

`MANIFEST_SIGNATURE_KIND` is a fixed constant defined by the tooling. Its value is arbitrary (the event is never relayed); it only needs to be identical at sign and verify time. Only `pubkey`, `id`, `sig`, and `created_at` are stored in the manifest's `_sig`; the rest is reconstructed during verification.

### `_sig` Fields

| Field        | Type   | Description                                                                                       |
| ------------ | ------ | ------------------------------------------------------------------------------------------------- |
| `pubkey`     | string | Author's Nostr public key (hex, x-only)                                                           |
| `id`         | string | NIP-01 event id: SHA-256 of the serialized signing event, which commits to the canonical manifest |
| `signature`  | string | Schnorr (BIP-340) signature of `id`, produced by `nostr-tools` `finalizeEvent` (hex)              |
| `created_at` | number | Unix timestamp of when the signature was created (informational only)                             |

### Signing Flow

1. Compute `content_hash` over all bundle files (see Content Integrity)
2. Insert `content_hash` into `_meta.com.contextvm`
3. Remove `_sig` from the manifest (if present)
4. Canonicalize the manifest per RFC 8785 (sorted keys, no whitespace) → `content`
5. Build a Nostr signing event `{ kind, tags: [], content, created_at }`
6. Sign it with the author's Nostr private key via `finalizeEvent` → `{ pubkey, id, sig }`
7. Insert `_sig` with `pubkey`, `id`, `signature` (= the event's `sig`), `created_at`
8. Pack the ZIP

### Verification Flow

1. Extract the ZIP
2. Verify `content_hash` matches actual bundle files (see Content Integrity)
3. Remove `_sig` from the manifest, canonicalize per RFC 8785 → `content`
4. Reconstruct the signing event `{ kind, tags: [], content, pubkey: _sig.pubkey, id: _sig.id, sig: _sig.signature, created_at: _sig.created_at }`
5. Verify with `verifyEvent` — this checks both the NIP-01 event `id` and the Schnorr signature

All checks pass → valid. Any check fails → invalid.

The bundle author's Nostr identity is the root of trust. The same keypair can sign multiple servers, giving the author a stable identity across their catalog without any CA or certificate infrastructure. Verification is a pure cryptographic operation — no network access required.

---

## Content Integrity

Bundle file integrity is verified using a Merkle-style hash tree:

1. Recursively list all files in the bundle directory
2. Exclude `manifest.json`, any `.cvmb`/`.mcpb` files, and ignored patterns (`.git`, `node_modules`, `.DS_Store`, `.env`)
3. Compute `SHA-256(file_contents)` for each remaining file
4. Sort entries alphabetically by relative path (using `/` as separator)
5. Concatenate `path:hash\n` for each entry
6. Compute `SHA-256(concatenation)` and prefix with `sha256:`

```
Files:
  server/index.js   → sha256:aaa...
  server/utils.js   → sha256:bbb...
  package.json      → sha256:ccc...

Sorted concatenation:
  "package.json:ccc...\nserver/index.js:aaa...\nserver/utils.js:bbb..."

content_hash = "sha256:" + SHA-256(concatenation)
```

This approach enables:

- **Single-hash verification**: one hash covers all files
- **Deterministic ordering**: alphabetical sort ensures reproducible hashes
- **Path binding**: file paths are part of the hash, preventing file relocation attacks

---

## Docker Support

Docker is a first-class server type for complex deployments requiring databases, caches, or other services alongside the MCP server.

### Single Container

```json
{
  "server": {
    "type": "docker",
    "image": "ghcr.io/developer/my-cvm-server:1.0.0",
    "transport": "stdio",
    "mcp_config": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "ghcr.io/developer/my-cvm-server:1.0.0"]
    }
  }
}
```

The container exposes stdio MCP. `cvmi serve` spawns `docker run --rm -i <image>` and communicates over stdin/stdout, then wraps with the Gateway. The image is pulled from the registry on first run.

### Multi-Container (Docker Compose)

```json
{
  "server": {
    "type": "docker",
    "compose_file": "docker-compose.yml",
    "transport": "stdio",
    "mcp_config": {
      "command": "docker",
      "args": ["compose", "-f", "${__dirname}/docker-compose.yml", "run", "--rm", "-i", "server"]
    }
  }
}
```

The `compose_file` references a `docker-compose.yml` bundled inside the `.cvmb`. This handles orchestration of the server with its dependencies (database, cache, etc.).

### Docker Considerations

- Docker images are **referenced, not bundled** — the `.cvmb` contains only the manifest reference
- Images are pulled at runtime on first `cvmi serve`
- Docker must be installed on the host system
- The container communicates over stdio; `cvmi serve` wraps it with the Gateway

---

## Packing Flow (`cvmi pack`)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. Validate  │────►│ 2. Hash      │────►│ 3. Sign      │────►│ 4. Archive   │
│   manifest   │     │   contents   │     │   manifest   │     │   .cvmb ZIP  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

1. **Validate manifest** against the schema; ensure all required fields are present and types are correct
2. **Compute `content_hash`** over all bundle files (Merkle tree, see Content Integrity)
3. **Insert `content_hash`** into `_meta.com.contextvm`
4. **Sign the manifest**: canonicalize (RFC 8785), compute `id`, sign with author's Nostr private key, insert `_sig`
5. **Archive**: create ZIP with maximum compression, excluding dev files and ignored patterns

---

## Serving Flow (`cvmi serve`)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ 1. Extract   │────►│ 2. Verify    │────►│ 3. Resolve       │────►│ 4. Spawn     │
│   .cvmb ZIP  │     │   signature  │     │   user_config    │     │   process    │
└──────────────┘     └──────────────┘     └──────────────────┘     └──────────────┘
```

1. **Extract** the `.cvmb` to a temporary or persistent directory
2. **Verify** the manifest signature and `content_hash` (see Verification Flow)
3. **Resolve configuration** using the standard precedence chain:
   - CLI flags (highest priority)
   - Custom config file (`--config <path>`)
   - Project-level `./.cvmi.json`
   - Global `~/.cvmi/config.json`
   - Environment variables
   - Manifest defaults (lowest priority)
4. **Prompt for missing `user_config`** values (especially `sensitive: true` fields)
5. **Spawn the process** according to `transport` mode:
   - `stdio`: spawn process → wrap with Gateway → Gateway manages Nostr transport
   - `cvm`: spawn process directly → inject resolved env vars → server manages its own transport

---

## Canonicalization

Manifest canonicalization follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JSON Canonicalization Scheme):

- Object keys are sorted lexicographically
- No whitespace outside string values
- Unicode characters are escaped per the RFC
- Numbers are serialized without insignificant digits

The canonical form is used for computing `_sig.id` and must be reproduced identically by any implementation. The `canonicalize` npm package provides a conformant implementation.

---

## Design Decisions

### No MCPB Host Compatibility

`.cvmb` bundles are designed exclusively for the ContextVM ecosystem. They are not intended to run in generic MCPB hosts (like Claude Desktop). MCPB is designed for local stdio servers installed into desktop applications — a different use case from distributing CVM servers that run over Nostr. Maintaining MCPB spec compatibility would add constraints (server type enums, `mcp_config` assumptions) without benefit.

The format borrows MCPB's manifest shape where it makes sense (`user_config`, `mcp_config`, variable substitution) but defines its own server types, transport modes, and signing mechanism.

### Secrets Never in Plaintext

Private keys, API keys, and any sensitive values are never shipped in the bundle or stored in `_meta.com.contextvm.defaults`. They are declared via `user_config` with `sensitive: true` and resolved by `cvmi serve` at runtime through prompting or environment variables.

### No PKI — Nostr Identity as Root of Trust

X.509 certificates and CA infrastructure are unnecessary when the server already has a Nostr identity (keypair). Signing with the same keypair used for protocol operation and announcements provides a unified identity model. Verification is a pure Schnorr signature check — no network access, no certificate chains, no expiration.

### Merkle Hashing Enables Integrity Without Extraction

The Merkle tree structure means the `content_hash` can be verified incrementally. Future tooling could verify individual files without re-hashing the entire bundle, and partial updates could be validated against a known root hash.

---

## References

- [MCPB Specification](https://github.com/modelcontextprotocol/mcpb) — base manifest format inspiration
- [MCPB MANIFEST.md](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md) — field definitions and user_config spec
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) — JSON Canonicalization Scheme
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — Nostr event signing (Schnorr signatures)
- [CEP-6: Public Server Announcements](ceps.md) — server discovery events (kind 11316–11320)
- [CEP-4: Encryption Support](ceps.md) — `support_encryption` tag and NIP-44
