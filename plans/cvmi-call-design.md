# `cvmi call` Design Document

## Status

- Design phase
- No implementation in this document
- Purpose: lock product direction, UX principles, and integration points for later development

## Motivation

[`cvmi call`](../README.md:24) is the roadmap item that turns `cvmi` from only a skill installer / proxy tool into a direct ContextVM client.

Today, [`cvmi use`](../src/use.ts:27) exposes a remote ContextVM server as local stdio MCP for another host. [`cvmi call`](../README.md:24) should instead let users and agents directly invoke remote server capabilities from the shell, without needing an MCP host in the middle.

This is strategically important for the CVM ecosystem because it gives servers a native CLI entrypoint:

- usable by humans in terminals
- usable by scripts and automation
- usable by agents without an MCP host bridge
- aligned with ContextVM's pubkey-first model

## Product framing

The intended command split is:

- [`cvmi serve`](../src/cli.ts:89): expose a local MCP server over ContextVM / Nostr
- [`cvmi use`](../src/use.ts:27): bridge a remote ContextVM server into local stdio MCP
- [`cvmi call`](../README.md:24): directly access remote server capabilities as a CLI client

This framing should stay sharp through implementation.

## Core thesis

[`cvmi call`](../README.md:24) should be the **single primary remote interaction command** for ContextVM servers.

It should be:

- pubkey-or-alias addressed
- capability-aware
- help-driven for discovery
- clean by default
- raw when explicitly requested
- compatible with tools first, but architected for all capability kinds

The key design goal is to keep the top-level CLI surface small while making the second-level capability model expressive.

## Key design principles

### 1. Pubkey-first identity

ContextVM servers are identified by public keys, not URLs. The canonical server identity for [`cvmi call`](../README.md:24) is therefore the server pubkey.

Accepted target forms should include:

- `npub1...`
- hex public key
- local alias resolving to one of the above

Aliases are ergonomic sugar; pubkeys remain canonical.

Relevant references:

- [`skills/overview/SKILL.md`](../skills/overview/SKILL.md:10)
- [`skills/concepts/SKILL.md`](../skills/concepts/SKILL.md:18)
- [`skills/client-dev/SKILL.md`](../skills/client-dev/SKILL.md:55)

### 2. One command, many capability kinds

The CLI should not prematurely fragment into many top-level commands such as separate `read` and `prompt` commands.

Instead, [`cvmi call`](../README.md:24) should be designed as a unified interaction surface for:

- tools
- resources
- prompts
- future CVM/MCP capability types

Implementation may start with tools only, but the design and internals must remain capability-generic.

### 3. Help is the main discovery surface

We do not currently require a dedicated [`cvmi inspect`](../README.md:25) command.

The primary discovery flow should be:

- [`cvmi call <server>`](../README.md:24) → compact server summary
- [`cvmi call <server> --help`](../README.md:24) → rich server help + capability listing
- [`cvmi call <server> <capability> --help`](../README.md:24) → capability-specific help

This preserves a small command surface while still allowing rich introspection.

If later experience shows this help model becomes overloaded, a separate inspect-oriented command can be reconsidered. It is not required by the current design.

### 4. Cleaned schemas over raw schema dumps

The default UX should not dump raw JSON Schema or raw MCP/CVM envelopes.

Instead, schemas should be normalized into a CLI-native help view that emphasizes:

- required vs optional inputs
- basic types
- enums
- defaults
- examples

This is consistent with the lazy-discovery and context-compression lessons from [`docs/cheaper-mcp.md`](../docs/cheaper-mcp.md:16) and [`docs/mcp-context.mode.md`](../docs/mcp-context.mode.md:17).

### 5. Human-default, raw-on-demand output

Default output should be parsed and cleaned for terminal use.

[`--raw`](../README.md:24) should mean raw JSON / JSON-RPC output.

Initial output contract:

- default mode: parse result and print clean text / readable structured output
- raw mode: print the protocol-level JSON result envelope

This preserves shell ergonomics while keeping full fidelity available for debugging and scripting.

### 6. Scriptability is first-class

[`cvmi call`](../README.md:24) must be safe for automation.

That implies:

- deterministic stdout behavior
- stderr for logs / warnings / diagnostics
- stable exit code categories
- minimal noise in default output

This principle is reinforced by the CLI-oriented comparison material in [`clihub/docs/project/project.md`](../clihub/docs/project/project.md:11) and [`mcporter/docs/tool-calling.md`](../mcporter/docs/tool-calling.md:11).

### 7. Reuse existing CVMI config conventions

Configuration should follow the precedence already documented in [`README.md`](../README.md:27) and already used by [`src/use.ts`](../src/use.ts:27).

Priority order:

1. CLI flags
2. custom config via `--config`
3. project config `./.cvmi.json`
4. global config `~/.cvmi/config.json`
5. environment variables / runtime defaults as already established by the project

Alias definitions for remote servers should be added through these existing config mechanisms rather than inventing a second configuration system.

## Locked decisions

The following decisions are considered locked for design purposes unless a later written revision supersedes them.

### Locked 1: `cvmi call` is the main user-facing entrypoint

Remote direct interaction should center on [`cvmi call`](../README.md:24), not on a larger family of narrowly scoped top-level commands.

### Locked 2: the design must support more than tools

Even if MVP implementation starts with tools, the design target includes tools, resources, prompts, and future capability types.

### Locked 3: `--help` is the primary introspection interface

The design assumes that help flows can carry server metadata, capability lists, and cleaned schemas.

[`cvmi inspect`](../README.md:25) is optional and not required for the current design.

### Locked 4: `--raw` means raw JSON output

No special alternate raw semantics should be invented. Raw means protocol-shaped JSON output.

### Locked 5: default output should be cleaned

The command should parse protocol responses and print concise user-facing output by default.

### Locked 6: aliases belong in existing config

Alias support should integrate with the established CVMI configuration model rather than a separate alias store.

## Command semantics

### Primary shapes

Recommended command grammar:

```bash
cvmi call <server>
cvmi call <server> --help
cvmi call <server> <capability> [args...]
cvmi call <server> <capability> --help
```

Where:

- `<server>` = pubkey or alias
- `<capability>` = capability selector, optionally kind-qualified

### Capability selector model

Common case should allow unqualified selectors:

```bash
cvmi call weather weather.get_current city=Lisbon
```

When needed, the selector should support explicit kind prefixes:

```bash
cvmi call weather tool:weather.get_current city=Lisbon
cvmi call weather resource:docs://usage
cvmi call weather prompt:summarize_weather city=Lisbon
```

This keeps the UX terse in the common case while preserving room for disambiguation.

### Server summary behavior

[`cvmi call <server>`](../README.md:24) should print a compact summary that may include:

- resolved server name / alias
- canonical pubkey
- description / instructions if available
- selected relays
- encryption mode
- capability groups and counts
- capability names with short descriptions

This output should stay concise.

### Server help behavior

[`cvmi call <server> --help`](../README.md:24) should expand the summary with:

- richer metadata
- usage grammar
- capability lists grouped by kind
- cleaned schema previews
- examples
- alias resolution details if relevant

This is the main discovery surface.

### Capability help behavior

[`cvmi call <server> <capability> --help`](../README.md:24) should include:

- capability name
- capability kind
- description
- cleaned input schema
- required vs optional inputs
- output hint
- examples

## Input model

### Phase-1 input syntax

The simplest initial invocation form should be:

```bash
cvmi call <server> <capability> [key=value ...]
```

Examples:

```bash
cvmi call weather weather.get_current city=Lisbon
cvmi call weather prompt:summarize_weather city=Lisbon days=3
cvmi call weather resource:docs://usage
```

### Reserved future input extensions

The design should explicitly leave room for:

- `--input <file>`
- `--json-input '<json>'`
- `@file` inline value references

These should not be required for the MVP design, but should be considered during parser and API design so they fit naturally later.

### Input precedence

When multiple input mechanisms eventually exist, precedence should be:

1. explicit structured input flag such as `--json-input`
2. file input flag such as `--input`
3. inline `key=value` pairs

## Output model

### Default output

Default output should be capability-kind aware.

#### Tool results

- print text blocks directly when available
- print readable structured output when text is absent
- avoid dumping entire envelopes unless needed

#### Resource results

- print text / markdown directly
- pretty-print structured data where sensible
- keep binary / opaque output summarized until explicit file-output features exist

#### Prompt results

- print messages/prompts in readable textual form
- preserve role/section distinctions if returned

### Raw output

[`--raw`](../README.md:24) should emit protocol-shaped JSON.

Raw mode is primarily for:

- debugging
- exact protocol inspection
- machine post-processing when default rendering is too opinionated

### stdout / stderr policy

- stdout: final command result
- stderr: diagnostics, warnings, connection info, verbose logs

This distinction should be kept strict from the beginning.

## Alias model

Aliases should be defined in the existing CVMI config files documented in [`README.md`](../README.md:27).

Illustrative shape:

```json
{
  "servers": {
    "weather": {
      "pubkey": "npub1...",
      "relays": ["wss://relay.example.com"],
      "encryption": "optional"
    }
  }
}
```

Example usage:

```bash
cvmi call weather weather.get_current city=Lisbon
```

Alias resolution principles:

- alias is optional convenience
- resolved pubkey remains canonical
- alias config may carry relay and encryption defaults
- command help should reveal the resolved pubkey

## Error model

The implementation should distinguish at least these categories:

- invalid target / alias resolution failure
- invalid pubkey format
- relay connection failure
- auth / encryption mismatch
- server unavailable / timeout
- capability not found
- ambiguous capability selector
- invalid user input shape
- protocol error returned by server
- rendering error in client output layer

These categories should later map to stable exit codes and concise error messaging.

## Architectural integration points in CVMI

The current codebase suggests a natural integration path.

### Command routing

[`src/cli.ts`](../src/cli.ts:76) is the main command router and help surface. [`cvmi call`](../README.md:24) will need:

- banner/help registration alongside existing commands in [`src/cli.ts`](../src/cli.ts:58)
- command parsing similar in style to [`serve`](../src/cli.ts:119) and [`use`](../src/cli.ts:135)
- examples added to top-level help

### Shared remote client configuration

[`src/use.ts`](../src/use.ts:27) already demonstrates the pattern for:

- loading config via [`loadConfig`](../src/use.ts:37)
- applying precedence rules
- normalizing / generating private keys
- selecting relays
- constructing signer and transport options

`cvmi call` should reuse the same remote-session foundations where possible rather than inventing a parallel stack.

### Config loading

The config precedence already documented in [`README.md`](../README.md:29) and used in [`src/use.ts`](../src/use.ts:37) should be extended, not replaced.

Likely integration areas:

- [`src/config/index.ts`](../src/use.ts:8)
- [`src/config/loader.ts`](../src/cli.ts:24)

These areas should eventually absorb server-alias and call-specific configuration.

### Crypto and identity utilities

[`src/use.ts`](../src/use.ts:9) already depends on utilities for key generation and normalization. `cvmi call` should reuse that approach for:

- signer creation
- identity normalization
- private key handling

### Result rendering layer

`cvmi call` will require a new rendering layer that is not currently present in [`src/use.ts`](../src/use.ts:27), because [`use`](../src/use.ts:27) proxies stdio rather than rendering capability results.

This likely justifies a dedicated internal module later for:

- capability summary formatting
- cleaned schema rendering
- result rendering by capability kind
- raw JSON emission

### Testing

Based on the current structure in [`AGENTS.md`](../AGENTS.md:21), later development should include tests analogous to other command-focused modules, likely including:

- command parsing tests
- alias resolution tests
- capability selector resolution tests
- result rendering tests
- transport/session behavior tests via mocks

## Internal architecture recommendation

Even if phase 1 only implements tools, internal architecture should be generic around capabilities.

Recommended internal responsibilities:

1. target resolution
   - pubkey / alias resolution
   - relay and encryption config merge

2. remote session bootstrap
   - signer creation
   - relay handler setup
   - ContextVM transport connection
   - MCP initialization

3. capability discovery
   - fetch capabilities by kind
   - normalize them into a common descriptor model

4. selector resolution
   - resolve unqualified selectors
   - detect ambiguity
   - support explicit kind prefixes

5. invocation
   - dispatch to correct MCP method by capability kind

6. rendering
   - default cleaned output
   - raw JSON output
   - help/schema rendering

This will allow [`cvmi use`](../src/use.ts:27) and future direct-call functionality to share lower-level remote client machinery without sharing UX.

## External references informing this design

### Lazy discovery and schema compression

- [`docs/cheaper-mcp.md`](../docs/cheaper-mcp.md:16)
- [`docs/mcp-context.mode.md`](../docs/mcp-context.mode.md:17)

These support the decision to prefer compact summaries and cleaned help over eager raw schema dumps.

### ContextVM protocol and client model

- [`skills/overview/SKILL.md`](../skills/overview/SKILL.md:37)
- [`skills/concepts/SKILL.md`](../skills/concepts/SKILL.md:49)
- [`skills/client-dev/SKILL.md`](../skills/client-dev/SKILL.md:82)
- [`skills/overview/references/protocol-spec.md`](../skills/overview/references/protocol-spec.md:20)

These support the pubkey-first, Nostr-native, MCP-over-transport model.

### CLI ergonomics references

- [`mcporter/docs/tool-calling.md`](../mcporter/docs/tool-calling.md:11)
- [`mcporter/docs/call-syntax.md`](../mcporter/docs/call-syntax.md:19)
- [`clihub/docs/project/project.md`](../clihub/docs/project/project.md:23)

These support the emphasis on shell-friendly invocation, rich `--help`, and scriptable output.

## Proposed phased development path

### Phase 0: spec lock

Before implementation, confirm and document:

- server target grammar
- capability selector grammar
- alias config shape
- help rendering rules
- cleaned schema formatting rules
- output rules for default vs raw
- ambiguity and error behavior

### Phase 1: tools-only MVP on top of generic design

Implement:

- bare server summary
- server `--help`
- tool `--help`
- tool invocation via `key=value`
- raw JSON output
- alias resolution from config

Important constraint: even this phase should avoid tool-specific naming in core internal abstractions where generic capability naming is possible.

### Phase 2: extend the same command to resources and prompts

Implement:

- capability-kind discovery
- kind-prefixed selectors where needed
- resource default rendering
- prompt default rendering

### Phase 3: ergonomic extensions

Potential additions:

- `--input`
- `--json-input`
- output-saving helpers
- shell completion
- ambiguity suggestions
- metadata caching

## Open questions

These are not locked yet and should remain visible during later planning:

1. Should capability selectors allow both `kind:name` and `kind name` forms, or only one?
2. How aggressive should default scalar coercion be for `key=value` inputs?
3. Should aliases live under a top-level `servers` key or a command-specific `call` section in config?
4. How much server metadata should be shown in bare summary output before it becomes too verbose?
5. Do resources need an explicit file-output flag earlier than other capability kinds?

## Summary

[`cvmi call`](../README.md:24) should be designed as the universal direct-client entrypoint for ContextVM servers: one command, pubkey-or-alias addressed, capability-aware, help-driven, clean by default, and raw when requested.

The design must stay broader than tools even if implementation starts there. Discovery should primarily flow through help. Aliases should integrate with existing config. Internally, the architecture should be generic around capability discovery, selector resolution, invocation, and rendering.

This gives CVMI a coherent path from installer/proxy utility to full CVM-native client while preserving a small and learnable CLI surface.
