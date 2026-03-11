import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { NostrClientTransport } from '@contextvm/sdk/transport';
import { nip19 } from 'nostr-tools';
import {
  loadConfig,
  loadCallPrivateKeyFromEnv,
  getUseConfig,
  listServerAliases,
  DEFAULT_RELAYS,
} from './config/index.ts';
import type { CvmiConfig, ServerTargetConfig } from './config/index.ts';
import { generatePrivateKey, normalizePrivateKey, normalizePublicKey } from './utils/crypto.ts';
import { BOLD, CYAN, DIM, RESET, TEXT } from './constants/ui.ts';
import { renderDefaultResult } from './call/render-result.ts';
import { renderSchemaProperties, renderToolSchema } from './call/render-schema.ts';

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

function looksLikeDirectServerIdentity(input: string): boolean {
  return (
    HEX_PUBKEY_PATTERN.test(input) || input.startsWith('npub1') || input.startsWith('nprofile1')
  );
}

export interface CallOptions {
  config?: string;
  privateKey?: string;
  relays?: string[];
  encryption?: EncryptionMode;
  isStateless?: boolean;
  showServerDetails?: boolean;
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
  showServerDetails: boolean;
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

interface ServerMetadata {
  name?: string;
  about?: string;
  website?: string;
  picture?: string;
}

interface CompactAliasSummary {
  name: string;
  context?: string;
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
    showServerDetails: false,
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
    } else if (arg === '--details') {
      result.showServerDetails = true;
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

function assertKnownServerInput(config: CvmiConfig, serverInput: string): void {
  if (getAlias(config, serverInput) || looksLikeDirectServerIdentity(serverInput)) {
    return;
  }

  throw new Error(
    [
      `Unknown server alias or invalid server identity: ${serverInput}`,
      'Run `cvmi config list` to see configured aliases.',
      'Or pass a direct server identity in hex, npub, or nprofile format.',
    ].join('\n')
  );
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

function formatSchemaTypeCompact(schema: Record<string, unknown> | undefined): string {
  if (!schema) return 'unknown';

  if (typeof schema.type === 'string') {
    if (schema.type === 'array') {
      const items =
        schema.items && typeof schema.items === 'object'
          ? (schema.items as Record<string, unknown>)
          : undefined;
      return `${formatSchemaTypeCompact(items)}[]`;
    }

    return schema.type;
  }

  if (Array.isArray(schema.type) && schema.type.every((value) => typeof value === 'string')) {
    return schema.type.join(' | ');
  }

  if (schema.properties && typeof schema.properties === 'object') {
    return 'object';
  }

  return 'unknown';
}

function formatToolInputSignature(tool: Tool): string | undefined {
  const schema = tool.inputSchema as Record<string, unknown> | undefined;
  const properties =
    schema?.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : undefined;

  if (!properties || Object.keys(properties).length === 0) {
    return undefined;
  }

  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const params = Object.entries(properties).map(([name, value]) => {
    const property =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
    return `${name}${required.has(name) ? '' : '?'}:${formatSchemaTypeCompact(property)}`;
  });

  return params.join(' ');
}

function resolveServerMetadataLabel(
  target: ResolvedServerTarget,
  metadata?: ServerMetadata
): string {
  return target.aliasName ?? metadata?.name ?? formatDisplayPubkey(target.server);
}

function resolveServerMetadataContext(
  target: ResolvedServerTarget,
  metadata?: ServerMetadata
): string | undefined {
  return target.description ?? metadata?.about;
}

function renderToolList(tools: Tool[]): void {
  if (tools.length === 0) {
    console.log(`  ${DIM}(no tools exposed)${RESET}`);
    return;
  }

  for (const tool of tools) {
    const signature = formatToolInputSignature(tool);
    console.log(
      `  ${CYAN}•${RESET} ${tool.name}${signature ? ` ${DIM}${signature}${RESET}` : ''}${tool.description ? ` ${DIM}— ${tool.description}${RESET}` : ''}`
    );
  }
}

function printSection(title: string): void {
  console.log(`${BOLD}${title}${RESET}`);
}

function printSummaryRow(label: string, value: string): void {
  console.log(`  ${DIM}${label}:${RESET} ${value}`);
}

function printExampleRow(command: string): void {
  console.log(`  ${DIM}$${RESET} ${TEXT}${command}${RESET}`);
}

export const __test__ = {
  renderDefaultResult,
  resolveServerTarget,
  assertKnownServerInput,
  buildMissingToolError,
  formatToolInputSignature,
  printServerHelp,
  printToolHelp,
  printAliasSummaries,
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
    metadata: {
      name: transport.getServerInitializeName(),
      about: transport.getServerInitializeAbout(),
      website: transport.getServerInitializeWebsite(),
      picture: transport.getServerInitializePicture(),
    } satisfies ServerMetadata,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}

function printServerSummary(
  target: ResolvedServerTarget,
  tools: Tool[],
  metadata?: ServerMetadata,
  options: Pick<CallOptions, 'showServerDetails'> = {}
): void {
  const shouldShowDetails = options.showServerDetails === true;
  const primaryLabel = resolveServerMetadataLabel(target, metadata);
  const primaryContext = resolveServerMetadataContext(target, metadata);

  printSection('Server');

  printSummaryRow(target.aliasName || metadata?.name ? 'Name' : 'Identity', primaryLabel);

  if (primaryContext) {
    printSummaryRow('About', primaryContext);
  }

  if (shouldShowDetails) {
    if (target.aliasName || metadata?.name) {
      printSummaryRow('Identity', formatDisplayPubkey(target.server));
    }

    if (metadata?.website) {
      printSummaryRow('Website', metadata.website);
    }

    if (metadata?.picture) {
      printSummaryRow('Picture', metadata.picture);
    }

    printSummaryRow('Relays', getDisplayRelays(target).join(', '));
    printSummaryRow('Tools', String(tools.length));
  }

  console.log();
  renderToolList(tools);
}

function printServerHelp(
  target: ResolvedServerTarget,
  tools: Tool[],
  metadata?: ServerMetadata,
  options: Pick<CallOptions, 'showServerDetails'> = {}
): void {
  printSection('Usage');
  console.log(`  cvmi call <server> <tool> [key=value ...] [options]`);
  console.log();
  printServerSummary(target, tools, metadata, options);
  console.log();
  printSection('Invoke');
  console.log(
    `  ${DIM}Use key=value arguments. Quote the full argument when passing JSON values, e.g. 'targets=[\"a\",\"b\"]'.${RESET}`
  );
  console.log(
    `  ${DIM}Use${RESET} ${TEXT}cvmi call ${target.input} <tool> --help${RESET} ${DIM}for full input/output details.${RESET}`
  );
  console.log();
  printSection('Examples');
  printExampleRow(`cvmi call ${target.input} <tool> --help`);
  printExampleRow(`cvmi call ${target.input} <tool> city=Lisbon`);
  if (!options.showServerDetails) {
    printExampleRow(`cvmi call ${target.input} --details`);
  }
}

function printAliasSummaries(aliases: CompactAliasSummary[]): void {
  if (aliases.length === 0) {
    return;
  }

  printSection('Configured aliases');
  for (const alias of aliases) {
    console.log(
      `  ${CYAN}•${RESET} ${alias.name}${alias.context ? ` ${DIM}— ${alias.context}${RESET}` : ''}`
    );
  }
  console.log();
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
  console.log(
    `  ${DIM}Pass strings as key=value. Pass arrays/objects as quoted JSON in the value, e.g. 'targets=[\"a\",\"b\"]'.${RESET}`
  );
  console.log(
    `  ${DIM}Quote the full key=value argument to avoid shell expansion in zsh and similar shells.${RESET}`
  );
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

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row++) {
    matrix[row]![0] = row;
  }

  for (let col = 0; col < cols; col++) {
    matrix[0]![col] = col;
  }

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const substitutionCost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + substitutionCost
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function findClosestToolName(toolNames: string[], requestedTool: string): string | undefined {
  const normalizedRequestedTool = requestedTool.toLowerCase();
  let bestMatch: { name: string; distance: number } | undefined;

  for (const toolName of toolNames) {
    const distance = levenshteinDistance(toolName.toLowerCase(), normalizedRequestedTool);
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { name: toolName, distance };
    }
  }

  if (!bestMatch) {
    return undefined;
  }

  const threshold = Math.max(2, Math.floor(requestedTool.length / 3));
  return bestMatch.distance <= threshold ? bestMatch.name : undefined;
}

function buildMissingToolError(
  serverInput: string,
  capabilityArg: string,
  availableToolNames: string[] = []
): Error {
  const requestedTool = resolveToolName(capabilityArg);
  const suggestion = findClosestToolName(availableToolNames, requestedTool);

  return new Error(
    [
      `Tool not found: ${capabilityArg}`,
      ...(suggestion ? [`Did you mean: ${suggestion}`] : []),
      `Run \`cvmi call ${serverInput}\` to list available tools on this server.`,
      `Run \`cvmi call ${serverInput} <tool> --help\` to inspect a specific tool.`,
    ].join('\n')
  );
}

function printMissingToolGuidance(
  target: ResolvedServerTarget,
  capabilityArg: string,
  tools: Tool[],
  metadata?: ServerMetadata,
  options: Pick<CallOptions, 'showServerDetails'> = {}
): void {
  console.error(
    buildMissingToolError(
      target.input,
      capabilityArg,
      tools.map((entry) => entry.name)
    ).message
  );
  console.error();
  printServerHelp(target, tools, metadata, options);
}

export async function call(
  serverArg: string | undefined,
  capabilityArg: string | undefined,
  input: Record<string, unknown>,
  options: CallOptions
): Promise<void> {
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
    await showCallHelp(options.config);
    process.exit(1);
  }

  assertKnownServerInput(config, serverInput);
  const target = resolveServerTarget(config, serverInput, options);
  logVerbose(options.verbose, `Connecting to ${target.aliasName ?? target.server}...`);
  const remote = await createRemoteClient(target, {
    ...options,
    privateKey: options.privateKey ?? loadCallPrivateKeyFromEnv(),
  });

  try {
    if (!capabilityArg) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      const tools = toolsResult.tools;
      printServerHelp(target, tools, remote.metadata, options);
      return;
    }

    const toolName = resolveToolName(capabilityArg);
    if (options.help) {
      logVerbose(options.verbose, 'Discovering tools...');
      const toolsResult = await remote.client.listTools();
      const tool = toolsResult.tools.find((entry) => entry.name === toolName);
      if (!tool) {
        printMissingToolGuidance(
          target,
          capabilityArg,
          toolsResult.tools,
          remote.metadata,
          options
        );
        process.exit(1);
      }
      printToolHelp(target, tool);
      return;
    }

    logVerbose(options.verbose, 'Discovering tools...');
    const toolsResult = await remote.client.listTools();
    const tool = toolsResult.tools.find((entry) => entry.name === toolName);
    if (!tool) {
      printMissingToolGuidance(target, capabilityArg, toolsResult.tools, remote.metadata, options);
      process.exit(1);
    }

    logVerbose(options.verbose, `Calling tool: ${toolName}`);
    const result = await remote.client.callTool({
      name: toolName,
      arguments: input,
    });

    if (options.raw) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    renderDefaultResult(result);
  } finally {
    await remote.close();
  }
}

async function getCompactAliasSummaries(configPath?: string): Promise<CompactAliasSummary[]> {
  const aliases = await listServerAliases('merged', configPath);
  return aliases.slice(0, 5).map((alias) => ({
    name: alias.name,
    context: alias.description,
  }));
}

export async function showCallHelp(configPath?: string): Promise<void> {
  const aliases = await getCompactAliasSummaries(configPath);

  console.log(`
${BOLD}Usage:${RESET} cvmi call <server> [capability] [key=value ...] [options]

${BOLD}Description:${RESET}
  Call capabilities on a remote ContextVM server.

${BOLD}Arguments:${RESET}
  <server>                Server identity (hex, npub, nprofile) or configured alias
  <capability>            Tool name, or tool:<name> for explicit tool selection
  key=value               Tool input arguments

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, overrides env, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs
  --encryption-mode       Encryption mode: optional, required, disabled
  --stateless             Enable stateless transport mode (default)
  --stateful              Disable stateless transport mode
  --details               Show resolved server identity and relay details during inspection
  --raw                   Print raw JSON result
  --verbose               Enable cvmi progress logging
  --debug                 Enable SDK debug logging
  --help, -h              Show this help message

${BOLD}Private key:${RESET}
  --private-key, then CVMI_CALL_PRIVATE_KEY, otherwise an ephemeral key is generated

${BOLD}Tool input:${RESET}
  Use key=value arguments. Quote the full argument when passing JSON values, e.g. 'filters={"kinds":[1],"limit":10}'

${BOLD}Aliases & config:${RESET}
  Priority: CLI > custom config (--config) > project .cvmi.json > global ~/.cvmi/config.json > env vars
  Use ${TEXT}cvmi config add <alias> <pubkey>${RESET} to save an alias, and ${TEXT}cvmi config list${RESET} to inspect available aliases
  Use ${TEXT}cvmi call <alias>${RESET} to inspect a server and ${TEXT}cvmi call <alias> <tool>${RESET} to invoke a tool

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi call weather
  ${DIM}$${RESET} cvmi call weather get_current --help
  ${DIM}$${RESET} cvmi call weather get_current city=Lisbon
  ${DIM}$${RESET} cvmi call npub1... <tool> 'filters={"kinds":[1],"limit":10}'
  ${DIM}$${RESET} cvmi call weather <tool> --raw
  `);

  printAliasSummaries(aliases);
}
