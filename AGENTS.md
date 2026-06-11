# AGENTS.md

This file provides guidance to AI coding agents working on the `cvmi` CLI codebase.

## Project Overview

`cvmi` is the CLI for the ContextVM ecosystem.

## Commands

| Command              | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `cvmi`               | Show banner with available commands                       |
| `cvmi add <pkg>`     | Install skills from git repos, URLs, or local paths       |
| `cvmi pack`          | Package an MCP server into a distributable `.mcpb` bundle |
| `cvmi check`         | Check for available skill updates                         |
| `cvmi update`        | Update all skills to latest versions                      |
| `cvmi pn` / `cn`     | Compile a server to TypeScript code                       |
| `cvmi generate-lock` | Match installed skills to sources via API                 |

Aliases: `cvmi a`, `cvmi i`, `cvmi install` all work for `add`.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, init/check/update
├── cli.test.ts      # CLI tests
├── pack.ts          # Pack command implementation
├── pack/            # Pack utilities (extract, cvm-manifest, pack-init)
├── add.ts           # Core add command logic
├── add.test.ts      # Add command tests
├── cn/              # Client generation (ctxcn) module
├── list.ts          # List installed skills command
├── list.test.ts     # List command tests
├── agents.ts        # Agent definitions and detection
├── installer.ts     # Skill installation logic (symlink/copy) + listInstalledSkills
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Lock file management
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── types.ts         # TypeScript types
├── mintlify.ts      # Mintlify skill fetching (legacy)
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   └── mintlify.ts
├── init.test.ts     # Init command tests
└── test-utils.ts    # Test utilities

tests/
├── sanitize-name.test.ts     # Tests for sanitizeName (path traversal prevention)
├── skill-matching.test.ts    # Tests for filterSkills (multi-word skill name matching)
├── source-parser.test.ts     # Tests for URL/path parsing
├── installer-symlink.test.ts # Tests for symlink installation
├── list-installed.test.ts    # Tests for listing installed skills
├── skill-path.test.ts        # Tests for skill path handling
├── wellknown-provider.test.ts # Tests for well-known provider
└── dist.test.ts              # Tests for built distribution
```

## Update Checking System

### How `cvmi check` and `cvmi update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. For each skill, get `skillFolderHash` from lock file
3. POST to `https://add-skill.vercel.sh/check-updates` with:
   ```json
   {
     "skills": [{ "name": "...", "source": "...", "skillFolderHash": "..." }],
     "forceRefresh": true
   }
   ```
4. API fetches fresh content from GitHub, computes hash, compares
5. Returns list of skills with different hashes (updates available)

### Why `forceRefresh: true`?

Both `cvmi check` and `cvmi update` always send `forceRefresh: true`. This ensures the API fetches fresh content from GitHub rather than using its Redis cache.

**Without forceRefresh:** Users saw phantom "updates available" due to stale cached hashes. The fix was to always fetch fresh.

**Tradeoff:** Slightly slower (GitHub API call per skill), but always accurate.

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature              | Implementation                              |
| -------------------- | ------------------------------------------- |
| `cvmi add`           | `src/add.ts` - full implementation          |
| `cvmi check`         | `POST /check-updates` API                   |
| `cvmi update`        | `POST /check-updates` + reinstall per skill |
| `cvmi generate-lock` | `POST /api/skills/search` on skills.sh      |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add contextvm/cvmi --list
pnpm dev check
pnpm dev update

# Run all tests
pnpm test

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts
pnpm test tests/skill-matching.test.ts tests/source-parser.test.ts

# Type check
pnpm type-check

# Format code
pnpm format
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm prettier --check .
```

CI will fail if code is not properly formatted.

## Publishing

```bash
# 1. Bump version in package.json
# 2. Build
pnpm build
# 3. Publish
npm publish
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
