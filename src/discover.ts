import * as p from '@clack/prompts';
import { nip19, SimplePool, type Event } from 'nostr-tools';
import { DEFAULT_RELAYS } from './config/index.ts';
import { BOLD, CYAN, DIM, RESET } from './constants/ui.ts';

const SERVER_ANNOUNCEMENT_KIND = 11316;
const DISCOVER_TIMEOUT_MS = 4000;

export interface DiscoverOptions {
  relays?: string[];
  raw?: boolean;
  verbose?: boolean;
  limit?: number;
}

export interface ParseDiscoverResult {
  raw: boolean;
  verbose: boolean;
  relays: string[] | undefined;
  limit: number | undefined;
  help: boolean;
  unknownFlags: string[];
}

interface DiscoveredServer {
  pubkey: string;
  relays: string[];
  name?: string;
  about?: string;
  website?: string;
  supportsEncryption?: boolean;
  eventId: string;
  createdAt: number;
}

function formatDisplayPubkey(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

function parseAnnouncement(event: Event, relay: string): DiscoveredServer {
  let content: Record<string, unknown> = {};
  try {
    content = event.content ? (JSON.parse(event.content) as Record<string, unknown>) : {};
  } catch {
    content = {};
  }

  const tagValue = (name: string): string | undefined => {
    const match = event.tags.find((tag) => tag[0] === name);
    return typeof match?.[1] === 'string' ? match[1] : undefined;
  };

  const nestedInfo =
    content.serverInfo && typeof content.serverInfo === 'object'
      ? (content.serverInfo as Record<string, unknown>)
      : undefined;

  const name =
    (typeof content.name === 'string' ? content.name : undefined) ??
    (typeof nestedInfo?.name === 'string' ? nestedInfo.name : undefined) ??
    tagValue('name');
  const about =
    (typeof content.about === 'string' ? content.about : undefined) ??
    (typeof nestedInfo?.about === 'string' ? nestedInfo.about : undefined) ??
    tagValue('about');
  const website =
    (typeof content.website === 'string' ? content.website : undefined) ??
    (typeof nestedInfo?.website === 'string' ? nestedInfo.website : undefined) ??
    tagValue('website');
  const supportsEncryption =
    tagValue('support_encryption') === 'true' ||
    content.support_encryption === true ||
    nestedInfo?.support_encryption === true;

  return {
    pubkey: event.pubkey,
    relays: [relay],
    name,
    about,
    website,
    supportsEncryption,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

function mergeServers(
  existing: DiscoveredServer | undefined,
  incoming: DiscoveredServer
): DiscoveredServer {
  if (!existing) return incoming;

  const latest = incoming.createdAt >= existing.createdAt ? incoming : existing;
  return {
    ...latest,
    relays: [...new Set([...existing.relays, ...incoming.relays])],
    name: latest.name ?? existing.name,
    about: latest.about ?? existing.about,
    website: latest.website ?? existing.website,
    supportsEncryption: latest.supportsEncryption ?? existing.supportsEncryption,
  };
}

function printSection(title: string): void {
  console.log(`${BOLD}${title}${RESET}`);
}

function printSummaryRow(label: string, value: string, indent = ''): void {
  console.log(`${indent}${DIM}${label}:${RESET} ${value}`);
}

export function parseDiscoverArgs(args: string[]): ParseDiscoverResult {
  const result: ParseDiscoverResult = {
    raw: false,
    verbose: false,
    relays: undefined,
    limit: undefined,
    help: false,
    unknownFlags: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    const consumeValue = (flagName: string): string | undefined => {
      const nextIndex = ++i;
      const value = args[nextIndex];
      if (value === undefined || value.startsWith('--')) {
        result.unknownFlags.push(`${flagName} (missing value)`);
        if (value?.startsWith('--')) i--;
        return undefined;
      }
      return value;
    };

    if (arg === '--raw') {
      result.raw = true;
    } else if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--relays') {
      const value = consumeValue('--relays');
      result.relays = value ? value.split(',').map((relay) => relay.trim()) : undefined;
    } else if (arg === '--limit') {
      const value = consumeValue('--limit');
      if (!value || !/^\d+$/.test(value)) {
        result.unknownFlags.push(`--limit${value ? ` (${value})` : ''}`);
      } else {
        result.limit = Number(value);
      }
    } else if (arg.startsWith('--')) {
      result.unknownFlags.push(arg);
    } else {
      result.unknownFlags.push(arg);
    }
  }

  return result;
}

async function queryRelay(relay: string): Promise<DiscoveredServer[]> {
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(
      [relay],
      { kinds: [SERVER_ANNOUNCEMENT_KIND] },
      { maxWait: DISCOVER_TIMEOUT_MS }
    );
    return events.map((event) => parseAnnouncement(event, relay));
  } finally {
    pool.close([relay]);
  }
}

export async function discover(options: DiscoverOptions): Promise<void> {
  const relays = options.relays?.length ? options.relays : DEFAULT_RELAYS;
  const spinner = !options.raw ? p.spinner() : null;

  if (options.verbose && !options.raw) {
    p.log.message(`Relays: ${relays.join(', ')}`);
  }

  spinner?.start('Discovering announced servers...');

  const merged = new Map<string, DiscoveredServer>();
  for (const relay of relays) {
    const servers = await queryRelay(relay);
    for (const server of servers) {
      merged.set(server.pubkey, mergeServers(merged.get(server.pubkey), server));
    }
  }

  let results = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  if (options.limit !== undefined) {
    results = results.slice(0, options.limit);
  }

  spinner?.stop(`Found ${results.length} announced server${results.length === 1 ? '' : 's'}`);

  if (options.raw) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printSection('Servers');
  for (const server of results) {
    console.log(`  ${CYAN}•${RESET} ${server.name ?? formatDisplayPubkey(server.pubkey)}`);
    printSummaryRow('Identity', formatDisplayPubkey(server.pubkey), '    ');
    printSummaryRow('Relays', server.relays.join(', '), '    ');
    if (server.about) {
      printSummaryRow('About', server.about, '    ');
    }
    if (server.website) {
      printSummaryRow('Website', server.website, '    ');
    }
    if (server.supportsEncryption) {
      printSummaryRow('Encryption', 'supported', '    ');
    }
    printSummaryRow('Try', `cvmi call ${formatDisplayPubkey(server.pubkey)} --help`, '    ');
  }

  if (results.length === 0) {
    console.log(`  ${DIM}(no public server announcements found)${RESET}`);
  }
}

export function showDiscoverHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi discover [options]

${BOLD}Description:${RESET}
  Query relays for public ContextVM server announcements (kind 11316).

${BOLD}Options:${RESET}
  --relays <urls>         Comma-separated relay URLs (default: wss://relay.contextvm.org,wss://cvm.otherstuff.ai)
  --limit <n>             Limit the number of returned servers
  --raw                   Print raw JSON results
  --verbose               Enable verbose logging
  --help, -h              Show this help message

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi discover
  ${DIM}$${RESET} cvmi discover --relays wss://relay.contextvm.org
  ${DIM}$${RESET} cvmi discover --limit 10
  ${DIM}$${RESET} cvmi discover --raw
  `);
}
