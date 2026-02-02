/**
 * Serve command - exposes an MCP server over Nostr (gateway functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NostrMCPGateway, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getServeConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { waitForShutdownSignal } from './utils/process.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';

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
export async function serve(serverArgs: string[], options: ServeOptions): Promise<void> {
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

  // Check for required command argument early (before generating keys)
  // Priority: CLI arguments > config.command > error
  let command: string | undefined;
  let args: string[] = [];

  if (serverArgs.length > 0) {
    command = serverArgs[0];
    args = serverArgs.slice(1);
  } else if (serveConfig.command) {
    command = serveConfig.command;
    args = serveConfig.args || [];
  }

  if (!command) {
    showServeHelp();
    process.exit(1);
  }

  // Auto-generate private key if not provided
  let privateKey = serveConfig.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    p.log.info('Generated new private key');
  }

  // Validate/normalize key (accepts hex, 0x-hex, or nsec...)
  privateKey = normalizePrivateKey(privateKey);

  // Use default relays if none specified
  const relays = serveConfig.relays?.length ? serveConfig.relays : DEFAULT_RELAYS;

  // Create signer
  const signer = new PrivateKeySigner(privateKey);
  const publicKey = await signer.getPublicKey();
  p.log.info('🔑 Public key: ' + publicKey);
  p.log.info('');

  if (options.verbose) {
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

  // Start gateway
  await gateway.start();
  p.outro(pc.green('Gateway started. Press Ctrl+C to stop.'));

  // Keep running until asked to shut down.
  const signal = await waitForShutdownSignal();
  p.log.message(`\n${signal} received. Shutting down...`);
  await gateway.stop();
}

export function showServeHelp(): void {
  console.log(`
${BOLD}Usage:${RESET}
  cvmi serve [options] -- <mcp-server-command> [args...]
  cvmi serve <mcp-server-command> [args...] [options]

${BOLD}Description:${RESET}
  Expose an MCP server over Nostr, making it accessible to remote clients.
  The MCP server command should include the server binary and any required arguments.

${BOLD}Arguments:${RESET}
  <mcp-server-command>    The MCP server command to run (e.g., "npx -y @modelcontextprotocol/server-filesystem /tmp")
                           Can also be specified in config file under serve.command

${BOLD}Recommended parsing convention:${RESET}
  Use ${BOLD}--${RESET} to separate cvmi flags from the server command.
  This avoids ambiguity when the server itself uses double-dash flags.
  Example:
    cvmi serve --verbose -- npx -y @modelcontextprotocol/server-filesystem /tmp --help

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Nostr private key (hex/nsec format, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs (default: wss://relay.contextvm.org,wss://cvm.otherstuff.ai)
  --public                Make server publicly accessible (default: private)
  --encryption-mode       Encryption mode: optional, required, disabled (default: optional)
  --verbose               Enable verbose logging
  --help, -h              Show this help message

${BOLD}Configuration Sources (priority: CLI > custom config (--config) > project .cvmi.json > global ~/.cvmi/config.json > env vars):${RESET}
  Environment variables:
    CVMI_SERVE_PRIVATE_KEY, CVMI_GATEWAY_PRIVATE_KEY
    CVMI_SERVE_RELAYS, CVMI_GATEWAY_RELAYS
    CVMI_SERVE_PUBLIC, CVMI_GATEWAY_PUBLIC
    CVMI_SERVE_ENCRYPTION, CVMI_GATEWAY_ENCRYPTION

${BOLD}SDK Logging (set via environment, not config files):${RESET}
    LOG_LEVEL (debug|info|warn|error|silent)
    LOG_DESTINATION (stderr|stdout|file)
    LOG_FILE (path to log file, used when LOG_DESTINATION=file)
    LOG_ENABLED (true|false)

  Config file format (.cvmi.json or custom --config):
  {
    "serve": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "privateKey": "nsec1...",
      "relays": ["wss://relay.example.com"],
      "public": false,
      "encryption": "optional"
    }
  }

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp ${DIM}# start gateway${RESET}
  ${DIM}$${RESET} cvmi serve --verbose -- npx -y @modelcontextprotocol/server-filesystem /tmp --help ${DIM}# pass server flags safely${RESET}
  ${DIM}$${RESET} cvmi serve npx -y @modelcontextprotocol/server-prompt-generator --public ${DIM}# public server${RESET}
  ${DIM}$${RESET} cvmi serve python /path/to/server.py --relays wss://my-relay.com ${DIM}# custom relay${RESET}
  ${DIM}$${RESET} cvmi serve --help ${DIM}# show this help${RESET}
  `);
}
