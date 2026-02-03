/**
 * Serve command - exposes an MCP server over Nostr (gateway functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NostrMCPGateway, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getServeConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { waitForShutdownSignal } from './utils/process.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { savePrivateKeyToEnv } from './config/loader.ts';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createStdioMcpTransport(target: string, args: string[]): Transport {
  return new StdioClientTransport({
    command: target,
    args,
  });
}

function createStreamableHttpMcpTransport(target: string): Transport {
  const url = new URL(target);

  // Streamable HTTP transport *optionally* supports GET (SSE stream) as a push channel.
  // Some servers incorrectly hang or time out on GET instead of returning 405.
  // The MCP SDK treats 405 as "no GET SSE" and proceeds in POST-only mode.
  // We auto-fallback to POST-only if GET does not respond quickly.
  return new StreamableHTTPClientTransport(url, {
    fetch: async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        return fetch(input, init);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        return response;
      } catch {
        // Treat GET SSE failures/timeouts as "GET not supported".
        return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

// Exported for tests only.
export const __test__ = {
  isHttpUrl,
  createStdioMcpTransport,
};

/** CLI options for the serve command */
export interface ServeOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  public?: boolean;
  encryption?: EncryptionMode;
  verbose?: boolean;
  persistPrivateKey?: boolean;
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
    persistPrivateKey: options.persistPrivateKey,
  };

  // Load configuration from all sources (CLI flags have highest priority)
  const config = await loadConfig({ serve: cliFlags }, options.config);
  const serveConfig = getServeConfig(config.serve || {});

  // Resolve MCP target early (before generating keys)
  // Priority:
  // - CLI args (positional) override config entirely
  // - otherwise config.url (remote Streamable HTTP) wins over config.command/config.args
  const target =
    serverArgs.length > 0 ? serverArgs[0] : serveConfig.url ? serveConfig.url : serveConfig.command;
  const targetArgs = serverArgs.length > 0 ? serverArgs.slice(1) : (serveConfig.args ?? []);

  if (!target) {
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

  // Persist to .env file if flag is set
  if (options.persistPrivateKey) {
    try {
      await savePrivateKeyToEnv('serve', privateKey);
      p.log.info(`Private key persisted to .env file (CVMI_SERVE_PRIVATE_KEY)`);
    } catch (error) {
      p.log.warn(
        `Failed to persist private key: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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
    p.log.message(`Starting MCP target: ${target} ${targetArgs.join(' ')}`);
  }

  const logLevel: 'debug' | 'info' = options.verbose ? 'debug' : 'info';

  const nostrTransportOptions = {
    signer,
    relayHandler: relays,
    encryptionMode: serveConfig.encryption,
    isPublicServer: serveConfig.public,
    allowedPublicKeys: serveConfig.allowedPubkeys,
    serverInfo: serveConfig.serverInfo,
    logLevel,
  };

  // Create gateway
  // - stdio targets: single MCP transport shared for all Nostr clients
  // - Streamable HTTP targets: per-client MCP transports (HTTP transport caches mcp-session-id)
  let gateway: NostrMCPGateway;
  try {
    if (isHttpUrl(target)) {
      if (targetArgs.length > 0) {
        // In HTTP mode, extra args are ambiguous and almost certainly a user error.
        // Keep the error message consistent across the CLI.
        throw new Error(
          `Streamable HTTP target does not accept extra args. ` +
            `Use: cvmi serve https://host/mcp (no additional server args).`
        );
      }

      gateway = new NostrMCPGateway({
        // Per-client mode is required for HTTP transports because the transport maintains
        // per-session state (e.g., mcp-session-id) and must be isolated per Nostr client.
        createMcpClientTransport: ({ clientPubkey: _clientPubkey }) =>
          createStreamableHttpMcpTransport(target),
        nostrTransportOptions,
      });
    } else {
      gateway = new NostrMCPGateway({
        mcpClientTransport: createStdioMcpTransport(target, targetArgs),
        nostrTransportOptions,
      });
    }
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Start gateway
  await gateway.start();
  p.outro(pc.green('Gateway started. Press Ctrl+C to stop.'));

  // Keep running until asked to shut down.
  const signal = await waitForShutdownSignal();
  p.log.message(`\n${signal} received. Shutting down...`);
  await gateway.stop();

  process.exit(0);
}

export function showServeHelp(): void {
  console.log(`
${BOLD}Usage:${RESET}
  cvmi serve [options] -- <mcp-server-command> [args...]
  cvmi serve <mcp-server-command> [args...] [options]
  cvmi serve <http(s)://mcp-server-url> [options]

${BOLD}Description:${RESET}
  Expose an MCP server over Nostr, making it accessible to remote clients.
  The MCP server command should include the server binary and any required arguments.

${BOLD}Arguments:${RESET}
  <mcp-server-command>    The MCP server command to run (e.g., "npx -y @modelcontextprotocol/server-filesystem /tmp")
                            Can also be specified in config file under serve.command
  <mcp-server-url>        If the first argument is an http(s) URL, cvmi will treat it as a Streamable HTTP MCP server
                            and connect via HTTP instead of spawning a local process.

${BOLD}Config keys:${RESET}
  serve.url                Optional remote MCP server URL (Streamable HTTP). If set, it is used when no CLI target
                             is provided. (Mutually exclusive with serve.command/serve.args.)

${BOLD}Recommended parsing convention:${RESET}
  Use ${BOLD}--${RESET} to separate cvmi flags from the server command.
  This avoids ambiguity when the server itself uses double-dash flags.
  Example:
    cvmi serve --verbose -- npx -y @modelcontextprotocol/server-filesystem /tmp --help

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Nostr private key (hex/nsec format, auto-generated if not provided)
  --persist-private-key   Save private key to .env file for future use
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
    CVMI_SERVE_URL, CVMI_GATEWAY_URL

${BOLD}SDK Logging (set via environment, not config files):${RESET}
    LOG_LEVEL (debug|info|warn|error|silent)
    LOG_DESTINATION (stderr|stdout|file)
    LOG_FILE (path to log file, used when LOG_DESTINATION=file)
    LOG_ENABLED (true|false)

  Config file format (.cvmi.json or custom --config):
  Note: Private keys are stored in .env file, not JSON config.
  {
    "serve": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "relays": ["wss://relay.example.com"],
      "public": false,
      "encryption": "optional"
    }
  }

  .env file format (for private keys):
    CVMI_SERVE_PRIVATE_KEY=nsec1...

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi serve -- npx -y @modelcontextprotocol/server-filesystem /tmp ${DIM}# start gateway${RESET}
  ${DIM}$${RESET} cvmi serve --verbose -- npx -y @modelcontextprotocol/server-filesystem /tmp --help ${DIM}# pass server flags safely${RESET}
  ${DIM}$${RESET} cvmi serve https://mcp.server.com ${DIM}# expose a remote Streamable HTTP MCP server over Nostr${RESET}
  ${DIM}$${RESET} cvmi serve npx -y @modelcontextprotocol/server-prompt-generator --public ${DIM}# public server${RESET}
  ${DIM}$${RESET} cvmi serve python /path/to/server.py --relays wss://my-relay.com ${DIM}# custom relay${RESET}
  ${DIM}$${RESET} cvmi serve --help ${DIM}# show this help${RESET}
  `);
}
