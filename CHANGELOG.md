# cvmi

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
