import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  EncryptionMode,
  GiftWrapMode,
  NostrServerTransport,
  PrivateKeySigner,
  type RelayHandler,
} from '@contextvm/sdk';
import type { NostrClientTransport, NostrTransportOptions } from '@contextvm/sdk/transport';
import { decryptMessage } from '@contextvm/sdk/core';
import {
  generateSecretKey,
  getPublicKey,
  matchFilters,
  verifyEvent,
  type Filter,
  type NostrEvent,
} from 'nostr-tools';
import { call, parseCallArgs } from './call.ts';

// Substitute only the relay adapter. Both SDK transports, MCP, encryption,
// signatures, authorization, and the call command's option forwarding are real.
const observed = vi.hoisted(() => ({
  relay: undefined as RelayHandler | undefined,
  clients: [] as NostrClientTransport[],
  options: [] as NostrTransportOptions[],
}));
vi.mock('@contextvm/sdk/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@contextvm/sdk/transport')>();
  return {
    ...actual,
    NostrClientTransport: class extends actual.NostrClientTransport {
      constructor(options: NostrTransportOptions) {
        if (!observed.relay) throw new Error('Test relay not initialized');
        super({ ...options, relayHandler: observed.relay });
        observed.options.push(options);
        observed.clients.push(this);
      }
    },
  };
});
vi.mock('./config/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config/index.ts')>()),
  loadConfig: async () => ({}),
}));

function localRelay() {
  const events: NostrEvent[] = [];
  const subscriptions = new Set<{ filters: Filter[]; receive: (event: NostrEvent) => void }>();
  function handler(): RelayHandler {
    const owned = new Set<() => void>();
    const unsubscribe = () => {
      for (const close of owned) close();
      owned.clear();
    };
    return {
      connect: async () => {},
      disconnect: async () => unsubscribe(),
      unsubscribe,
      getRelayUrls: () => ['ws://127.0.0.1'],
      publish: async (event) => {
        expect(verifyEvent(event)).toBe(true);
        events.push(event);
        for (const subscription of subscriptions) {
          if (matchFilters(subscription.filters, event)) {
            queueMicrotask(() => subscription.receive(event));
          }
        }
      },
      subscribe: async (filters, receive, eose) => {
        const subscription = { filters, receive };
        subscriptions.add(subscription);
        const close = () => {
          subscriptions.delete(subscription);
          owned.delete(close);
        };
        owned.add(close);
        eose?.();
        return close;
      },
    };
  }
  return { events, subscriptions, handler };
}

describe('call gift-wrap transport compatibility', () => {
  let relay: ReturnType<typeof localRelay>;
  let server: Server;
  let clientKey: Uint8Array;
  let clientPubkey: string;
  let clientSigner: PrivateKeySigner;
  let serverSigner: PrivateKeySigner;
  let serverPubkey: string;
  let received: string[];
  const marker = 'cvmi-gift-wrap-regression-ok';

  beforeEach(() => {
    relay = localRelay();
    observed.relay = relay.handler();
    observed.clients = [];
    observed.options = [];
    clientKey = generateSecretKey();
    clientPubkey = getPublicKey(clientKey);
    clientSigner = new PrivateKeySigner(Buffer.from(clientKey).toString('hex'));
    serverSigner = new PrivateKeySigner(Buffer.from(generateSecretKey()).toString('hex'));
    received = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const client of observed.clients) await client.close();
    await server?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function startServer(mode: GiftWrapMode) {
    serverPubkey = await serverSigner.getPublicKey();
    const transport = new NostrServerTransport({
      signer: serverSigner,
      relayHandler: relay.handler(),
      encryptionMode: EncryptionMode.REQUIRED,
      giftWrapMode: mode,
      allowedPublicKeys: [clientPubkey],
      publishRelayList: false,
      bootstrapRelayUrls: [],
      logLevel: 'silent',
      inboundMiddleware: async (message, context, forward) => {
        expect(context.clientPubkey).toBe(clientPubkey);
        if ('method' in message) received.push(message.method);
        await forward(message);
      },
    });
    transport.setSupportedPaymentInteraction('transparent');
    server = new Server(
      { name: 'gift-wrap-regression', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'fixture_read',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      expect(request.params.name).toBe('fixture_read');
      expect(request.params.arguments).toEqual({});
      return { content: [{ type: 'text', text: marker }] };
    });
    await server.connect(transport);
  }

  function invoke(mode?: GiftWrapMode, payment = 'transparent') {
    const parsed = parseCallArgs([
      serverPubkey,
      'tool:fixture_read',
      '--encryption-mode',
      'required',
      '--stateful',
      '--payment-mode',
      payment,
      '--raw',
      ...(mode === undefined ? [] : ['--gift-wrap-mode', mode]),
    ]);
    expect(parsed.unknownFlags).toEqual([]);
    return call(parsed.server, parsed.capability, parsed.input, {
      ...parsed,
      privateKey: Buffer.from(clientKey).toString('hex'),
    });
  }

  it('characterizes the omitted-policy failure against an ephemeral-only server', async () => {
    vi.useFakeTimers();
    await startServer(GiftWrapMode.EPHEMERAL);
    const rejected = expect(invoke()).rejects.toThrow('Request timed out');
    await vi.waitFor(() => expect(relay.events[0]?.kind).toBe(1059));
    expect(received).toEqual([]);
    expect(observed.options[0]).not.toHaveProperty('giftWrapMode');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(relay.events.every((event) => event.kind === 1059)).toBe(true);
    expect(received).toEqual([]);
  });

  it.each([
    { serverMode: GiftWrapMode.EPHEMERAL, mode: GiftWrapMode.EPHEMERAL, initialKind: 21059 },
    { serverMode: GiftWrapMode.OPTIONAL, mode: undefined, initialKind: 1059 },
    { serverMode: GiftWrapMode.OPTIONAL, mode: GiftWrapMode.OPTIONAL, initialKind: 1059 },
    { serverMode: GiftWrapMode.OPTIONAL, mode: GiftWrapMode.PERSISTENT, initialKind: 1059 },
    { serverMode: GiftWrapMode.PERSISTENT, mode: undefined, initialKind: 1059 },
  ])(
    'initializes and calls a read-only tool with server $serverMode and client $mode',
    async ({ serverMode, mode, initialKind }) => {
      await startServer(serverMode);
      await invoke(mode);
      expect(relay.events[0]?.kind).toBe(initialKind);
      expect(relay.events.every((event) => event.kind === 1059 || event.kind === 21059)).toBe(true);
      expect(observed.options[0]?.encryptionMode).toBe(EncryptionMode.REQUIRED);
      if (mode === undefined) expect(observed.options[0]).not.toHaveProperty('giftWrapMode');
      else expect(observed.options[0]?.giftWrapMode).toBe(mode);
      expect(received).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
      const decoded = await Promise.all(
        relay.events.map(async (event) => {
          const toServer = event.tags.some((tag) => tag[0] === 'p' && tag[1] === serverPubkey);
          const inner = JSON.parse(
            await decryptMessage(event, toServer ? serverSigner : clientSigner)
          ) as NostrEvent;
          expect(verifyEvent(inner)).toBe(true);
          expect(inner.pubkey).toBe(toServer ? clientPubkey : serverPubkey);
          return { inner, message: JSON.parse(inner.content) };
        })
      );
      const request = decoded.find((event) => event.message.method === 'tools/call')!;
      const response = decoded.find(
        (event) => event.message.result?.content?.[0]?.text === marker
      )!;
      expect(response.message.id).toBe(request.message.id);
      expect(response.inner.tags).toContainEqual(['e', request.inner.id]);
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({ content: [{ type: 'text', text: marker }] })
      );
    }
  );

  it('keeps unsupported payment gating separate from wrapping compatibility', async () => {
    await startServer(GiftWrapMode.EPHEMERAL);
    await expect(invoke(GiftWrapMode.EPHEMERAL, 'explicit_gating')).rejects.toThrow(
      'Unsupported payment_interaction mode: explicit_gating'
    );
    expect(relay.events[0]?.kind).toBe(21059);
    expect(received).not.toContain('tools/call');
  });
});
