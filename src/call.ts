import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult, Progress, Tool } from '@modelcontextprotocol/sdk/types.js';
import { PrivateKeySigner, EncryptionMode } from '@contextvm/sdk';
import { NostrClientTransport } from '@contextvm/sdk/transport';
import { nip19, SimplePool, type Event } from 'nostr-tools';
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
const SERVER_ANNOUNCEMENT_KIND = 11316;
const ENCRYPTION_DISCOVERY_TIMEOUT_MS = 4000;
export const DEFAULT_CALL_TIMEOUT_MS = 60000;
export const DEFAULT_CALL_MAX_TOTAL_TIMEOUT_MS = 300000;
const MAX_CALL_TIMEOUT_MS = 2147483647;

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
  timeout?: number;
  openStream?: boolean;
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
  timeout: number | undefined;
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
    timeout: undefined,
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
    } else if (arg === '--timeout') {
      const value = consumeValue('--timeout');
      if (value !== undefined) {
        const timeout = Number(value);
        if (
          /^\d+$/.test(value) &&
          Number.isSafeInteger(timeout) &&
          timeout > 0 &&
          timeout <= MAX_CALL_TIMEOUT_MS
        ) {
          result.timeout = timeout;
        } else {
          result.unknownFlags.push(`--timeout (${value})`);
        }
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
      const profileRelays = decoded.data.relays ?? [];
      if (profileRelays.length > 0) {
        return profileRelays;
      }
    }
  } catch {
    // Fall back below when the server identity is not a decodable nprofile.
  }

  return DEFAULT_RELAYS;
}

type EncryptionSupportLookup = (
  target: ResolvedServerTarget,
  maxWaitMs: number
) => Promise<boolean | undefined>;

function getTargetHexPubkey(server: string): string {
  if (server.startsWith('nprofile')) {
    const decoded = nip19.decode(server);
    if (decoded.type !== 'nprofile') {
      throw new Error(`Expected nprofile server identity, got ${decoded.type}`);
    }
    return decoded.data.pubkey;
  }

  return normalizePublicKey(server);
}

function announcementSupportsEncryption(event: Event): boolean {
  const encryptionTag = event.tags.find((tag) => tag[0] === 'support_encryption');
  if (encryptionTag) {
    return encryptionTag.length === 1 || encryptionTag[1] === 'true';
  }

  try {
    const content = event.content ? (JSON.parse(event.content) as Record<string, unknown>) : {};
    const serverInfo =
      content.serverInfo && typeof content.serverInfo === 'object'
        ? (content.serverInfo as Record<string, unknown>)
        : undefined;
    return content.support_encryption === true || serverInfo?.support_encryption === true;
  } catch {
    return false;
  }
}

async function lookupServerEncryptionSupport(
  target: ResolvedServerTarget,
  maxWaitMs: number
): Promise<boolean | undefined> {
  const relays = getDisplayRelays(target);
  if (relays.length === 0) return undefined;

  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relays,
      {
        kinds: [SERVER_ANNOUNCEMENT_KIND],
        authors: [getTargetHexPubkey(target.server)],
      },
      { maxWait: maxWaitMs }
    );
    const latest = events.sort((left, right) => right.created_at - left.created_at)[0];
    return latest ? announcementSupportsEncryption(latest) : undefined;
  } finally {
    pool.close(relays);
  }
}

async function resolveEffectiveEncryptionMode(
  target: ResolvedServerTarget,
  maxWaitMs: number,
  lookup: EncryptionSupportLookup = lookupServerEncryptionSupport
): Promise<EncryptionMode> {
  if (target.encryption === EncryptionMode.DISABLED) {
    return EncryptionMode.DISABLED;
  }

  let supportsEncryption: boolean | undefined;
  try {
    supportsEncryption = await lookup(target, maxWaitMs);
  } catch {
    return target.encryption;
  }

  if (supportsEncryption === false) {
    if (target.encryption === EncryptionMode.REQUIRED) {
      throw new Error(
        'Server announcement does not advertise encryption support, but encryption is required.'
      );
    }
    return EncryptionMode.DISABLED;
  }

  return target.encryption;
}

function logVerbose(enabled: boolean | undefined, message: string): void {
  if (enabled) {
    console.error(message);
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
    console.error(`${DIM}Progress:${RESET} ${summary}${message}`);
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

function isToolErrorResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

interface StreamChunk {
  chunkIndex: number;
  value: string;
}

interface StreamSession {
  readonly isActive?: boolean;
  abort(reason?: string): Promise<void>;
  dispose(): void;
  [Symbol.asyncIterator](): AsyncIterator<StreamChunk>;
}

type ToolResultOutcome =
  { type: 'result'; value: CallToolResult } | { type: 'error'; error: unknown };

function parseStreamChunkValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseChatCompletionChunk(value: unknown): {
  recognized: boolean;
  text?: string;
} {
  if (typeof value !== 'object' || value === null) return { recognized: false };
  if ((value as Record<string, unknown>).object !== 'chat.completion.chunk') {
    return { recognized: false };
  }

  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return { recognized: true };
  const firstChoice = choices[0];
  if (typeof firstChoice !== 'object' || firstChoice === null) return { recognized: true };
  const delta = (firstChoice as Record<string, unknown>).delta;
  if (typeof delta !== 'object' || delta === null) return { recognized: true };
  const content = (delta as Record<string, unknown>).content;
  return {
    recognized: true,
    ...(typeof content === 'string' ? { text: content } : {}),
  };
}

function renderStreamChunk(
  chunk: StreamChunk,
  options: CallOptions,
  inlineTextOpen: boolean
): boolean {
  if (options.extract) return inlineTextOpen;

  const value = parseStreamChunkValue(chunk.value);
  if (options.raw) {
    printRawResult(
      {
        type: 'chunk',
        chunkIndex: chunk.chunkIndex,
        value,
      },
      options.prettyRaw ?? false
    );
    return false;
  }

  const completionChunk = parseChatCompletionChunk(value);
  if (completionChunk.recognized) {
    if (completionChunk.text) {
      process.stdout.write(completionChunk.text);
      return true;
    }
    return inlineTextOpen;
  }

  if (inlineTextOpen) process.stdout.write('\n');
  console.log(chunk.value);
  return false;
}

function resolveRequestTimeouts(options: CallOptions): {
  timeout: number;
  maxTotalTimeout: number;
} {
  return {
    timeout: options.timeout ?? DEFAULT_CALL_TIMEOUT_MS,
    maxTotalTimeout: options.timeout ?? DEFAULT_CALL_MAX_TOTAL_TIMEOUT_MS,
  };
}

async function callStreamingTool(
  remote: RemoteClient,
  toolName: string,
  input: Record<string, unknown>,
  options: CallOptions
): Promise<CallToolResult> {
  const pendingSession = remote.transport.prepareOutboundOpenStreamSession();
  const sessionOutcome = pendingSession.then(
    (value) => ({ type: 'session' as const, value }),
    (error: unknown) => ({ type: 'error' as const, error })
  );
  const requestTimeouts = resolveRequestTimeouts(options);
  const resultPromise = remote.client.callTool({ name: toolName, arguments: input }, undefined, {
    onprogress: createProgressHandler(options.verbose),
    resetTimeoutOnProgress: true,
    ...requestTimeouts,
  }) as Promise<CallToolResult>;
  const resultOutcome: Promise<ToolResultOutcome> = resultPromise.then(
    (value) => ({ type: 'result', value }),
    (error: unknown) => ({ type: 'error', error })
  );
  // A request can fail before the transport has paired its CEP-41 session.
  // Race setup so that path surfaces immediately instead of waiting forever.
  const setup = await Promise.race([sessionOutcome, resultOutcome]);
  if (setup.type === 'error') throw setup.error;
  if (setup.type === 'result') return setup.value;

  const stream = setup.value.stream as StreamSession;
  const iterator = stream[Symbol.asyncIterator]();
  let terminalResult: CallToolResult | undefined;
  let sawChunk = false;
  let inlineTextOpen = false;
  let pendingNext:
    | Promise<
        { type: 'next'; value: IteratorResult<StreamChunk> } | { type: 'error'; error: unknown }
      >
    | undefined;

  try {
    while (true) {
      pendingNext ??= iterator.next().then(
        (value) => ({ type: 'next' as const, value }),
        (error: unknown) => ({ type: 'error' as const, error })
      );
      const outcome = terminalResult
        ? sawChunk
          ? await pendingNext
          : await Promise.race([
              pendingNext,
              new Promise<{ type: 'drained' }>((resolve) =>
                setTimeout(() => resolve({ type: 'drained' }), 0)
              ),
            ])
        : await Promise.race([pendingNext, resultOutcome]);

      if (outcome.type === 'error') throw outcome.error;
      if (outcome.type === 'result') {
        if (isToolErrorResult(outcome.value)) {
          if (inlineTextOpen) process.stdout.write('\n');
          return outcome.value;
        }
        terminalResult = outcome.value;
        continue;
      }
      if (outcome.type === 'drained') return terminalResult!;
      pendingNext = undefined;
      if (outcome.value.done) {
        if (inlineTextOpen) process.stdout.write('\n');
        return await resultPromise;
      }

      sawChunk = true;
      inlineTextOpen = renderStreamChunk(outcome.value.value, options, inlineTextOpen);
    }
  } catch (error) {
    if (inlineTextOpen) process.stdout.write('\n');
    if (sawChunk && stream.isActive !== false) {
      try {
        await stream.abort(error instanceof Error ? error.message : String(error));
      } catch {
        // Preserve the original call/stream failure.
      }
    }
    throw error;
  } finally {
    stream.dispose();
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
  getDisplayRelays,
  announcementSupportsEncryption,
  resolveEffectiveEncryptionMode,
};

type RemoteClientFactory = typeof createRemoteClient;
type RemoteClient = Awaited<ReturnType<typeof createRemoteClient>>;

/** List tools + advertised pricing in one round-trip; always fetched together. */
async function discoverTools(
  remote: RemoteClient,
  timeoutMs: number,
  maxTotalTimeoutMs: number
): Promise<{ tools: Tool[]; pricing: CapabilityPricing }> {
  const toolsResult = await remote.client.listTools(undefined, {
    timeout: timeoutMs,
    maxTotalTimeout: maxTotalTimeoutMs,
  });
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

  const { timeout: timeoutMs, maxTotalTimeout: maxTotalTimeoutMs } =
    resolveRequestTimeouts(options);
  const encryptionMode = await resolveEffectiveEncryptionMode(
    target,
    Math.min(timeoutMs, ENCRYPTION_DISCOVERY_TIMEOUT_MS)
  );
  if (encryptionMode !== target.encryption) {
    logVerbose(options.verbose, 'Server does not advertise encryption; using unencrypted mode.');
  }

  const signer = new PrivateKeySigner(privateKey);
  const transport = new NostrClientTransport({
    signer,
    relayHandler: target.relays ?? [],
    serverPubkey: target.server,
    discoveryRelayUrls: DEFAULT_RELAYS,
    encryptionMode,
    isStateless: target.isStateless,
    logLevel: options.debug ? 'debug' : 'silent',
    openStream: options.openStream ? { enabled: true } : undefined,
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
  await client.connect(paidTransport, {
    timeout: timeoutMs,
    maxTotalTimeout: maxTotalTimeoutMs,
  });

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
): Promise<number> {
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
    return 1;
  }

  assertKnownServerInput(config, serverInput);
  const target = resolveServerTarget(config, serverInput, options);
  const requestTimeouts = resolveRequestTimeouts(options);
  const isStreamingCall = input.stream === true;
  logVerbose(options.verbose, `Connecting to ${target.aliasName ?? target.server}...`);
  const remote = await createRemoteClientFactory(target, {
    ...options,
    privateKey: options.privateKey ?? loadCallPrivateKeyFromEnv(),
    openStream: isStreamingCall,
  });

  try {
    if (!capabilityArg) {
      logVerbose(options.verbose, 'Discovering tools...');
      const { tools, pricing } = await discoverTools(
        remote,
        requestTimeouts.timeout,
        requestTimeouts.maxTotalTimeout
      );
      printServerHelp(target, tools, remote.metadata, options, pricing);
      return 0;
    }

    const toolName = resolveToolName(capabilityArg);
    if (options.help) {
      logVerbose(options.verbose, 'Discovering tools...');
      const { tools, pricing } = await discoverTools(
        remote,
        requestTimeouts.timeout,
        requestTimeouts.maxTotalTimeout
      );
      const tool = tools.find((entry) => entry.name === toolName);
      if (!tool) {
        printMissingToolGuidance(target, capabilityArg, tools, remote.metadata, options, pricing);
        return 1;
      }
      printToolHelp(target, tool, pricing);
      return 0;
    }

    logVerbose(options.verbose, `Calling tool: ${toolName}`);
    let result;
    try {
      result = isStreamingCall
        ? await callStreamingTool(remote, toolName, input, options)
        : await remote.client.callTool(
            {
              name: toolName,
              arguments: input,
            },
            undefined,
            {
              onprogress: createProgressHandler(options.verbose),
              resetTimeoutOnProgress: true,
              ...requestTimeouts,
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
      const { tools, pricing } = await discoverTools(
        remote,
        requestTimeouts.timeout,
        requestTimeouts.maxTotalTimeout
      );
      printMissingToolGuidance(target, capabilityArg, tools, remote.metadata, options, pricing);
      return 1;
    }

    if (options.extract) {
      printExtractedResult(result, options.extract);
      return isToolErrorResult(result) ? 1 : 0;
    }

    if (options.raw) {
      printRawResult(
        isStreamingCall ? { type: 'result', value: result } : result,
        options.prettyRaw ?? false
      );
      return isToolErrorResult(result) ? 1 : 0;
    }

    renderDefaultResult(result);
    return isToolErrorResult(result) ? 1 : 0;
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
  --timeout <ms>          Request timeout; defaults to 60s idle / 5m total
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
  Passing stream=true consumes CEP-41 output. Raw streaming output is emitted as JSON records,
  with one record per chunk followed by the terminal MCP result.

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
  ${DIM}$${RESET} cvmi call files read_media_file path=./img.jpg --extract 'content[0].data'
  `);

  printAliasSummaries(aliases);
}
