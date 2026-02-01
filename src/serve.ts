/**
 * Serve command - exposes an MCP server over Nostr (gateway functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NostrMCPGateway, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getServeConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { setupShutdownHandler } from './utils/process.ts';

/** CLI options for the serve command */
export interface ServeOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  public?: boolean;
  encryption?: EncryptionMode;
  verbose?: boolean;
}

/**
 * Run the serve command.
 */
export async function serve(
  serverCommand: string | undefined,
  options: ServeOptions
): Promise<void> {
  // Parse CLI flags inline (config is handled separately)
  const cliFlags = {
    privateKey: options.privateKey,
    relays: options.relays,
    public: options.public,
    encryption: options.encryption,
  };

  // Load configuration from all sources (CLI flags have highest priority)
  const config = await loadConfig({ serve: cliFlags }, options.config);
  const serveConfig = getServeConfig(config.serve || {});

  // Auto-generate private key if not provided
  let privateKey = serveConfig.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    p.log.info('Generated new private key for gateway');
  }

  // Validate/normalize key (accepts hex, 0x-hex, or nsec...)
  privateKey = normalizePrivateKey(privateKey);

  // Use default relays if none specified
  const relays = serveConfig.relays?.length ? serveConfig.relays : DEFAULT_RELAYS;

  // Parse server command and args
  let command: string | undefined;
  let args: string[] = [];

  if (serverCommand) {
    const parts = serverCommand.split(' ');
    command = parts[0];
    args = parts.slice(1);
  } else if (serveConfig.command) {
    command = serveConfig.command;
    args = serveConfig.args || [];
  }

  if (!command) {
    throw new Error(
      'No server command specified. Provide it as an argument or in config.\n' +
        'Example: cvmi serve "npx -y @modelcontextprotocol/server-filesystem /tmp"'
    );
  }

  // Create signer
  const signer = new PrivateKeySigner(privateKey);
  const publicKey = await signer.getPublicKey();

  if (options.verbose) {
    p.log.info(`Gateway public key: ${publicKey}`);
    p.log.message(`Relays: ${relays.join(', ')}`);
    p.log.message(`Public server: ${serveConfig.public ? 'yes' : 'no'}`);
    p.log.message(`Starting MCP server: ${command} ${args.join(' ')}`);
  }

  // Create stdio transport for MCP server
  const mcpTransport = new StdioClientTransport({
    command,
    args,
  });

  // Create gateway
  const gateway = new NostrMCPGateway({
    mcpClientTransport: mcpTransport,
    nostrTransportOptions: {
      signer,
      relayHandler: relays,
      encryptionMode: serveConfig.encryption,
      isPublicServer: serveConfig.public,
      allowedPublicKeys: serveConfig.allowedPubkeys,
      serverInfo: serveConfig.serverInfo,
      logLevel: options.verbose ? 'debug' : 'info',
    },
  });

  // Handle shutdown
  setupShutdownHandler(() => gateway.stop());

  // Start gateway
  await gateway.start();
  p.outro(pc.green('Gateway started. Press Ctrl+C to stop.'));

  // Keep running
  await new Promise(() => {});
}
