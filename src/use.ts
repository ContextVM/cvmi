/**
 * Use command - connects to a remote MCP server over Nostr (proxy functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NostrMCPProxy, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getUseConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { waitForShutdownSignal } from './utils/process.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';

/** CLI options for the use command */
export interface UseOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  encryption?: EncryptionMode;
  verbose?: boolean;
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

  // Create proxy
  const proxy = new NostrMCPProxy({
    mcpHostTransport: mcpTransport,
    nostrTransportOptions: {
      signer,
      relayHandler: relays,
      serverPubkey,
      encryptionMode: useConfig.encryption,
      logLevel: options.verbose ? 'debug' : 'info',
    },
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
  <server-pubkey>         The Nostr public key (npub1 or hex) of the remote MCP server
                          Can also be specified in config file under use.serverPubkey

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs (default: wss://relay.contextvm.org,wss://cvm.otherstuff.ai)
  --encryption-mode       Encryption mode: optional, required, disabled (default: optional)
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
  {
    "use": {
      "serverPubkey": "npub1...",
      "privateKey": "nsec1...",
      "relays": ["wss://relay.example.com"],
      "encryption": "optional"
    }
  }

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi use npub1q... ${DIM}# connect to remote server by public key${RESET}
  ${DIM}$${RESET} cvmi use npub1q... --verbose ${DIM}# verbose logging for debugging${RESET}
  ${DIM}$${RESET} cvmi use npub1q... --relays wss://my-relay.com ${DIM}# use specific relay${RESET}
  ${DIM}$${RESET} cvmi use --help ${DIM}# show this help${RESET}
  `);
}
