import * as p from '@clack/prompts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { NostrClientTransport } from '@contextvm/sdk/transport';
import { nip19 } from 'nostr-tools';
import {
  loadConfig,
  loadCallPrivateKeyFromEnv,
  getUseConfig,
  DEFAULT_RELAYS,
} from './config/index.ts';
import type { CvmiConfig, ServerTargetConfig } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey, normalizePublicKey } from './utils/crypto.ts';
import { BOLD, CYAN, DIM, RESET, TEXT } from './constants/ui.ts';
import { renderDefaultResult } from './call/render-result.ts';
import { renderSchemaProperties, renderToolSchema } from './call/render-schema.ts';

export interface CallOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  encryption?: EncryptionMode;
  isStateless?: boolean;
  debug?: boolean;
  verbose?: boolean;
  raw?: boolean;
  help?: boolean;
}

export interface ParseCallResult {
  server: string | undefined;
  capability: string | undefined;
  input: Record<string, unknown>;
  debug: boolean;
  verbose: boolean;
  raw: boolean;
  help: boolean;
  privateKey: string | undefined;
  relays: string[] | undefined;
  encryption: EncryptionMode | undefined;
  isStateless: boolean | undefined;
  config: string | undefined;
  unknownFlags: string[];
}

interface ResolvedServerTarget {
  input: string;
  server: string;
  relays?: string[];
  encryption: EncryptionMode;
  isStateless: boolean;
  aliasName?: string;
  description?: string;
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function parseCallArgs(args: string[]): ParseCallResult {
  const result: ParseCallResult = {
    server: undefined,
    capability: undefined,
    input: {},
    debug: false,
    verbose: false,
    raw: false,
    help: false,
    privateKey: undefined,
    relays: undefined,
    encryption: undefined,
    isStateless: undefined,
    config: undefined,
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

    if (arg === '--debug') {
      result.debug = true;
      result.verbose = true;
    } else if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--raw') {
      result.raw = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--private-key') {
      result.privateKey = consumeValue('--private-key');
    } else if (arg === '--relays') {
      const value = consumeValue('--relays');
      result.relays = value ? value.split(',').map((relay) => relay.trim()) : undefined;
    } else if (arg === '--encryption-mode') {
      const value = consumeValue('--encryption-mode');
      if (value === 'required') result.encryption = EncryptionMode.REQUIRED;
      else if (value === 'disabled') result.encryption = EncryptionMode.DISABLED;
      else if (value === 'optional') result.encryption = EncryptionMode.OPTIONAL;
      else result.unknownFlags.push(`--encryption-mode${value ? ` (${value})` : ''}`);
    } else if (arg === '--config') {
      result.config = consumeValue('--config');
    } else if (arg === '--stateless') {
      result.isStateless = true;
    } else if (arg === '--stateful') {
      result.isStateless = false;
    } else if (arg.startsWith('--')) {
      result.unknownFlags.push(arg);
    } else if (!result.server) {
      result.server = arg;
    } else if (!result.capability) {
      result.capability = arg;
    } else if (arg.includes('=')) {
      const [key, ...rest] = arg.split('=');
      if (!key) {
        result.unknownFlags.push(arg);
        continue;
      }
      result.input[key] = coerceValue(rest.join('='));
    } else {
      result.unknownFlags.push(arg);
    }
  }

  return result;
}

function getAlias(config: CvmiConfig, input: string): ServerTargetConfig | undefined {
  return config.servers?.[input];
}

function resolveServerTarget(
  config: CvmiConfig,
  serverInput: string,
  options: CallOptions
): ResolvedServerTarget {
  const alias = getAlias(config, serverInput);
  const configuredUse = config.use || {};
  const useConfig = getUseConfig(configuredUse);
  const configuredStateless = config.use?.isStateless;
  const resolvedServer = alias?.pubkey ?? serverInput;
  const isNprofileIdentity = resolvedServer.startsWith('nprofile');

  return {
    input: serverInput,
    server: resolvedServer,
    relays:
      options.relays ??
      alias?.relays ??
      configuredUse.relays ??
      (isNprofileIdentity ? undefined : (useConfig.relays ?? DEFAULT_RELAYS)),
    encryption:
      options.encryption ?? alias?.encryption ?? useConfig.encryption ?? EncryptionMode.OPTIONAL,
    isStateless: options.isStateless ?? alias?.isStateless ?? configuredStateless ?? true,
    aliasName: alias ? serverInput : undefined,
    description: alias?.description,
  };
}

function formatDisplayPubkey(pubkey: string): string {
  try {
    return nip19.npubEncode(normalizePublicKey(pubkey));
  } catch {
    return pubkey;
  }
}

function getDisplayRelays(target: ResolvedServerTarget): string[] {
  if (target.relays && target.relays.length > 0) {
    return target.relays;
  }

  try {
    const decoded = nip19.decode(target.server);
    if (decoded.type === 'nprofile') {
      return decoded.data.relays ?? [];
    }
  } catch {
    // Fall back below when the server identity is not a decodable nprofile.
  }

  return DEFAULT_RELAYS;
}

function logVerbose(enabled: boolean | undefined, message: string): void {
  if (enabled) {
    console.log(message);
  }
}

function renderToolList(tools: Tool[]): void {
  if (tools.length === 0) {
    console.log(`  ${DIM}(no tools exposed)${RESET}`);
    return;
  }

  for (const tool of tools) {
    console.log(
      `  ${CYAN}•${RESET} ${tool.name}${tool.description ? ` ${DIM}— ${tool.description}${RESET}` : ''}`
    );
  }
}

function printSection(title: string): void {
  console.log(`${BOLD}${title}${RESET}`);
}

function printSummaryRow(label: string, value: string): void {
  console.log(`  ${DIM}${label}:${RESET} ${value}`);
}

function createCallSpinner(enabled: boolean) {
  return enabled ? p.spinner() : null;
}

export const __test__ = {
  renderDefaultResult,
  resolveServerTarget,
  printServerSummary,
  printToolHelp,
};

async function createRemoteClient(target: ResolvedServerTarget, options: CallOptions) {
  let privateKey = options.privateKey;
  if (!privateKey) {
    privateKey = generatePrivateKey();
  }

  privateKey = normalizePrivateKey(privateKey);

  const signer = new PrivateKeySigner(privateKey);
  const transport = new NostrClientTransport({
    signer,
    relayHandler: target.relays ?? [],
    serverPubkey: target.server,
    discoveryRelayUrls: DEFAULT_RELAYS,
    encryptionMode: target.encryption,
    isStateless: target.isStateless,
    logLevel: options.debug ? 'debug' : 'silent',
  });

  const client = new Client({ name: 'cvmi', version: '0.1.0' });
  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}

function printServerSummary(target: ResolvedServerTarget, tools: Tool[]): void {
  const serverLabel = target.aliasName
    ? `${formatDisplayPubkey(target.server)} (${target.aliasName})`
    : formatDisplayPubkey(target.server);
  printSection('Server');
  printSummaryRow('Identity', serverLabel);
  printSummaryRow('Relays', getDisplayRelays(target).join(', '));
  if (target.description) {
    printSummaryRow('Description', target.description);
  }
  printSummaryRow('Tools', String(tools.length));
  console.log();
  renderToolList(tools);
}

function printServerHelp(target: ResolvedServerTarget, tools: Tool[]): void {
  printSection('Usage');
  console.log(`  cvmi call <server> <capability> [key=value ...] [options]`);
  console.log();
  printServerSummary(target, tools);
  console.log();
  printSection('Examples');
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input}`);
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input} <tool> --help`);
  console.log(`  ${DIM}$${RESET} cvmi call ${target.input} <tool> key=value`);
}

function printToolHelp(target: ResolvedServerTarget, tool: Tool): void {
  printSection('Usage');
  console.log(`  cvmi call ${target.input} ${tool.name} [key=value ...] [options]`);
  console.log();
  printSection('Capability');
  printSummaryRow('Name', tool.name);
  printSummaryRow('Kind', 'tool');
  if (tool.description) {
    printSummaryRow('Description', tool.description);
  }
  console.log();
  printSection('Input');
  renderToolSchema(tool);

  const outputSchema = (tool as Tool & { outputSchema?: Record<string, unknown> }).outputSchema;
  if (outputSchema) {
    printSection('Output');
    renderSchemaProperties(outputSchema, 'output fields');
  }
}

function resolveToolName(capability: string): string {
  return capability.startsWith('tool:') ? capability.slice('tool:'.length) : capability;
}

export async function call(
  serverArg: string | undefined,
  capabilityArg: string | undefined,
  input: Record<string, unknown>,
  options: CallOptions
): Promise<void> {
  const spinner = createCallSpinner(!options.raw);
  const config = await loadConfig(
    {
      use: {
        relays: options.relays,
        encryption: options.encryption,
      },
    },
    options.config
  );
  const useConfig = getUseConfig(config.use || {});

  const serverInput = serverArg ?? useConfig.serverPubkey;
  if (!serverInput) {
    showCallHelp();
    process.exit(1);
  }

  const target = resolveServerTarget(config, serverInput, options);
  logVerbose(options.verbose, `Connecting to ${target.aliasName ?? target.server}...`);
  const loadingLabel = capabilityArg
    ? options.help
      ? `Loading ${resolveToolName(capabilityArg)} help...`
      : `Calling ${resolveToolName(capabilityArg)}...`
    : options.help
      ? `Loading ${target.aliasName ?? formatDisplayPubkey(target.server)} help...`
      : `Loading ${target.aliasName ?? formatDisplayPubkey(target.server)}...`;
  spinner?.start(loadingLabel);
  const remote = await createRemoteClient(target, {
    ...options,
    privateKey: options.privateKey ?? loadCallPrivateKeyFromEnv(),
  });

  try {
    if (!capabilityArg) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      spinner?.stop('Loaded');
      const tools = toolsResult.tools;
      if (options.help) {
        printServerHelp(target, tools);
      } else {
        printServerSummary(target, tools);
      }
      return;
    }

    const toolName = resolveToolName(capabilityArg);
    if (options.help) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      spinner?.stop('Loaded');
      const tool = toolsResult.tools.find((entry) => entry.name === toolName);
      if (!tool) {
        throw new Error(`Capability not found: ${capabilityArg}`);
      }
      printToolHelp(target, tool);
      return;
    }

    logVerbose(options.verbose, `Calling tool: ${toolName}`);
    const result = await remote.client.callTool({
      name: toolName,
      arguments: input,
    });
    spinner?.stop('Completed');

    if (options.raw) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    renderDefaultResult(result);
  } catch (error) {
    spinner?.stop('Failed');
    throw error;
  } finally {
    await remote.close();
  }
}

export function showCallHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} cvmi call <server> [capability] [key=value ...] [options]

${BOLD}Description:${RESET}
  Connect directly to a remote ContextVM server and inspect or invoke its capabilities.

${BOLD}Arguments:${RESET}
  <server>                Server identity (hex, npub, nprofile) or configured alias
  <capability>            Capability selector, currently tool name or tool:<name>
  key=value               Input arguments for tool calls

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, overrides env, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs
  --encryption-mode       Encryption mode: optional, required, disabled
  --stateless             Enable stateless transport mode (default)
  --stateful              Disable stateless transport mode
  --raw                   Print raw JSON result
  --verbose               Enable cvmi progress logging
  --debug                 Enable SDK debug logging
  --help, -h              Show this help message

${BOLD}Private key resolution:${RESET}
  --private-key flag, then CVMI_CALL_PRIVATE_KEY, otherwise an ephemeral key is generated

${BOLD}Configuration Sources (priority: CLI > custom config (--config) > project .cvmi.json > global ~/.cvmi/config.json > env vars):${RESET}
  Use ${TEXT}cvmi config add <alias> <pubkey>${RESET} to create reusable server aliases in ${TEXT}.cvmi.json${RESET}
  Use ${TEXT}cvmi config add --global <alias> <pubkey>${RESET} to save aliases in ${TEXT}~/.cvmi/config.json${RESET}
  Use ${TEXT}cvmi call <alias>${RESET} or ${TEXT}cvmi call <alias> <tool>${RESET} to resolve them from config

  Config file format (.cvmi.json or custom --config):
  Note: Private keys are loaded from environment variables or CLI flags, never from JSON config.

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi call weather
  ${DIM}$${RESET} cvmi call weather --help
  ${DIM}$${RESET} cvmi config add weather nprofile1example
  ${DIM}$${RESET} cvmi config add weather npub1... --relays wss://relay.example.org
  ${DIM}$${RESET} cvmi call weather weather.get_current city=Lisbon
  ${DIM}$${RESET} cvmi call weather --debug
  ${DIM}$${RESET} cvmi call npub1... weather.get_current city=Lisbon --raw
  ${DIM}$${RESET} cvmi call nprofile1... weather.get_current city=Lisbon
  `);
}
