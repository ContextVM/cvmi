# cvmi

## 0.2.5

### Patch Changes

- refactor(call): improve error handling when tool is not found

## 0.2.4

### Patch Changes

- refactor(call): condense help and inspection output

  Reduce redundancy in cvmi call command output while maintaining
  clarity and actionable guidance:
  - Rename "Calling tools" to "Invoke" with consolidated copy
  - Remove redundant quoting guidance and examples
  - Shorten section headers: "Private key resolution" → "Private key",
    "Configuration Sources" → "Aliases & config"
  - Consolidate config priority and alias guidance into fewer lines
  - Remove redundant examples from main help
  - Update all test expectations for new output format

## 0.2.3

### Patch Changes

- feat(cli): improve UX for LLM usage

## 0.2.2

### Patch Changes

- feat(call): improve help text for passing array/object arguments

## 0.2.1

### Patch Changes

- feat(cli): add discover command to find public ContextVM servers

  Add new 'cvmi discover' command that queries relays for public ContextVM
  server announcements (kind 11316). Users can specify relays, limit results,
  and get raw JSON output.

  Also improves 'cvmi call' with loading spinners and better output formatting.

## 0.2.0

### Minor Changes

- feat(cli): add cvmi call command to invoke remote ContextVM capabilities

## 0.1.11

### Patch Changes

- feat: align agent selection UX with upstream skills CLI
  - Add interactive search with fuzzy filtering to agent selection
  - Display locked "Universal (.agents/skills)" section with pre-selected universal agents
  - Improve visual separation between universal and agent-specific installations

- feat: add `cvmi sync` command for plugin skill synchronization

  Sync skills from agent plugins (e.g., @contextvm/mcp-monitoring) via plugin manifests.

- feat: add `cortex` agent support

- refactor: derive universal agents from skillsDir configuration

  Eliminate hardcoded agent lists by identifying universal agents dynamically
  based on their `.agents/skills` directory configuration.

## 0.1.10

### Patch Changes

- feat(payments): add CEP-8 payments skill documentation

  Add comprehensive documentation for implementing ContextVM payments using CEP-8 specification. This includes server and client setup guides, built-in Lightning payment rails (NWC and LNbits), custom rail development, and troubleshooting references.

## 0.1.9

### Patch Changes

- feat(serve): add env var support to spawned MCP server

## 0.1.8

### Patch Changes

- refactor(serve): normalize quoted command strings via shared argv util

## 0.1.7

### Patch Changes

- fix(config): skip duplicate private key entries in env file

  Modify savePrivateKeyToEnv to check for existing variable before appending.
  Add test to verify skip behavior.

## 0.1.6

### Patch Changes

- feat(cli): add --persist-private-key flag to save keys to .env

  This commit adds the `--persist-private-key` flag to the CLI commands,
  allowing users to save their private keys to a `.env` file for reuse.
  It also updates the configuration system to store private keys in `.env`
  files instead of JSON configuration files, improving security and
  separation of concerns.

## 0.1.5

### Patch Changes

- feat(serve): add remote HTTP MCP server support
  - Add `serve.url` config and `CVMI_SERVE_URL`/`CVMI_GATEWAY_URL` env vars
  - CLI accepts HTTP(S) URL as first argument for remote servers
  - Use StreamableHTTPClientTransport for HTTP targets, StdioClientTransport for stdio
  - Per-client transports for HTTP (required for session isolation)
  - Custom fetch with GET timeout fallback for servers that don't support GET
  - Update dependencies: @contextvm/sdk, nostr-tools, @types/node
  - Add tests and update documentation

## 0.1.4

### Patch Changes

- 4169148: fix: exit cleanly

## 0.1.3

### Patch Changes

- refactor(cli, config): improve CLI argument parsing and configuration loading

- Refactor CLI argument parsing for serve and use commands to support `--` separator and strict flag validation
- Update configuration loading precedence: CLI > Custom config > Project config > Global config > Environment
- Add help functions for serve and use commands
- Move UI constants to a shared module
- Enable stricter TypeScript settings (noUnusedLocals and noUnusedParameters)
- Update tests to match new behavior
- Update README.md with new configuration and environment variable documentation

## 0.1.2

### Patch Changes

- feat(cli): add serve and use commands with configuration system

## 0.1.1

### Patch Changes

- Merge upstream/main from vercel-labs/skills

## 0.1.0

### Minor Changes

- refactor: rename skills

## 0.0.1

### Patch Changes

- init
