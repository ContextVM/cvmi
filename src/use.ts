/**
 * Use command - connects to a remote MCP server over Nostr (proxy functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NostrMCPProxy, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import type { ClientPaymentsOptions, PaymentInteractionMode } from '@contextvm/sdk/payments';
import { SimplePool, type Event } from 'nostr-tools';
import { loadConfig, getUseConfig, DEFAULT_RELAYS } from './config/index.ts';
import { announcementHexPubkey, SERVER_ANNOUNCEMENT_KIND } from './discover.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { waitForShutdownSignal } from './utils/process.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';
import { savePrivateKeyToEnv } from './config/loader.ts';

/** CLI options for the use command */
export interface UseOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  encryption?: EncryptionMode;
  verbose?: boolean;
  persistPrivateKey?: boolean;
  paymentMode?: PaymentInteractionMode;
}

function resolveProxyPaymentOptions(
  paymentMode: PaymentInteractionMode | undefined
): ClientPaymentsOptions | undefined {
  return paymentMode ? { paymentInteraction: paymentMode } : undefined;
}

const PAYMENT_DISCOVERY_TIMEOUT_MS = 4000;

type AnnouncementLookup = (
  relays: string[],
  serverPubkey: string,
  maxWaitMs: number
) => Promise<Event | undefined>;

async function lookupLatestServerAnnouncement(
  relays: string[],
  serverPubkey: string,
  maxWaitMs: number
): Promise<Event | undefined> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [SERVER_ANNOUNCEMENT_KIND], authors: [serverPubkey] },
      { maxWait: maxWaitMs }
    );
    return events.sort((left, right) => right.created_at - left.created_at)[0];
  } finally {
    pool.close(relays);
  }
}

function announcementSupportsExplicitGating(event: Event): boolean {
  // CEP-8: a gating-capable server advertises ['payment_interaction',
  // 'explicit_gating'] as an availability tag on its announcement.
  return event.tags.some((tag) => tag[0] === 'payment_interaction' && tag[1] === 'explicit_gating');
}

/**
 * Default payment interaction for `use`: request explicit gating only when the
 * server's announcement advertises it. Otherwise leave negotiation unset —
 * free/legacy/transparent-only servers keep working (a transparent-only server
 * outright rejects an explicit_gating request), and a priced tool surfaces a
 * clean -32042 error an agent host can relay instead of an unwatched invoice.
 */
async function resolveDefaultPaymentMode(
  relays: string[],
  serverPubkey: string,
  lookup: AnnouncementLookup = lookupLatestServerAnnouncement
): Promise<PaymentInteractionMode | undefined> {
  try {
    const announcement = await lookup(
      relays,
      announcementHexPubkey(serverPubkey),
      PAYMENT_DISCOVERY_TIMEOUT_MS
    );
    return announcement && announcementSupportsExplicitGating(announcement)
      ? 'explicit_gating'
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the use command.
 */
export async function use(serverPubkeyArg: string | undefined, options: UseOptions): Promise<void> {
  // Parse CLI flags inline (config is handled separately)
  const cliFlags = {
    privateKey: options.privateKey,
    relays: options.relays,
    encryption: options.encryption,
    persistPrivateKey: options.persistPrivateKey,
  };

  // Load configuration from all sources (CLI flags have highest priority)
  const config = await loadConfig({ use: cliFlags }, options.config);
  const useConfig = getUseConfig(config.use || {});

  // Get server public key early (before generating keys)
  // Priority: CLI argument > config.serverPubkey > error
  const serverPubkey = serverPubkeyArg ?? useConfig.serverPubkey;
  if (!serverPubkey) {
    showUseHelp();
    process.exit(1);
  }

  // Auto-generate private key if not provided
  let privateKey = useConfig.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    p.log.info('Generated new private key');
  }

  // Validate/normalize key (accepts hex, 0x-hex, or nsec...)
  privateKey = normalizePrivateKey(privateKey);

  // Persist to .env file if flag is set
  if (options.persistPrivateKey) {
    try {
      await savePrivateKeyToEnv('use', privateKey);
      p.log.info(`Private key persisted to .env file (CVMI_USE_PRIVATE_KEY)`);
    } catch (error) {
      p.log.warn(
        `Failed to persist private key: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Use default relays if none specified
  const relays = useConfig.relays?.length ? useConfig.relays : DEFAULT_RELAYS;

  // Create signer
  const signer = new PrivateKeySigner(privateKey);
  const publicKey = await signer.getPublicKey();
  p.log.info('🔑 Public key: ' + publicKey);
  p.log.info('');

  if (options.verbose) {
    p.log.message(`Connecting to server: ${serverPubkey}`);
    p.log.message(`Relays: ${relays.join(', ')}`);
  }

  // Create stdio transport for MCP host
  const mcpTransport = new StdioServerTransport();

  // Payment default is announcement-driven: explicit gating is requested only
  // when the server advertises support (CEP-8), otherwise negotiation stays
  // unset for compatibility with free, legacy, and transparent-only servers.
  const paymentMode =
    options.paymentMode ?? (await resolveDefaultPaymentMode(relays, serverPubkey));
  if (options.verbose) {
    p.log.message(`Payment interaction: ${paymentMode ?? 'transparent (server default)'}`);
  }
  const paymentOptions = resolveProxyPaymentOptions(paymentMode);
  const proxy = new NostrMCPProxy({
    mcpHostTransport: mcpTransport,
    nostrTransportOptions: {
      signer,
      relayHandler: relays,
      serverPubkey,
      encryptionMode: useConfig.encryption,
      logLevel: options.verbose ? 'debug' : 'info',
    },
    ...(paymentOptions ? { paymentOptions } : {}),
  });

  // Start proxy
  await proxy.start();
  p.outro(pc.green('Proxy started. Press Ctrl+C to stop.'));

  // Keep running until asked to shut down.
  const signal = await waitForShutdownSignal();
  p.log.message(`\n${signal} received. Shutting down...`);
  await proxy.stop();

  process.exit(0);
}

export function showUseHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi use <server-pubkey> [options]

${BOLD}Description:${RESET}
  Connect to a remote MCP server over Nostr and expose it locally via stdio.
  This allows you to use remote MCP servers as if they were local.

${BOLD}Arguments:${RESET}
  <server-pubkey>         The server identity (hex, npub, or nprofile) of the remote MCP server
                           Can also be specified in config file under use.serverPubkey

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, overrides env, auto-generated if not provided)
  --persist-private-key   Save private key to .env file for future use
  --relays <urls>         Comma-separated relay URLs (default: wss://relay.contextvm.org)
  --encryption-mode       Encryption mode: optional, required, disabled (default: optional)
  --payment-mode          Payment interaction: transparent | explicit_gating (auto-detected by default)
  --verbose               Enable verbose logging
  --help, -h              Show this help message

  ${BOLD}Configuration Sources (priority: CLI > custom config (--config) > project .cvmi.json > global ~/.cvmi/config.json > env vars):${RESET}
  Environment variables:
     CVMI_USE_PRIVATE_KEY, CVMI_PROXY_PRIVATE_KEY
     CVMI_USE_RELAYS, CVMI_PROXY_RELAYS
    CVMI_USE_SERVER_PUBKEY, CVMI_PROXY_SERVER_PUBKEY
    CVMI_USE_ENCRYPTION, CVMI_PROXY_ENCRYPTION

${BOLD}SDK Logging (set via environment, not config files):${RESET}
    LOG_LEVEL (debug|info|warn|error|silent)
    LOG_DESTINATION (stderr|stdout|file)
    LOG_FILE (path to log file, used when LOG_DESTINATION=file)
    LOG_ENABLED (true|false)

  Config file format (.cvmi.json or custom --config):
  Note: Private keys are loaded from environment variables or CLI flags, never from JSON config.
  {
    "use": {
      "serverPubkey": "npub1...",
      "relays": ["wss://relay.example.com"],
      "encryption": "optional"
    }
  }

  .env file format (for private keys):
    CVMI_USE_PRIVATE_KEY=nsec1...

${BOLD}Payments (CEP-8):${RESET} only relevant when the remote server gates tools behind payment.
  --payment-mode transparent | explicit_gating
    transparent      Uses the interoperable default without requesting explicit gating.
                     Payment notifications are forwarded over stdio.
    explicit_gating  Requests a -32042 "Payment Required" error carrying the payment
                     schema, so agent hosts fail fast instead of hanging on an invoice.
  Default (no flag): explicit_gating when the server announcement advertises support,
                     otherwise transparent.

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi use npub1q... ${DIM}# connect to remote server by public key${RESET}
  ${DIM}$${RESET} cvmi use nprofile1q... ${DIM}# connect using an nprofile with relay hints${RESET}
  ${DIM}$${RESET} cvmi use npub1q... --verbose ${DIM}# verbose logging for debugging${RESET}
  ${DIM}$${RESET} cvmi use npub1q... --relays wss://my-relay.com ${DIM}# use specific relay${RESET}
  ${DIM}$${RESET} cvmi use --help ${DIM}# show this help${RESET}
  `);
}

export const __test__ = { resolveProxyPaymentOptions, resolveDefaultPaymentMode };
