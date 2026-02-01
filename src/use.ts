/**
 * Use command - connects to a remote MCP server over Nostr (proxy functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NostrMCPProxy, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getUseConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { setupShutdownHandler } from './utils/process.ts';

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

  // Auto-generate private key if not provided
  let privateKey = useConfig.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    p.log.info('Generated new private key for proxy');
  }

  // Validate/normalize key (accepts hex, 0x-hex, or nsec...)
  privateKey = normalizePrivateKey(privateKey);

  // Use default relays if none specified
  const relays = useConfig.relays?.length ? useConfig.relays : DEFAULT_RELAYS;

  // Get server public key
  const serverPubkey = serverPubkeyArg ?? useConfig.serverPubkey;
  if (!serverPubkey) {
    throw new Error(
      'No server public key specified. Provide it as an argument or in config.\n' +
        'Example: cvmi use <server_pubkey>'
    );
  }

  // Create signer
  const signer = new PrivateKeySigner(privateKey);
  const publicKey = await signer.getPublicKey();

  if (options.verbose) {
    p.log.info(`Proxy public key: ${publicKey}`);
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

  // Handle shutdown
  setupShutdownHandler(() => proxy.stop());

  // Start proxy
  await proxy.start();
  p.outro(pc.green('Proxy started. Press Ctrl+C to stop.'));

  // Keep running
  await new Promise(() => {});
}
