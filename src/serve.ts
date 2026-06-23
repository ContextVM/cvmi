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
import fs from 'fs';
import { BOLD, DIM, RESET } from './constants/ui.ts';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { savePrivateKeyToEnv } from './config/loader.ts';
import { normalizeCommandAndArgs, splitCommandString } from './utils/command.ts';
import { computeDirectoryContentHash, verifyManifestSignature } from './pack/crypto.ts';
import { CONTENT_HASH_IGNORE_PATTERNS } from './pack/constants.ts';

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  // Handle .cvmb / .mcpb bundle execution
  if (target.endsWith('.cvmb') || target.endsWith('.mcpb')) {
    p.log.info(`Extracting bundle ${target}...`);
    // Tracks whether the extracted dir has been handed off to the long-lived
    // gateway (stdio transport). When true, the `finally` below must NOT remove
    // it — end-of-function cleanup + the `exit` hook own its lifecycle instead.
    let handedOffToGateway = false;
    try {
      const { dir, manifest } = await extractBundle(target);
      cleanupPath = dir;
      // Synchronous backstop: guarantees cleanup on crashes / unexpected exits
      // that bypass the `finally` (e.g. uncaught throws, process.exit()).
      process.on('exit', () => {
        if (cleanupPath && fs.existsSync(cleanupPath)) {
          fs.rmSync(cleanupPath, { recursive: true, force: true });
        }
      });

      // 1. Content Hash Verification
      const expectedHash = manifest._meta?.['com.contextvm']?.content_hash;
      if (expectedHash) {
        const actualHash = await computeDirectoryContentHash(dir, CONTENT_HASH_IGNORE_PATTERNS);
        if (actualHash !== expectedHash) {
          throw new Error(
            'Content hash verification failed! The bundle contents have been modified.'
          );
        }
      } else {
        p.log.warn('No content hash found in manifest. Bundle integrity cannot be verified.');
      }

      // 2. Signature Verification
      if (manifest._sig) {
        verifyManifestSignature(manifest);
        p.log.success(`Signature verified. Author: ${manifest._sig.pubkey.slice(0, 8)}...`);
      } else {
        p.log.warn('No cryptographic signature found. You are running unverified code.');
        const proceed = await p.confirm({
          message: 'Do you want to proceed anyway?',
          initialValue: false,
        });
        if (!proceed) process.exit(1);
      }

      // 3. User Configuration Prompting
      const userConfigValues: Record<string, any> = {};
      if (manifest.user_config) {
        for (const [key, field] of Object.entries(manifest.user_config)) {
          // Check if env var already satisfies this
          const existingEnv = process.env[key.toUpperCase()];
          if (existingEnv !== undefined) {
            userConfigValues[key] = existingEnv;
            continue;
          }

          if (field.type === 'boolean') {
            userConfigValues[key] = await p.confirm({
              message: field.title || key,
              initialValue: field.default ?? false,
            });
          } else {
            const promptMethod = field.sensitive ? p.password : p.text;
            userConfigValues[key] = await promptMethod({
              message: `${field.title || key}${field.description ? ` (${field.description})` : ''}`,
              initialValue: field.default?.toString(),
              validate: (val) => {
                if (field.required && !val) return 'This field is required.';
              },
            });
          }

          if (p.isCancel(userConfigValues[key])) {
            p.cancel('Setup cancelled.');
            process.exit(0);
          }
        }
      }

      // 4. Resolve command and args from manifest
      target = manifest.server.mcp_config.command.replace(/\$\{__dirname\}/g, dir);
      const rawArgs = manifest.server.mcp_config.args || [];
      targetArgs = rawArgs.map((arg: string) => {
        let resolved = arg.replace(/\$\{__dirname\}/g, dir);
        // Replace ${user_config.X} in args
        for (const [key, val] of Object.entries(userConfigValues)) {
          resolved = resolved.replace(
            new RegExp(`\\$\\{user_config\\.${escapeRegExp(key)}\\}`, 'g'),
            String(val)
          );
        }
        return resolved;
      });

      // 5. Merge mcp_config.env into spawn environment
      const manifestEnv = manifest.server.mcp_config.env;
      const resolvedManifestEnv: Record<string, string> = {};
      if (manifestEnv) {
        for (const [key, val] of Object.entries(manifestEnv)) {
          let resolved = (val as string).replace(/\$\{__dirname\}/g, dir);
          // Replace ${user_config.X}
          for (const [cfgKey, cfgVal] of Object.entries(userConfigValues)) {
            resolved = resolved.replace(
              new RegExp(`\\$\\{user_config\\.${escapeRegExp(cfgKey)}\\}`, 'g'),
              String(cfgVal)
            );
          }
          resolvedManifestEnv[key] = resolved;
        }
        Object.assign(serveConfig, {
          env: { ...(serveConfig.env || {}), ...resolvedManifestEnv },
        });
      }

      const transport = manifest.server.transport || 'stdio';

      if (transport === 'cvm') {
        // ── Native CVM transport ──
        p.log.info(`Transport: cvm (native CVM server, no Gateway)`);

        // We ensure standard CVM vars are set if user_config resolved them
        const cvmEnv = {
          ...process.env,
          ...(serveConfig.env || {}),
        };

        if (options.verbose) {
          p.log.message(
            `Injected env vars from bundle: ${Object.keys(resolvedManifestEnv).join(', ')}`
          );
        }

        const { spawn } = await import('child_process');
        const normalized = normalizeCommandAndArgs(target, targetArgs);
        const child = spawn(normalized.command, normalized.args, {
          stdio: 'inherit',
          env: cvmEnv,
        });

        p.outro(pc.green('CVM native server started. Press Ctrl+C to stop.'));

        const signal = await waitForShutdownSignal();
        p.log.message(`\n${signal} received. Shutting down...`);
        child.kill('SIGTERM');

        // The `finally` block cleans up the extracted bundle dir on exit.
        process.exit(0);
      } else {
        // ── stdio transport (default) ──
        p.log.info(`Transport: stdio (Gateway wraps the server)`);

        // If the bundle user_config provided typical CVM fields, use them to configure gateway
        if (options.relays === undefined && !config.serve?.relays && userConfigValues.relays) {
          serveConfig.relays = String(userConfigValues.relays)
            .split(',')
            .map((r) => r.trim());
        }
        if (
          options.public === undefined &&
          !config.serve?.public &&
          userConfigValues.public !== undefined
        ) {
          serveConfig.public = Boolean(userConfigValues.public);
        }
        if (
          options.encryption === undefined &&
          !config.serve?.encryption &&
          userConfigValues.encryption
        ) {
          serveConfig.encryption = userConfigValues.encryption as EncryptionMode;
        }
      }

      // The extracted bundle dir is now owned by the gateway spawned below; it
      // must persist until the gateway shuts down, so keep `finally` from
      // removing it prematurely. (The cvm branch exits before reaching here.)
      handedOffToGateway = true;
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      // Guaranteed cleanup for the cvm runtime path and any setup error.
      // The stdio path is skipped (dir handed off to the gateway below).
      if (cleanupPath && !handedOffToGateway) {
        p.log.message(`Cleaning up temporary bundle at ${cleanupPath}`);
        fs.rmSync(cleanupPath, { recursive: true, force: true });
      }
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
  <bundle.cvmb>           If the first argument is an .cvmb file, cvmi will extract the bundle,
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
  ${DIM}$${RESET} cvmi serve my-server-1.0.0.cvmb ${DIM}# run a CVMB bundle over Nostr${RESET}
  ${DIM}$${RESET} cvmi serve --help ${DIM}# show this help${RESET}
  `);
}
