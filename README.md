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
- [ ] `cvmi cn` - Compile a server to code (ctxcn)
- [ ] `cvmi call` - Call methods from a server
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

Additional serve env vars:
- `CVMI_SERVE_URL` / `CVMI_GATEWAY_URL` to set the remote Streamable HTTP MCP server URL

**Logging environment variables (SDK-level):**
The underlying `@contextvm/sdk` uses these env vars to control logging:

| Variable | Values | Description |
|----------|--------|-------------|
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` | Minimum log level to output (default: `info`) |
| `LOG_DESTINATION` | `stderr`, `stdout`, `file` | Where to write logs (default: `stderr`) |
| `LOG_FILE` | path string | Path to log file (used when `LOG_DESTINATION=file`) |
| `LOG_ENABLED` | `true`, `false` | Disable all logging with `false` (default: `true`) |

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
    "privateKey": "nsec1...",
    "relays": ["wss://relay.damus.io"],
    "public": false,
    "encryption": "optional"
  },
  "use": {
    "privateKey": "nsec1...",
    "relays": ["wss://relay.damus.io"],
    "serverPubkey": "npub1...",
    "encryption": "optional"
  }
}
```

Note: For `serve`, you should configure either `serve.url` (remote Streamable HTTP MCP server) or `serve.command`/`serve.args` (spawn local stdio MCP server).

#### About quoting commands

`cvmi serve` spawns the MCP server directly (no shell). Prefer passing the command and its arguments as separate tokens:

```bash
cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

If you accidentally pass a full command as a single quoted string (e.g. `"npx -y ..."`), `cvmi` will split it into an executable + args for you.

Note: The CLI auto-generates a private key if none is provided. Keys can be specified in hex format (with or without `0x` prefix) or NIP-19 bech32 format (`nsec1...` for private keys, `npub1...` for public keys).

## License
MIT
