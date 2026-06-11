/**
 * Serve command - exposes an MCP server over Nostr (gateway functionality).
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NostrMCPGateway, PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { loadConfig, getServeConfig, DEFAULT_RELAYS } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey } from './utils/crypto.ts';
import { waitForShutdownSignal } from './utils/process.ts';
import { extractBundle } from './pack/extract.ts';
import { DEFAULT_CVM_META } from './pack/cvm-manifest.ts';
import fs from 'fs';
import { BOLD, DIM, RESET } from './constants/ui.ts';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { savePrivateKeyToEnv } from './config/loader.ts';
import { normalizeCommandAndArgs, splitCommandString } from './utils/command.ts';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createStdioMcpTransport(
  target: string,
  args: string[],
  env?: Record<string, string>
): Transport {
  return new StdioClientTransport({
    command: target,
    args,
    env,
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
  splitCommandString,
  normalizeCommandAndArgs,
  getDefaultEnvironment,
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
  env?: Record<string, string>;
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
    env: options.env,
  };

  // Load configuration from all sources (CLI flags have highest priority)
  const config = await loadConfig({ serve: cliFlags }, options.config);
  const serveConfig = getServeConfig(config.serve || {});

  const mcpEnv = serveConfig.env
    ? {
        ...getDefaultEnvironment(),
        ...serveConfig.env,
      }
    : undefined;

  // Resolve MCP target early (before generating keys)
  // Priority:
  // - CLI args (positional) override config entirely
  // - otherwise config.url (remote Streamable HTTP) wins over config.command/config.args
  let target =
    serverArgs.length > 0 ? serverArgs[0] : serveConfig.url ? serveConfig.url : serveConfig.command;
  let targetArgs = serverArgs.length > 0 ? serverArgs.slice(1) : (serveConfig.args ?? []);

  if (!target) {
    showServeHelp();
    process.exit(1);
  }

  let cleanupPath: string | undefined;

  // Handle .mcpb bundle execution
  if (target.endsWith('.mcpb')) {
    p.log.info(`Extracting bundle ${target}...`);
    try {
      const { dir, manifest } = await extractBundle(target);
      cleanupPath = dir;

      // Load CVM config from manifest
      const meta = manifest._meta?.['com.contextvm'] || DEFAULT_CVM_META;
      const defaults = meta.defaults || DEFAULT_CVM_META.defaults!;
      const transport = meta.transport || 'stdio';

      // Resolve command and args from manifest
      target = manifest.server.mcp_config.command.replace(/\$\{__dirname\}/g, dir);
      const rawArgs = manifest.server.mcp_config.args || [];
      targetArgs = rawArgs.map((arg) => arg.replace(/\$\{__dirname\}/g, dir));

      // Merge mcp_config.env into spawn environment (apply ${__dirname} substitution)
      const manifestEnv = manifest.server.mcp_config.env;
      if (manifestEnv) {
        const resolvedManifestEnv: Record<string, string> = {};
        for (const [key, val] of Object.entries(manifestEnv)) {
          resolvedManifestEnv[key] = val.replace(/\$\{__dirname\}/g, dir);
        }
        Object.assign(serveConfig, {
          env: { ...(serveConfig.env || {}), ...resolvedManifestEnv },
        });
      }

      if (transport === 'cvm') {
        // ── Native CVM transport ──
        // The server uses the CVM SDK directly (NostrServerTransport).
        // We inject config as environment variables per the env_mapping contract.
        // No Gateway is used.

        const envMapping = meta.env_mapping;

        // Resolve final config values (CLI flags > config file > manifest defaults)
        const resolvedRelays = options.relays ?? serveConfig.relays ?? defaults.relays;
        const resolvedEncryption =
          options.encryption ?? serveConfig.encryption ?? defaults.encryption;
        const resolvedPublic = options.public ?? serveConfig.public ?? defaults.public;
        const resolvedPrivateKey = serveConfig.privateKey ?? generatePrivateKey();

        // Build env vars from the mapping
        const cvmEnv: Record<string, string> = {};
        if (envMapping?.relays && resolvedRelays) {
          cvmEnv[envMapping.relays] = Array.isArray(resolvedRelays)
            ? resolvedRelays.join(',')
            : resolvedRelays;
        }
        if (envMapping?.encryption && resolvedEncryption) {
          cvmEnv[envMapping.encryption] = resolvedEncryption;
        }
        if (envMapping?.public) {
          cvmEnv[envMapping.public] = String(resolvedPublic ?? false);
        }
        if (envMapping?.private_key) {
          cvmEnv[envMapping.private_key] = normalizePrivateKey(resolvedPrivateKey);
        }

        p.log.info(`Transport: cvm (native CVM server, no Gateway)`);
        if (options.verbose) {
          p.log.message(`Injected env vars: ${Object.keys(cvmEnv).join(', ')}`);
        }

        // Spawn the server process directly with injected env vars
        const { spawn } = await import('child_process');
        const normalized = normalizeCommandAndArgs(target, targetArgs);
        const child = spawn(normalized.command, normalized.args, {
          stdio: 'inherit',
          env: {
            ...process.env,
            ...cvmEnv,
            ...(serveConfig.env || {}),
          },
        });

        p.outro(pc.green('CVM native server started. Press Ctrl+C to stop.'));

        const signal = await waitForShutdownSignal();
        p.log.message(`\n${signal} received. Shutting down...`);
        child.kill('SIGTERM');

        if (cleanupPath && fs.existsSync(cleanupPath)) {
          p.log.message(`Cleaning up temporary bundle at ${cleanupPath}`);
          fs.rmSync(cleanupPath, { recursive: true, force: true });
        }

        process.exit(0);
      } else {
        // ── stdio transport (default) ──
        // Gateway wraps the process. Apply manifest defaults to serveConfig.
        if (options.relays === undefined && !config.serve?.relays) {
          serveConfig.relays = defaults.relays;
        }
        if (options.public === undefined && !config.serve?.public) {
          serveConfig.public = defaults.public;
        }
        if (options.encryption === undefined && !config.serve?.encryption) {
          serveConfig.encryption = defaults.encryption as EncryptionMode;
        }

        p.log.info(`Transport: stdio (Gateway wraps the server)`);
      }
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
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

      // NEW: Create a dedicated announcement transport for HTTP targets when public.
      const announcementTransport = serveConfig.public
        ? createStreamableHttpMcpTransport(target)
        : undefined;

      gateway = new NostrMCPGateway({
        // Per-client mode is required for HTTP transports because the transport maintains
        // per-session state (e.g., mcp-session-id) and must be isolated per Nostr client.
        createMcpClientTransport: ({ clientPubkey: _clientPubkey }) =>
          createStreamableHttpMcpTransport(target),
        announcementMcpTransport: announcementTransport,
        nostrTransportOptions,
      });
    } else {
      const normalized = normalizeCommandAndArgs(target, targetArgs);
      gateway = new NostrMCPGateway({
        mcpClientTransport: createStdioMcpTransport(normalized.command, normalized.args, mcpEnv),
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

  if (cleanupPath && fs.existsSync(cleanupPath)) {
    p.log.message(`Cleaning up temporary bundle at ${cleanupPath}`);
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }

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
  <bundle.mcpb>           If the first argument is an .mcpb file, cvmi will extract the bundle,
                            read the manifest, apply CVM config defaults, and spawn the server.

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
  --env, -e <k=v>         Pass environment variable to the spawned MCP server (repeatable)
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
      "env": { "LOG_LEVEL": "debug" },
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
  ${DIM}$${RESET} cvmi serve my-server-1.0.0.mcpb ${DIM}# run an MCPB bundle over Nostr${RESET}
  ${DIM}$${RESET} cvmi serve --help ${DIM}# show this help${RESET}
  `);
}
