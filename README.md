# CVMI (wip)

**ContextVM Interface (CVMI)** is a CLI tool that allows you to navigate and use the ContextVM protocol. It provides a set of tools and skills to help you interact, and implement the protocol.

> **Note:** This project is a fork of the [`skills`](https://github.com/vercel-labs/skills) CLI by Vercel Labs.

## Quick Start

```bash
# Install ContextVM skills interactively
npx cvmi add

# Install a specific skill from the ContextVM repository
npx cvmi add --skill overview
```

## Roadmap

- [x] `cvmi add` - Install skills with interactive picker
- [x] `cvmi add --skill <name>` - Install specific skills
- [x] `cvmi serve` - Expose a server (gateway)
- [x] `cvmi use` - Use a server from nostr as stdio (proxy)
- [x] `cvmi discover` - Discover announced servers on relays
- [ ] `cvmi cn` - Compile a server to code (ctxcn)
- [x] `cvmi call` - Call methods from a server
- [ ] `cvmi inspect` - Inspect server schema

### Configuration

Configuration is stored in JSON format with the following priority:

1. CLI flags (highest priority)
2. Custom config: `--config <path>`
3. Project-level: `./.cvmi.json`
4. Global: `~/.cvmi/config.json`
5. Environment variables

**Global config path:** `~/.cvmi/config.json` (separate from `~/.agents/` used for skills)

**Nostr MCP environment variables:**

- `CVMI_SERVE_*` / legacy `CVMI_GATEWAY_*` for serve/gateway settings
- `CVMI_USE_*` / legacy `CVMI_PROXY_*` for use/proxy settings
- `CVMI_CALL_PRIVATE_KEY` for direct [`cvmi call`](README.md) requests

Additional serve env vars:

- `CVMI_SERVE_URL` / `CVMI_GATEWAY_URL` to set the remote Streamable HTTP MCP server URL

**Logging environment variables (SDK-level):**
The underlying `@contextvm/sdk` uses these env vars to control logging:

| Variable          | Values                                     | Description                                         |
| ----------------- | ------------------------------------------ | --------------------------------------------------- |
| `LOG_LEVEL`       | `debug`, `info`, `warn`, `error`, `silent` | Minimum log level to output (default: `info`)       |
| `LOG_DESTINATION` | `stderr`, `stdout`, `file`                 | Where to write logs (default: `stderr`)             |
| `LOG_FILE`        | path string                                | Path to log file (used when `LOG_DESTINATION=file`) |
| `LOG_ENABLED`     | `true`, `false`                            | Disable all logging with `false` (default: `true`)  |

**Example:** Run `serve` with debug logging to a file

```bash
LOG_LEVEL=debug LOG_DESTINATION=file LOG_FILE=./cvmi.log cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

**Example:** Run `use` with only warnings and errors

```bash
LOG_LEVEL=warn cvmi use npub1q...
```

Example global config (`~/.cvmi/config.json`):

```json
{
  "serve": {
    "url": "https://my.mcp.com/mcp",
    "command": "npx",
    "args": ["@modelcontextprotocol/server-filesystem", "."],
    "relays": ["wss://relay.damus.io"],
    "public": false,
    "encryption": "optional"
  },
  "use": {
    "relays": ["wss://relay.damus.io"],
    "serverPubkey": "npub1...",
    "encryption": "optional"
  },
  "servers": {
    "weather": {
      "pubkey": "npub1...",
      "relays": ["wss://relay.contextvm.org"]
    }
  }
}
```

Private keys are not stored in JSON config. Set them with environment variables or CLI flags instead.

### `cvmi call`

[`cvmi call`](src/call.ts) resolves server targets using this order:

1. Direct CLI flags such as `--relays` and `--config`
2. Custom config passed via `--config <path>`
3. Project config in `./.cvmi.json`
4. Global config in `~/.cvmi/config.json`

Create reusable aliases from the CLI:

```bash
# Save an alias in the current project's .cvmi.json
cvmi config add weather nprofile1example

# Save an alias globally
cvmi config add --global weather nprofile1example

# Call through the alias
cvmi call weather tool:weather.get_current city=Lisbon

# Use an alternate config file
cvmi call weather tool:weather.get_current city=Lisbon --config ./custom.cvmi.json
```

### `cvmi discover`

[`cvmi discover`](src/discover.ts) queries relay-stored server announcement events so you can find public ContextVM servers before using [`cvmi call`](src/call.ts:329).

It is intentionally config-less and straightforward:

- pass relays explicitly with `--relays`, or
- rely on the built-in default relays

Examples:

```bash
# Discover public servers on the default relays
cvmi discover

# Discover on a specific relay
cvmi discover --relays wss://relay.contextvm.org

# Limit the number of returned announcements
cvmi discover --limit 10

# Get machine-readable JSON output
cvmi discover --raw
```

Note: For `serve`, you should configure either `serve.url` (remote Streamable HTTP MCP server) or `serve.command`/`serve.args` (spawn local stdio MCP server).

### Public discovery and relay-list metadata

The underlying SDK can publish two complementary discoverability artifacts:

- `kind:11316-11320` server announcement events for capabilities and metadata
- `kind:10002` relay-list metadata so clients can discover where the server is reachable

Recommended behavior:

- keep your operational `relays` list focused on where the server actually runs
- use `bootstrapRelayUrls` to publish discoverability metadata more broadly
- keep `publishRelayList` enabled unless you explicitly want to opt out, including for private servers

This mirrors the CEP-17 model where discoverability publication targets can be broader than the relays advertised to clients.

#### About quoting commands

`cvmi serve` spawns the MCP server directly (no shell). Prefer passing the command and its arguments as separate tokens:

```bash
cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

If you accidentally pass a full command as a single quoted string (e.g. `"npx -y ..."`), `cvmi` will split it into an executable + args for you.

#### Passing environment variables to the spawned MCP server

Use `--env` / `-e` (repeatable):

```bash
cvmi serve -e LOG_LEVEL=debug -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

You can also set it in config under `serve.env`.

Note: The CLI auto-generates a private key if none is provided. Keys can be specified in hex format (with or without `0x` prefix) or NIP-19 bech32 format (`nsec1...` for private keys, `npub1...` for public keys).

## License

MIT
