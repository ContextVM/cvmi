import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Progress, Tool } from '@modelcontextprotocol/sdk/types.js';
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
import { BOLD, CYAN, DIM, RESET, TEXT, YELLOW } from './constants/ui.ts';
import { renderDefaultResult } from './call/render-result.ts';
import { renderSchemaProperties, renderToolSchema } from './call/render-schema.ts';
import {
  parseCapabilityPricing,
  formatPrice,
  PRICING_FOOTNOTE,
  type CapabilityPricing,
} from './call/pricing.ts';
import { withClientPayments } from '@contextvm/sdk/payments';
import type { PaymentInteractionMode } from '@contextvm/sdk/payments';
import {
  paymentRequiredNotificationSchema,
  renderPaymentRequired,
} from './payments/cli-payment-handler.ts';
import { PAYMENT_REQUIRED_ERROR_CODE } from '@contextvm/sdk/payments/constants';

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

export class ExplicitGatingError extends Error {
  constructor(public readonly data: any) {
    super('Payment Required');
    this.name = 'ExplicitGatingError';
  }
}

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
  prettyRaw?: boolean;
  extract?: string;
  help?: boolean;
  paymentMode?: PaymentInteractionMode;
}

export interface ParseCallResult {
  server: string | undefined;
  capability: string | undefined;
  input: Record<string, unknown>;
  debug: boolean;
  verbose: boolean;
  raw: boolean;
  prettyRaw: boolean;
  extract: string | undefined;
  help: boolean;
  privateKey: string | undefined;
  relays: string[] | undefined;
  encryption: EncryptionMode | undefined;
  isStateless: boolean | undefined;
  showServerDetails: boolean;
  config: string | undefined;
  unknownFlags: string[];
  paymentMode: PaymentInteractionMode;
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

type ExtractPathSegment = string | number;

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
    prettyRaw: false,
    extract: undefined,
    help: false,
    privateKey: undefined,
    relays: undefined,
    encryption: undefined,
    isStateless: undefined,
    showServerDetails: false,
    config: undefined,
    unknownFlags: [],
    paymentMode: 'transparent',
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
    } else if (arg === '--pretty-raw') {
      result.raw = true;
      result.prettyRaw = true;
    } else if (arg === '--extract') {
      result.extract = consumeValue('--extract');
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
    } else if (arg === '--payment-mode') {
      const value = consumeValue('--payment-mode');
      if (value === 'transparent' || value === 'explicit_gating') {
        result.paymentMode = value;
      } else {
        result.unknownFlags.push(`--payment-mode${value ? ` (${value})` : ''}`);
      }
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

function formatProgressValue(progress: Progress): string {
  if (typeof progress.total === 'number' && Number.isFinite(progress.total)) {
    return `${progress.progress}/${progress.total}`;
  }

  return String(progress.progress);
}

function createProgressHandler(
  enabled: boolean | undefined
): ((progress: Progress) => void) | undefined {
  if (!enabled) {
    return () => {};
  }

  return (progress: Progress): void => {
    const summary = formatProgressValue(progress);
    const message = typeof progress.message === 'string' ? ` ${progress.message}` : '';
    console.log(`${DIM}Progress:${RESET} ${summary}${message}`);
  };
}

function parseExtractPath(path: string): ExtractPathSegment[] {
  const segments: ExtractPathSegment[] = [];
  let current = '';
  let previousWasIndex = false;

  for (let index = 0; index < path.length; index++) {
    const char = path[index];

    if (char === '.') {
      if (!current) {
        if (previousWasIndex) {
          previousWasIndex = false;
          continue;
        }

        throw new Error(`Invalid extract path: ${path}`);
      }
      segments.push(current);
      current = '';
      previousWasIndex = false;
      continue;
    }

    if (char === '[') {
      if (current) {
        segments.push(current);
        current = '';
      }

      const closeIndex = path.indexOf(']', index);
      if (closeIndex === -1) {
        throw new Error(`Invalid extract path: ${path}`);
      }

      const token = path.slice(index + 1, closeIndex);
      if (!/^\d+$/.test(token)) {
        throw new Error(`Invalid extract path: ${path}`);
      }

      segments.push(Number(token));
      previousWasIndex = true;
      index = closeIndex;
      continue;
    }

    current += char;
    previousWasIndex = false;
  }

  if (current) {
    segments.push(current);
  }

  if (segments.length === 0) {
    throw new Error(`Invalid extract path: ${path}`);
  }

  return segments;
}

function extractResultValue(value: unknown, path: string): unknown {
  const segments = parseExtractPath(path);
  let current: unknown = value;

  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        throw new Error(`Extract path not found: ${path}`);
      }
      current = current[segment];
      continue;
    }

    if (typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error(`Extract path not found: ${path}`);
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function printRawResult(result: unknown, pretty: boolean): void {
  console.log(JSON.stringify(result, null, pretty ? 2 : undefined));
}

function printExtractedResult(result: unknown, path: string): void {
  const extracted = extractResultValue(result, path);

  if (typeof extracted === 'string') {
    console.log(extracted);
    return;
  }

  printRawResult(extracted, false);
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

function renderToolList(tools: Tool[], pricing?: CapabilityPricing): void {
  if (tools.length === 0) {
    console.log(`  ${DIM}(no tools exposed)${RESET}`);
    return;
  }

  for (const tool of tools) {
    const signature = formatToolInputSignature(tool);
    const price = pricing?.byTool.get(tool.name);
    const parts = [`  ${CYAN}•${RESET} ${tool.name}`];
    if (signature) parts.push(` ${DIM}${signature}${RESET}`);
    if (tool.description) parts.push(` ${DIM}— ${tool.description}${RESET}`);
    if (price) parts.push(` ${YELLOW}(${formatPrice(price)})${RESET}`);
    console.log(parts.join(''));
  }
}

function printSection(title: string): void {
  console.log(`${BOLD}${title}${RESET}`);
}

function printSummaryRow(label: string, value: string): void {
  console.log(`  ${DIM}${label}:${RESET} ${value}`);
}

export const __test__ = {
  renderDefaultResult,
  resolveServerTarget,
  assertKnownServerInput,
  buildMissingToolError,
  formatToolInputSignature,
  extractResultValue,
  printServerHelp,
  printToolHelp,
  printAliasSummaries,
  isPaymentRequiredError,
};

type RemoteClientFactory = typeof createRemoteClient;
type RemoteClient = Awaited<ReturnType<typeof createRemoteClient>>;

/** List tools + advertised pricing in one round-trip; always fetched together. */
async function discoverTools(
  remote: RemoteClient
): Promise<{ tools: Tool[]; pricing: CapabilityPricing }> {
  const toolsResult = await remote.client.listTools();
  const pricing = parseCapabilityPricing(
    remote.transport.getServerToolsListEvent() ?? remote.transport.getServerInitializeEvent()
  );
  return { tools: toolsResult.tools, pricing };
}

let createRemoteClientFactory: RemoteClientFactory = createRemoteClient;

export function setCreateRemoteClientFactoryForTests(factory: RemoteClientFactory): void {
  createRemoteClientFactory = factory;
}

export function resetCreateRemoteClientFactoryForTests(): void {
  createRemoteClientFactory = createRemoteClient;
}

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

  // PMI-agnostic: advertise no handlers, so the server sends
  // `payment_required` for whatever rail it supports (CEP-8 no-client-PMI
  // path). The invoice is rendered upstream via setNotificationHandler.
  const paidTransport = withClientPayments(transport, {
    paymentInteraction: options.paymentMode ?? 'transparent',
  });

  const client = new Client({ name: 'cvmi', version: '0.1.0' });
  client.setNotificationHandler(paymentRequiredNotificationSchema, (notification) =>
    renderPaymentRequired(notification.params)
  );
  await client.connect(paidTransport);

  return {
    client,
    transport,
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
  options: Pick<CallOptions, 'showServerDetails'> = {},
  pricing?: CapabilityPricing
): void {
  const shouldShowDetails = options.showServerDetails === true;
  const primaryLabel = resolveServerMetadataLabel(target, metadata);
  const primaryContext = resolveServerMetadataContext(target, metadata);
  printSection('Server');

  printSummaryRow(target.aliasName || metadata?.name ? 'Name' : 'Identity', primaryLabel);

  if (primaryContext) {
    printSummaryRow('About', primaryContext);
  }

  if (pricing && pricing.pmis.length > 0) {
    printSummaryRow('Payments', pricing.pmis.join(', '));
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
  renderToolList(tools, pricing);
  if (pricing && pricing.byTool.size > 0) {
    console.log(`  ${DIM}${PRICING_FOOTNOTE}${RESET}`);
  }
}

function printServerHelp(
  target: ResolvedServerTarget,
  tools: Tool[],
  metadata?: ServerMetadata,
  options: Pick<CallOptions, 'showServerDetails'> = {},
  pricing?: CapabilityPricing
): void {
  printSection('Usage');
  console.log(`  cvmi call <server> <tool> [key=value ...] [options]`);
  console.log();
  printServerSummary(target, tools, metadata, options, pricing);
  console.log();
  printSection('Invoke');
  console.log(
    `  ${DIM}Use key=value arguments. Quote the full argument when passing JSON values, e.g. 'targets=[\"a\",\"b\"]'.${RESET}`
  );
  console.log(
    `  ${DIM}Use${RESET} ${TEXT}cvmi call ${target.input} <tool> --help${RESET} ${DIM}for full input/output details.${RESET}`
  );
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

function printToolHelp(
  target: ResolvedServerTarget,
  tool: Tool,
  pricing?: CapabilityPricing
): void {
  printSection('Usage');
  console.log(`  cvmi call ${target.input} ${tool.name} [key=value ...] [options]`);
  if (tool.description) {
    console.log(`  ${tool.description}`);
  }
  const price = pricing?.byTool.get(tool.name);
  if (price) {
    console.log(`  ${YELLOW}${formatPrice(price)}${RESET} ${DIM}— ${PRICING_FOOTNOTE}${RESET}`);
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
  options: Pick<CallOptions, 'showServerDetails'> = {},
  pricing?: CapabilityPricing
): void {
  console.error(
    buildMissingToolError(
      target.input,
      capabilityArg,
      tools.map((entry) => entry.name)
    ).message
  );
  console.error();
  printServerHelp(target, tools, metadata, options, pricing);
}

function isMissingToolInvocationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /tool.+not found|unknown tool|method not found|-32601/i.test(error.message);
}

function isPaymentRequiredError(error: unknown): boolean {
  // CEP-8 Payment Required JSON-RPC error code
  return (
    error instanceof Error && 'code' in error && (error as any).code === PAYMENT_REQUIRED_ERROR_CODE
  );
}

export async function call(
  serverArg: string | undefined,
  capabilityArg: string | undefined,
  input: Record<string, unknown>,
  options: CallOptions
): Promise<void> {
  // LOG_ENABLED isn't set here: the SDK logger is an import-time singleton, so
  // a runtime assignment is a no-op. The client-payments info logs that used
  // to bracket the invoice only fired on the handler path we no longer take
  // (PMI-agnostic now), so they're gone. An SDK `logLevel` option on
  // withClientPayments would be the clean fix if other info logs surface.

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
  const remote = await createRemoteClientFactory(target, {
    ...options,
    privateKey: options.privateKey ?? loadCallPrivateKeyFromEnv(),
  });

  try {
    if (!capabilityArg) {
      logVerbose(options.verbose, 'Discovering tools...');
      const { tools, pricing } = await discoverTools(remote);
      printServerHelp(target, tools, remote.metadata, options, pricing);
      return;
    }

    const toolName = resolveToolName(capabilityArg);
    if (options.help) {
      logVerbose(options.verbose, 'Discovering tools...');
      const { tools, pricing } = await discoverTools(remote);
      const tool = tools.find((entry) => entry.name === toolName);
      if (!tool) {
        printMissingToolGuidance(target, capabilityArg, tools, remote.metadata, options, pricing);
        process.exit(1);
      }
      printToolHelp(target, tool, pricing);
      return;
    }

    logVerbose(options.verbose, `Calling tool: ${toolName}`);
    let result;
    try {
      result = await remote.client.callTool(
        {
          name: toolName,
          arguments: input,
        },
        undefined,
        {
          onprogress: createProgressHandler(options.verbose),
          resetTimeoutOnProgress: true,
        }
      );
    } catch (error) {
      if (!isMissingToolInvocationError(error)) {
        if (options.paymentMode === 'explicit_gating' && isPaymentRequiredError(error)) {
          throw new ExplicitGatingError((error as any).data);
        }
        throw error;
      }

      logVerbose(options.verbose, 'Discovering tools...');
      const { tools, pricing } = await discoverTools(remote);
      printMissingToolGuidance(target, capabilityArg, tools, remote.metadata, options, pricing);
      process.exit(1);
    }

    if (options.extract) {
      printExtractedResult(result, options.extract);
      return;
    }

    if (options.raw) {
      printRawResult(result, options.prettyRaw ?? false);
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
${BOLD}Usage:${RESET} cvmi call <server> [tool] [key=value ...] [options]

${BOLD}Description:${RESET}
  Call capabilities on a remote ContextVM server.

${BOLD}Arguments:${RESET}
  <server>                Server identity (hex, npub, nprofile) or configured alias
  <tool>                  Tool name, or tool:<name> for explicit tool selection
  key=value               Tool input arguments

${BOLD}Options:${RESET}
  --config <path>         Path to custom config JSON file
  --private-key <key>     Your Nostr private key (hex/nsec format, overrides env, auto-generated if not provided)
  --relays <urls>         Comma-separated relay URLs
  --encryption-mode       Encryption mode: optional, required, disabled
  --payment-mode          Payment interaction mode: transparent (default), explicit_gating
  --stateless             Enable stateless transport mode (default)
  --stateful              Disable stateless transport mode
  --details               Show resolved server identity and relay details during inspection
  --raw                   Print raw JSON result as compact JSON
  --pretty-raw            Print raw JSON result with indentation
  --extract <path>        Print a specific result field, e.g. content[0].data
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

${BOLD}Payments (CEP-8):${RESET} only relevant when the server gates the called tool behind payment.
  --payment-mode transparent (default) | explicit_gating
    transparent     Renders the lightning invoice to stderr and waits for out-of-band
                    settlement (for humans in a terminal).
    explicit_gating Prints the raw payment schema as JSON on stdout and exits with code 2
                    (for agents: parse stdout, pay out-of-band, then retry).

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi call weather
  ${DIM}$${RESET} cvmi call weather get_current --help
  ${DIM}$${RESET} cvmi call weather get_current city=Lisbon
  ${DIM}$${RESET} cvmi call weather get_current city=Lisbon --raw
  ${DIM}$${RESET} cvmi call files read_media_file path=./img.jpg --extract content[0].data
  `);

  printAliasSummaries(aliases);
}
