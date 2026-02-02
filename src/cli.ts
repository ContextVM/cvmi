#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { track } from './telemetry.ts';
import { serve, showServeHelp } from './serve.ts';
import { showUseHelp, use } from './use.ts';
import { parseEncryptionMode } from './config/loader.ts';
import type { EncryptionMode } from '@contextvm/sdk';
import { BOLD, DIM, GRAYS, LOGO_LINES, RESET, TEXT } from './constants/ui.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CVMI canonical remote for embedded skills
const CVMI_CANONICAL_REPO = 'contextvm/cvmi';

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}CVMI - A cli for the cvm ecosystem${RESET}`);
  console.log();
  const entries: [string, string][] = [
    ['npx cvmi add [options]', 'Install ContextVM skills'],
    ['npx cvmi serve [options] -- <cmd>', 'Expose MCP server over Nostr'],
    ['npx cvmi use <pubkey>', 'Connect to Nostr MCP server'],
    ['npx cvmi check', 'Check for updates'],
    ['npx cvmi update', 'Update all skills'],
  ];
  const maxCmdLen = Math.max(...entries.map(([cmd]) => cmd.length));
  for (const [cmd, desc] of entries) {
    console.log(
      `  ${DIM}$${RESET} ${TEXT}${cmd}${RESET}${' '.repeat(maxCmdLen - cmd.length + 3)}${DIM}${desc}${RESET}`
    );
  }
  console.log();
  console.log(`${DIM}try:${RESET} npx cvmi add`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi <command> [options]

${BOLD}Commands:${RESET}
  add [package]     Add a skill package
                      (no args: installs embedded ContextVM skills)
                      e.g. contextvm/cvmi
                           https://github.com/contextvm/cvmi
  remove, rm, r     Remove installed skills
  list, ls          List installed skills
  serve             Expose an MCP server over Nostr
  use               Connect to a remote Nostr MCP server
  check             Check for available skill updates
  update            Update all skills to latest versions

${BOLD}Add Options:${RESET}
  -g, --global           Install skill globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify skill names to install (use '*' for all skills)
  -l, --list             List available skills in the repository without installing
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify skills to remove (use '*' for all skills)
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
   
${BOLD}List Options:${RESET}
  -g, --global           List global skills (default: project)
  -a, --agent <agents>   Filter by specific agents

${BOLD}Serve Usage:${RESET}
  cvmi serve [options] -- <mcp-server-command> [args...]
  cvmi serve <mcp-server-command> [args...] [options]

${BOLD}Serve Options:${RESET}
  --config <path>        Path to custom config JSON file (overrides global config)
  --private-key <key>    Nostr private key (hex format, auto-generated if not provided)
  --relays <urls>        Comma-separated relay URLs (default: wss://relay.contextvm.org,wss://cvm.otherstuff.ai)
  --public               Make server publicly accessible
  --encryption-mode      Encryption mode: optional, required, disabled
  --verbose              Enable verbose logging

  ${BOLD}Tip:${RESET} Use ${BOLD}--${RESET} to separate cvmi flags from the server command.
       Example: cvmi serve --verbose -- npx -y server --help

${BOLD}Use Usage:${RESET}
  cvmi use <server-pubkey>

${BOLD}Use Options:${RESET}
  --config <path>        Path to custom config JSON file (overrides global config)
  --private-key <key>    Nostr private key (hex format, auto-generated if not provided)
  --relays <urls>        Comma-separated relay URLs (default: wss://relay.contextvm.org,wss://cvm.otherstuff.ai)
  --encryption-mode      Encryption mode: optional, required, disabled
  --verbose              Enable verbose logging

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi add                          ${DIM}# install embedded ContextVM skills${RESET}
  ${DIM}$${RESET} cvmi add --skill overview ${DIM}# install specific skill${RESET}
  ${DIM}$${RESET} cvmi add contextvm/cvmi -g        ${DIM}# install from repo, global${RESET}
  ${DIM}$${RESET} cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp ${DIM}# start gateway${RESET}
  ${DIM}$${RESET} cvmi use <server-pubkey>          ${DIM}# connect to remote MCP server${RESET}
  ${DIM}$${RESET} cvmi list
  ${DIM}$${RESET} cvmi list -g
  ${DIM}$${RESET} cvmi check
  ${DIM}$${RESET} cvmi update
  `);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi remove <skill> [options]

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope (default: project)
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -y, --yes              Skip confirmation prompts
  --all                  Remove all skills

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi remove skill-name            ${DIM}# remove a specific skill${RESET}
  ${DIM}$${RESET} cvmi remove skill-one skill-two  ${DIM}# remove multiple skills${RESET}
  ${DIM}$${RESET} cvmi remove --all -y              ${DIM}# remove all skills without prompt${RESET}
  ${DIM}$${RESET} cvmi remove --global skill-name   ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} cvmi rm -g skill-name             ${DIM}# using alias, remove globally${RESET}

${BOLD}Aliases:${RESET} rm, r
  `);
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CHECK_UPDATES_API_URL = 'https://add-skill.vercel.sh/check-updates';
const CURRENT_LOCK_VERSION = 3; // Bumped from 2 to 3 for folder hash support

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

interface CheckUpdatesRequest {
  skills: Array<{
    name: string;
    source: string;
    path?: string;
    skillFolderHash: string;
  }>;
}

interface CheckUpdatesResponse {
  updates: Array<{
    name: string;
    source: string;
    currentHash: string;
    latestHash: string;
  }>;
  errors?: Array<{
    name: string;
    source: string;
    error: string;
  }>;
}

function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

async function runCheck(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx cvmi add <package>${RESET}`);
    return;
  }

  const checkRequest: CheckUpdatesRequest = {
    skills: [],
  };

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (e.g., private repos where API can't fetch hash)
    if (!entry.skillFolderHash) {
      continue;
    }

    checkRequest.skills.push({
      name: skillName,
      source: entry.source,
      path: entry.skillPath,
      skillFolderHash: entry.skillFolderHash,
    });
  }

  if (checkRequest.skills.length === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  console.log(`${DIM}Checking ${checkRequest.skills.length} skill(s) for updates...${RESET}`);

  try {
    const response = await fetch(CHECK_UPDATES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkRequest),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as CheckUpdatesResponse;

    console.log();

    if (data.updates.length === 0) {
      console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    } else {
      console.log(`${TEXT}${data.updates.length} update(s) available:${RESET}`);
      console.log();
      for (const update of data.updates) {
        console.log(`  ${TEXT}↑${RESET} ${update.name}`);
        console.log(`    ${DIM}source: ${update.source}${RESET}`);
      }
      console.log();
      console.log(
        `${DIM}Run${RESET} ${TEXT}npx cvmi update${RESET} ${DIM}to update all skills${RESET}`
      );
    }

    if (data.errors && data.errors.length > 0) {
      console.log();
      console.log(
        `${DIM}Could not check ${data.errors.length} skill(s) (may need reinstall)${RESET}`
      );
    }

    // Track telemetry
    track({
      event: 'check',
      skillCount: String(checkRequest.skills.length),
      updatesAvailable: String(data.updates.length),
    });
  } catch (error) {
    console.log(
      `${TEXT}Error checking for updates:${RESET} ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }

  console.log();
}

async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx cvmi add <package>${RESET}`);
    return;
  }

  const checkRequest: CheckUpdatesRequest = {
    skills: [],
  };

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (e.g., private repos where API can't fetch hash)
    if (!entry.skillFolderHash) {
      continue;
    }

    checkRequest.skills.push({
      name: skillName,
      source: entry.source,
      path: entry.skillPath,
      skillFolderHash: entry.skillFolderHash,
    });
  }

  if (checkRequest.skills.length === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  let updates: CheckUpdatesResponse['updates'] = [];
  try {
    const response = await fetch(CHECK_UPDATES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkRequest),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as CheckUpdatesResponse;
    updates = data.updates;
  } catch (error) {
    console.log(
      `${TEXT}Error checking for updates:${RESET} ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  // Reinstall each skill that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    const entry = lock.skills[update.name];
    if (!entry) continue;

    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    // Use cvmi CLI to reinstall with -g -y flags
    const result = spawnSync(
      'npx',
      ['-y', 'cvmi', entry.sourceUrl, '--skill', update.name, '-g', '-y'],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
      }
    );

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
    }
  }

  console.log();
  if (successCount > 0) {
    console.log(`${TEXT}✓ Updated ${successCount} skill(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} skill(s)${RESET}`);
  }

  // Track telemetry
  track({
    event: 'update',
    skillCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

  console.log();
}

// ============================================
// CLI Parsers for serve/use
// ============================================

interface ServeParseResult {
  serverArgs: string[];
  verbose: boolean;
  privateKey: string | undefined;
  relays: string[] | undefined;
  public: boolean;
  encryption: EncryptionMode | undefined;
  config: string | undefined;
  unknownFlags: string[];
}

interface UseParseResult {
  serverPubkey: string | undefined;
  verbose: boolean;
  privateKey: string | undefined;
  relays: string[] | undefined;
  encryption: EncryptionMode | undefined;
  config: string | undefined;
  unknownFlags: string[];
}

/**
 * Parse CLI arguments for the serve command.
 *
 * Conventions:
 * - Prefer using `--` to separate cvmi flags from server command+args.
 *   Example: cvmi serve --verbose -- npx -y server --help
 * - Before `--`, only recognized cvmi flags are allowed (unknown flags become errors).
 * - After `--`, everything is treated as server command+args.
 *
 * Back-compat:
 * - If `--` is not present, recognized cvmi flags are parsed anywhere.
 * - Unknown double-dash flags are collected as unknownFlags for errors.
 * - Single-dash tokens (like -y) and non-flag tokens are treated as server args.
 */
function parseServeArgs(args: string[]): ServeParseResult {
  const result: ServeParseResult = {
    serverArgs: [],
    verbose: false,
    privateKey: undefined,
    relays: undefined,
    public: false,
    encryption: undefined,
    config: undefined,
    unknownFlags: [],
  };

  const separatorIndex = args.indexOf('--');
  const beforeSeparator = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
  const afterSeparator = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

  // If the user uses `--`, treat everything after as server args.
  if (afterSeparator.length > 0) {
    result.serverArgs.push(...afterSeparator);
  }

  for (let i = 0; i < beforeSeparator.length; i++) {
    const arg = beforeSeparator[i] ?? '';

    // Helper to consume next value with validation
    const consumeValue = (flagName: string): string | undefined => {
      const nextIndex = ++i;
      const value = beforeSeparator[nextIndex];
      if (value === undefined || value.startsWith('--')) {
        result.unknownFlags.push(`${flagName} (missing value)`);
        // Roll back index if we hit another flag
        if (value?.startsWith('--')) i--;
        return undefined;
      }
      return value;
    };

    // Recognized cvmi flags - consume them regardless of position
    if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--public') {
      result.public = true;
    } else if (arg === '--private-key') {
      result.privateKey = consumeValue('--private-key');
    } else if (arg === '--relays') {
      const value = consumeValue('--relays');
      result.relays = value ? value.split(',').map((r) => r.trim()) : undefined;
    } else if (arg === '--encryption-mode') {
      const value = consumeValue('--encryption-mode');
      result.encryption = parseEncryptionMode(value, 'CLI flag --encryption-mode');
    } else if (arg === '--config') {
      result.config = consumeValue('--config');
    } else if (arg === '--help' || arg === '-h') {
      // Handled at call site
    } else if (arg.startsWith('--')) {
      // Unknown double-dash flag - collect for error reporting
      result.unknownFlags.push(arg);
    } else {
      // If `--` was used, any non-flag args before separator are suspicious.
      // Keep behavior strict to avoid surprising splits.
      if (separatorIndex !== -1) {
        result.unknownFlags.push(arg);
      } else {
        // Back-compat: Single-dash tokens (like -y) and non-flag arguments are server args
        result.serverArgs.push(arg);
      }
    }
  }

  return result;
}

/**
 * Parse CLI arguments for the use command.
 * Handles flags in any order and identifies the positional server pubkey.
 * Reports unknown flags for strict validation.
 */
function parseUseArgs(args: string[]): UseParseResult {
  const result: UseParseResult = {
    serverPubkey: undefined,
    verbose: false,
    privateKey: undefined,
    relays: undefined,
    encryption: undefined,
    config: undefined,
    unknownFlags: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    // Helper to consume next value with validation
    const consumeValue = (flagName: string): string | undefined => {
      const nextIndex = ++i;
      const value = args[nextIndex];
      if (value === undefined || value.startsWith('--')) {
        result.unknownFlags.push(`${flagName} (missing value)`);
        // Roll back index if we hit another flag
        if (value?.startsWith('--')) i--;
        return undefined;
      }
      return value;
    };

    if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--private-key') {
      result.privateKey = consumeValue('--private-key');
    } else if (arg === '--relays') {
      const value = consumeValue('--relays');
      result.relays = value ? value.split(',').map((r) => r.trim()) : undefined;
    } else if (arg === '--encryption-mode') {
      const value = consumeValue('--encryption-mode');
      result.encryption = parseEncryptionMode(value, 'CLI flag --encryption-mode');
    } else if (arg === '--server-pubkey') {
      result.serverPubkey = consumeValue('--server-pubkey');
    } else if (arg === '--config') {
      result.config = consumeValue('--config');
    } else if (arg === '--help' || arg === '-h') {
      // Handled at call site
    } else if (arg.startsWith('-')) {
      // Unknown flag - collect for error reporting
      result.unknownFlags.push(arg);
    } else {
      // First non-flag argument is the server pubkey (if not already set via --server-pubkey)
      result.serverPubkey = result.serverPubkey ?? arg;
    }
  }

  return result;
}

// Exported for tests only (keeps parsing logic single-sourced).
export const __test__ = {
  parseServeArgs,
  parseUseArgs,
};

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source, options } = parseAddOptions(restArgs);

      // CVMI v0: If no source is provided, default to canonical remote with embedded skills subpath
      const useEmbeddedSkills = source.length === 0;
      const effectiveSource = useEmbeddedSkills ? CVMI_CANONICAL_REPO : source[0]!;

      await runAdd([effectiveSource], options, useEmbeddedSkills);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
      runCheck();
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
      break;
    case 'serve': {
      // Check for --help or -h flag (only before `--` separator)
      const serveSeparatorIndex = restArgs.indexOf('--');
      const serveArgsBeforeSeparator =
        serveSeparatorIndex === -1 ? restArgs : restArgs.slice(0, serveSeparatorIndex);
      if (serveArgsBeforeSeparator.includes('--help') || serveArgsBeforeSeparator.includes('-h')) {
        showServeHelp();
        break;
      }
      const parsed = parseServeArgs(restArgs);

      // Handle unknown flags
      if (parsed.unknownFlags.length > 0) {
        console.error(`Unknown flag(s): ${parsed.unknownFlags.join(', ')}`);
        console.error(`Run 'cvmi serve --help' for usage.`);
        process.exit(1);
      }

      await serve(parsed.serverArgs, {
        verbose: parsed.verbose,
        privateKey: parsed.privateKey,
        relays: parsed.relays,
        public: parsed.public,
        encryption: parsed.encryption,
        config: parsed.config,
      });
      break;
    }
    case 'use': {
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showUseHelp();
        break;
      }
      const parsed = parseUseArgs(restArgs);

      // Handle unknown flags
      if (parsed.unknownFlags.length > 0) {
        console.error(`Unknown flag(s): ${parsed.unknownFlags.join(', ')}`);
        console.error(`Run 'cvmi use --help' for usage.`);
        process.exit(1);
      }

      await use(parsed.serverPubkey, {
        verbose: parsed.verbose,
        privateKey: parsed.privateKey,
        relays: parsed.relays,
        encryption: parsed.encryption,
        config: parsed.config,
      });
      break;
    }
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}cvmi --help${RESET} for usage.`);
  }
}

main().catch((err) => {
  // Ensure commands fail with a non-zero exit code (useful for scripting).
  // Note: This does not change SIGINT/SIGTERM behavior for long-running commands.
  console.error(err);
  process.exit(1);
});
