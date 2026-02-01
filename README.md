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
2. Project-level: `./cvmi.config.json`
3. Global: `~/.cvmi/config.json`
4. Environment variables

**Global config path:** `~/.cvmi/config.json` (separate from `~/.agents/` used for skills)

**Environment variables:**
- `CVMI_GATEWAY_*` for gateway settings
- `CVMI_PROXY_*` for proxy settings

Example global config (`~/.cvmi/config.json`):
```json
{
  "gateway": {
    "server": ["npx", "@modelcontextprotocol/server-filesystem", "."],
    "privateKey": "hex-private-key",
    "relays": ["wss://relay.damus.io"],
    "public": false,
    "encryptionMode": "optional"
  },
  "proxy": {
    "privateKey": "hex-private-key",
    "relays": ["wss://relay.damus.io"],
    "serverPubkey": "hex-server-pubkey",
    "encryptionMode": "optional"
  }
}
```

## License
MIT
