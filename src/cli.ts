#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { track } from './telemetry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CVMI canonical remote for embedded skills
const CVMI_CANONICAL_REPO = 'contextvm/cvmi';
const EMBEDDED_SKILLS_SUBPATH = 'skills';

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

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const LOGO_LINES = [
  ' ▄▄·  ▌ ▐·• ▌ ▄ ·. ▪  ',
  '▐█ ▌▪▪█·█▌·██ ▐███▪██ ',
  '██ ▄▄▐█▐█•▐█ ▌▐▌▐█·▐█·',
  '▐███▌ ███ ██ ██▌▐█▌▐█▌',
  '·▀▀▀ . ▀  ▀▀  █▪▀▀▀▀▀▀',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}ContextVM Interface - The open agent skills ecosystem${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx cvmi add ${DIM}[options]${RESET}       ${DIM}Install ContextVM skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx cvmi add ${DIM}<source>${RESET}       ${DIM}Install skills from a repository${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx cvmi check${RESET}            ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx cvmi update${RESET}           ${DIM}Update all skills${RESET}`
  );
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

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi add                          ${DIM}# install embedded ContextVM skills${RESET}
  ${DIM}$${RESET} cvmi add --skill contextvm-overview ${DIM}# install specific skill${RESET}
  ${DIM}$${RESET} cvmi add contextvm/cvmi -g        ${DIM}# install from repo, global${RESET}
  ${DIM}$${RESET} cvmi add vercel-labs/agent-skills
  ${DIM}$${RESET} cvmi add vercel-labs/agent-skills -g
  ${DIM}$${RESET} cvmi add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} cvmi add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} cvmi check
  ${DIM}$${RESET} cvmi update
  ${DIM}$${RESET} cvmi generate-lock --dry-run
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

function writeSkillLock(lock: SkillLockFile): void {
  const lockPath = getSkillLockPath();
  const dir = join(homedir(), AGENTS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

async function runCheck(args: string[] = []): Promise<void> {
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
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
      break;
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

main();
