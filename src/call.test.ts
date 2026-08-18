import { describe, expect, it, vi } from 'vitest';
import { EncryptionMode } from '@contextvm/sdk';
import { nip19 } from 'nostr-tools';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';
import {
  __test__,
  call,
  parseCallArgs,
  resetCreateRemoteClientFactoryForTests,
  setCreateRemoteClientFactoryForTests,
} from './call.ts';
import { stripAnsi } from './test-utils.ts';
import { PAYMENT_REQUIRED_ERROR_CODE } from '@contextvm/sdk/payments/constants';
import { DEFAULT_RELAYS } from './config/index.ts';

function captureConsoleOutput(render: () => void): string[] {
  const output: string[] = [];
  const log = console.log;
  console.log = (message?: unknown) => output.push(String(message ?? ''));

  try {
    render();
  } finally {
    console.log = log;
  }

  return output.map((line) => stripAnsi(line));
}

async function captureConsoleOutputAsync(render: () => Promise<void>): Promise<string[]> {
  const output: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (message?: unknown) => output.push(String(message ?? ''));
  console.error = (message?: unknown) => output.push(String(message ?? ''));

  try {
    await render();
  } finally {
    console.log = log;
    console.error = error;
  }

  return output.map((line) => stripAnsi(line));
}

describe('parseCallArgs', () => {
  it('parses server, capability, flags, and key=value input', () => {
    const parsed = parseCallArgs([
      'weather',
      'weather.get_current',
      'city=Lisbon',
      'days=3',
      '--raw',
      '--pretty-raw',
      '--extract',
      'content[0].data',
      '--debug',
      '--verbose',
      '--relays',
      'wss://relay.example.com,wss://relay.two',
      '--encryption-mode',
      'required',
      '--stateful',
      '--timeout',
      '45000',
    ]);

    expect(parsed.server).toBe('weather');
    expect(parsed.capability).toBe('weather.get_current');
    expect(parsed.input).toEqual({ city: 'Lisbon', days: 3 });
    expect(parsed.debug).toBe(true);
    expect(parsed.raw).toBe(true);
    expect(parsed.prettyRaw).toBe(true);
    expect(parsed.extract).toBe('content[0].data');
    expect(parsed.verbose).toBe(true);
    expect(parsed.relays).toEqual(['wss://relay.example.com', 'wss://relay.two']);
    expect(parsed.encryption).toBe(EncryptionMode.REQUIRED);
    expect(parsed.isStateless).toBe(false);
    expect(parsed.timeout).toBe(45000);
    expect(parsed.showServerDetails).toBe(false);
    expect(parsed.paymentMode).toBe('transparent');
  });

  it('parses --payment-mode flag', () => {
    const transparent = parseCallArgs(['server', '--payment-mode', 'transparent']);
    expect(transparent.paymentMode).toBe('transparent');

    const explicit = parseCallArgs(['server', '--payment-mode', 'explicit_gating']);
    expect(explicit.paymentMode).toBe('explicit_gating');
  });

  it('rejects invalid --payment-mode flag', () => {
    const invalid = parseCallArgs(['server', '--payment-mode', 'invalid_mode']);
    expect(invalid.paymentMode).toBe('transparent'); // defaults to transparent
    expect(invalid.unknownFlags).toEqual(['--payment-mode (invalid_mode)']);
  });

  it('parses flags intermixed with kv pairs', () => {
    const parsed = parseCallArgs(['weather', '--details']);

    expect(parsed.server).toBe('weather');
    expect(parsed.showServerDetails).toBe(true);
  });

  it('enables stateless mode explicitly', () => {
    const parsed = parseCallArgs(['weather', 'tool:ping', '--stateless']);

    expect(parsed.isStateless).toBe(true);
  });

  it('tracks unknown flags and extra positional arguments', () => {
    const parsed = parseCallArgs(['weather', 'tool:ping', '--wat', 'extra']);

    expect(parsed.server).toBe('weather');
    expect(parsed.capability).toBe('tool:ping');
    expect(parsed.unknownFlags).toEqual(['--wat', 'extra']);
  });

  it('marks help without requiring a server', () => {
    const parsed = parseCallArgs(['--help']);

    expect(parsed.help).toBe(true);
    expect(parsed.server).toBeUndefined();
    expect(parsed.unknownFlags).toEqual([]);
  });

  it('rejects non-positive and non-numeric timeout values', () => {
    expect(parseCallArgs(['weather', '--timeout', '0']).unknownFlags).toEqual(['--timeout (0)']);
    expect(parseCallArgs(['weather', '--timeout', 'soon']).unknownFlags).toEqual([
      '--timeout (soon)',
    ]);
    expect(parseCallArgs(['weather', '--timeout', '2147483648']).unknownFlags).toEqual([
      '--timeout (2147483648)',
    ]);
  });

  it('uses server announcements to disable optional encryption only when unsupported', async () => {
    const target = {
      input: 'weather',
      server: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
      relays: ['wss://relay.contextvm.org'],
      encryption: EncryptionMode.OPTIONAL,
      isStateless: true,
    };

    await expect(
      __test__.resolveEffectiveEncryptionMode(target, 1000, async () => false)
    ).resolves.toBe(EncryptionMode.DISABLED);
    await expect(
      __test__.resolveEffectiveEncryptionMode(target, 1000, async () => true)
    ).resolves.toBe(EncryptionMode.OPTIONAL);
    await expect(
      __test__.resolveEffectiveEncryptionMode(target, 1000, async () => undefined)
    ).resolves.toBe(EncryptionMode.OPTIONAL);
    await expect(
      __test__.resolveEffectiveEncryptionMode(
        { ...target, encryption: EncryptionMode.REQUIRED },
        1000,
        async () => false
      )
    ).rejects.toThrow('does not advertise encryption support');
  });

  it('falls back to bootstrap relays for a relay-less nprofile announcement lookup', () => {
    const server = nip19.nprofileEncode({
      pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
      relays: [],
    });

    expect(
      __test__.getDisplayRelays({
        input: server,
        server,
        encryption: EncryptionMode.OPTIONAL,
        isStateless: true,
      })
    ).toEqual(DEFAULT_RELAYS);
  });

  it('extracts nested result values with array access', () => {
    expect(
      __test__.extractResultValue(
        {
          content: [
            {
              data: 'aGVsbG8=',
            },
          ],
        },
        'content[0].data'
      )
    ).toBe('aGVsbG8=');
  });

  it('rejects invalid extract paths', () => {
    expect(() => __test__.extractResultValue({ content: [] }, 'content[')).toThrow(
      'Invalid extract path: content['
    );
  });

  it('rejects missing extract paths', () => {
    expect(() => __test__.extractResultValue({ content: [] }, 'content[0].data')).toThrow(
      'Extract path not found: content[0].data'
    );
  });

  it('renders structuredContent in a readable format by default', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      __test__.renderDefaultResult({
        content: [],
        structuredContent: {
          timestamp: 1773006630,
          database: {
            metrics: {
              totalEntries: 0,
            },
          },
        },
      });
    } finally {
      console.log = log;
    }

    expect(output).toEqual([
      'timestamp: 1773006630',
      'database:',
      '  metrics:',
      '    totalEntries: 0',
    ]);
  });

  it('defaults call transport to stateless when config does not specify it', () => {
    const target = __test__.resolveServerTarget(
      {
        servers: {
          relatr: {
            pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
            relays: ['wss://relay.contextvm.org'],
          },
        },
        use: {},
      },
      'relatr',
      {}
    );

    expect(target.isStateless).toBe(true);
  });

  it('uses configured stateless value when present in use config', () => {
    const target = __test__.resolveServerTarget(
      {
        use: {
          isStateless: false,
        },
      },
      '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
      {}
    );

    expect(target.isStateless).toBe(false);
  });

  it('preserves nprofile server identities for the SDK transport', () => {
    const target = __test__.resolveServerTarget(
      {
        use: {},
      },
      'nprofile1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqspz4mhxue69uhhyetvv9ujumn0wd68ytnzv9hxgqgswaehxw309ahx7um5wghxuet5d9hkummnw3ezuamfdejsygzx0ps',
      {}
    );

    expect(target.server).toBe(
      'nprofile1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqspz4mhxue69uhhyetvv9ujumn0wd68ytnzv9hxgqgswaehxw309ahx7um5wghxuet5d9hkummnw3ezuamfdejsygzx0ps'
    );
    expect(target.relays).toBeUndefined();
  });

  it('uses nprofile relay hints in server summary when no explicit relays are configured', () => {
    const output = captureConsoleOutput(() => {
      const target = __test__.resolveServerTarget(
        {
          use: {},
        },
        'nprofile1qqs82p5zxq7f7rw66av5rdy7mjw5dcldxp4eacen2vu2yx37gpx9lgcpr9mhxue69uhhyetvv9ujucm0de6x27r5wekjummjvu4speke',
        {}
      );

      __test__.printServerHelp(target, [] as any, undefined);
    });

    expect(output).toEqual([
      'Usage',
      '  cvmi call <server> <tool> [key=value ...] [options]',
      '',
      'Server',
      '  Identity: nprofile1qqs82p5zxq7f7rw66av5rdy7mjw5dcldxp4eacen2vu2yx37gpx9lgcpr9mhxue69uhhyetvv9ujucm0de6x27r5wekjummjvu4speke',
      '',
      '  (no tools exposed)',
      '',
      'Invoke',
      '  Use key=value arguments. Quote the full argument when passing JSON values, e.g. \'targets=["a","b"]\'.',
      '  Use cvmi call nprofile1qqs82p5zxq7f7rw66av5rdy7mjw5dcldxp4eacen2vu2yx37gpx9lgcpr9mhxue69uhhyetvv9ujucm0de6x27r5wekjummjvu4speke <tool> --help for full input/output details.',
    ]);
  });

  it('preserves explicit configured relays for nprofile aliases', () => {
    const target = __test__.resolveServerTarget(
      {
        servers: {
          relatr: {
            pubkey:
              'nprofile1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqspz4mhxue69uhhyetvv9ujumn0wd68ytnzv9hxgqgswaehxw309ahx7um5wghxuet5d9hkummnw3ezuamfdejsygzx0ps',
            relays: ['wss://override.example'],
          },
        },
      },
      'relatr',
      {}
    );

    expect(target.relays).toEqual(['wss://override.example']);
  });

  it('rejects unknown aliases with config list guidance', () => {
    expect(() =>
      __test__.assertKnownServerInput(
        {
          servers: {
            relatr: {
              pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
            },
          },
        },
        'weather'
      )
    )
      .toThrowErrorMatchingInlineSnapshot(`[Error: Unknown server alias or invalid server identity: weather
Run \`cvmi config list\` to see configured aliases.
Or pass a direct server identity in hex, npub, or nprofile format.]`);
  });

  it('accepts direct server identities without requiring an alias', () => {
    expect(() =>
      __test__.assertKnownServerInput(
        {
          servers: {},
        },
        'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp4mhxue69uhkummn9ekx7mp0d3skjtnrdakj7q'
      )
    ).not.toThrow();
  });

  it('renders unified server help with a single server pubkey line', () => {
    const output = captureConsoleOutput(() => {
      const target = __test__.resolveServerTarget(
        {
          servers: {
            relatr: {
              pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
              relays: ['wss://relay.contextvm.org'],
            },
          },
        },
        'relatr',
        {}
      );

      const tools = [
        {
          name: 'search_profiles',
          description: 'Search profiles',
          inputSchema: { type: 'object' },
        },
      ] as any;

      __test__.printServerHelp(target, tools, undefined);
    });

    expect(output).toEqual([
      'Usage',
      '  cvmi call <server> <tool> [key=value ...] [options]',
      '',
      'Server',
      '  Name: relatr',
      '',
      '  • search_profiles — Search profiles',
      '',
      'Invoke',
      '  Use key=value arguments. Quote the full argument when passing JSON values, e.g. \'targets=["a","b"]\'.',
      '  Use cvmi call relatr <tool> --help for full input/output details.',
    ]);
  });

  it('renders detailed alias server help when details are requested', () => {
    const output = captureConsoleOutput(() => {
      const target = __test__.resolveServerTarget(
        {
          servers: {
            relatr: {
              pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
              relays: ['wss://relay.contextvm.org'],
              description: 'Social graph search',
            },
          },
        },
        'relatr',
        {}
      );

      __test__.printServerHelp(
        target,
        [{ name: 'search_profiles', inputSchema: { type: 'object' } }] as any,
        undefined,
        {
          showServerDetails: true,
        }
      );
    });

    expect(output).toEqual([
      'Usage',
      '  cvmi call <server> <tool> [key=value ...] [options]',
      '',
      'Server',
      '  Name: relatr',
      '  About: Social graph search',
      '  Identity: npub1w5rgyvpunuxa446egx6fahyagm376vrtnm3nx5ec5gdruszvt73spqeu4t',
      '  Relays: wss://relay.contextvm.org',
      '  Tools: 1',
      '',
      '  • search_profiles',
      '',
      'Invoke',
      '  Use key=value arguments. Quote the full argument when passing JSON values, e.g. \'targets=["a","b"]\'.',
      '  Use cvmi call relatr <tool> --help for full input/output details.',
    ]);
  });

  it('renders nprofile server identities without forcing npub normalization', () => {
    const output = captureConsoleOutput(() => {
      __test__.printServerHelp(
        {
          input: 'nprofile1example',
          server: 'nprofile1example',
          relays: ['wss://relay.contextvm.org'],
          encryption: EncryptionMode.OPTIONAL,
          isStateless: true,
        },
        [] as any,
        undefined
      );
    });

    expect(output).toEqual([
      'Usage',
      '  cvmi call <server> <tool> [key=value ...] [options]',
      '',
      'Server',
      '  Identity: nprofile1example',
      '',
      '  (no tools exposed)',
      '',
      'Invoke',
      '  Use key=value arguments. Quote the full argument when passing JSON values, e.g. \'targets=["a","b"]\'.',
      '  Use cvmi call nprofile1example <tool> --help for full input/output details.',
    ]);
  });

  it('renders output schema in tool help using human-readable schema lines', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      const target = __test__.resolveServerTarget(
        {
          servers: {
            relatr: {
              pubkey: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
              relays: ['wss://relay.contextvm.org'],
            },
          },
        },
        'relatr',
        {}
      );

      __test__.printToolHelp(target, {
        name: 'search_profiles',
        description: 'Search profiles',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pubkey: { type: 'string' },
                  trustScore: { type: 'number' },
                },
                required: ['pubkey', 'trustScore'],
              },
            },
            totalFound: { type: 'integer' },
            searchTimeMs: { type: 'integer' },
          },
          required: ['results', 'totalFound', 'searchTimeMs'],
        },
      } as any);
    } finally {
      console.log = log;
    }

    expect(output.map((line) => stripAnsi(line))).toEqual([
      'Usage',
      '  cvmi call relatr search_profiles [key=value ...] [options]',
      '  Search profiles',
      '',
      'Input',
      '  Pass strings as key=value. Pass arrays/objects as quoted JSON in the value, e.g. \'targets=["a","b"]\'.',
      '  Quote the full key=value argument to avoid shell expansion in zsh and similar shells.',
      '  - query: string',
      'Output',
      '  - results: object[]',
      '    - pubkey: string',
      '    - trustScore: number',
      '  - totalFound: integer',
      '  - searchTimeMs: integer',
    ]);
  });

  it('renders compact input signatures in server tool lists', () => {
    const output = captureConsoleOutput(() => {
      __test__.printServerHelp(
        {
          input: 'relatr',
          server: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
          relays: ['wss://relay.contextvm.org'],
          encryption: EncryptionMode.OPTIONAL,
          isStateless: true,
          aliasName: 'relatr',
        },
        [
          {
            name: 'search_profiles',
            description: 'Search profiles',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer' },
                pubkeys: { type: 'array', items: { type: 'string' } },
              },
              required: ['query'],
            },
          },
        ] as any,
        undefined
      );
    });

    expect(output).toContain(
      '  • search_profiles query:string limit?:integer pubkeys?:string[] — Search profiles'
    );
  });

  it('prefers server initialize metadata over identity in default server summary', () => {
    const output = captureConsoleOutput(() => {
      __test__.printServerHelp(
        {
          input: 'npub1example',
          server: '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
          relays: ['wss://relay.contextvm.org'],
          encryption: EncryptionMode.OPTIONAL,
          isStateless: true,
        },
        [] as any,
        {
          name: 'Relatr',
          about: 'Social graph search',
        }
      );
    });

    expect(output).toEqual([
      'Usage',
      '  cvmi call <server> <tool> [key=value ...] [options]',
      '',
      'Server',
      '  Name: Relatr',
      '  About: Social graph search',
      '',
      '  (no tools exposed)',
      '',
      'Invoke',
      '  Use key=value arguments. Quote the full argument when passing JSON values, e.g. \'targets=["a","b"]\'.',
      '  Use cvmi call npub1example <tool> --help for full input/output details.',
    ]);
  });

  it('builds actionable missing-tool guidance', () => {
    expect(__test__.buildMissingToolError('relatr', 'missing_tool').message).toBe(
      [
        'Tool not found: missing_tool',
        'Run `cvmi call relatr` to list available tools on this server.',
        'Run `cvmi call relatr <tool> --help` to inspect a specific tool.',
      ].join('\n')
    );
  });

  it('suggests a close tool name in missing-tool guidance', () => {
    expect(
      __test__.buildMissingToolError('relatr', 'search_profile', ['search_profiles']).message
    ).toBe(
      [
        'Tool not found: search_profile',
        'Did you mean: search_profiles',
        'Run `cvmi call relatr` to list available tools on this server.',
        'Run `cvmi call relatr <tool> --help` to inspect a specific tool.',
      ].join('\n')
    );
  });

  it('prints server help when a requested tool is missing during invocation', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'search',
          description: 'Search for information',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ],
    });
    const callTool = vi
      .fn()
      .mockRejectedValue(new Error('Tool not found: height of the eiffel tower'));
    const close = vi.fn().mockResolvedValue(undefined);
    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        transport: {
          getServerToolsListEvent: () => undefined,
          getServerInitializeEvent: () => undefined,
        },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const output = await captureConsoleOutputAsync(async () => {
      exitCode = await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'height of the eiffel tower',
        {},
        { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
      );
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
    expect(close).toHaveBeenCalled();
    expect(output.join('\n')).toContain('Tool not found: height of the eiffel tower');
    expect(output.join('\n')).toContain('cvmi call <server> <tool> [key=value ...] [options]');
    expect(output.join('\n')).toContain('search');

    resetCreateRemoteClientFactoryForTests();
  });

  it('enables MCP progress handling by default for tool calls', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_media_file',
          description: 'Read media',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        metadata: {},
        close,
      }) as never
    );

    await call(
      '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
      'read_media_file',
      { path: './ot-demo/img.jpg' },
      { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
    );

    expect(listTools).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'read_media_file',
        arguments: { path: './ot-demo/img.jpg' },
      },
      undefined,
      expect.objectContaining({
        onprogress: expect.any(Function),
        resetTimeoutOnProgress: true,
        timeout: 60000,
        maxTotalTimeout: 300000,
      })
    );

    resetCreateRemoteClientFactoryForTests();
  });

  it('prints progress updates when verbose mode is enabled', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_media_file',
          description: 'Read media',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      ],
    });
    const callTool = vi.fn().mockImplementation(
      async (
        _request: unknown,
        _resultSchema: unknown,
        options?: {
          onprogress?: (progress: Progress) => void;
          resetTimeoutOnProgress?: boolean;
        }
      ) => {
        options?.onprogress?.({
          progress: 2,
          total: 4,
          message: 'starting oversized transfer',
        });
        return { content: [] };
      }
    );
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        metadata: {},
        close,
      }) as never
    );

    const output = await captureConsoleOutputAsync(async () => {
      await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        { path: './ot-demo/img.jpg' },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          verbose: true,
        }
      );
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('Progress: 2/4 starting oversized transfer');

    resetCreateRemoteClientFactoryForTests();
  });

  it('prints compact raw JSON by default', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_media_file',
          description: 'Read media',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue({ content: [{ data: 'abc' }] });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const output = await captureConsoleOutputAsync(async () => {
      exitCode = await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        { path: './ot-demo/img.jpg' },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          raw: true,
        }
      );
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(output).toContain('{"content":[{"data":"abc"}]}');
    expect(exitCode).toBe(0);

    resetCreateRemoteClientFactoryForTests();
  });

  it('keeps verbose diagnostics off stdout in raw mode', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
        },
        metadata: {},
        close,
      }) as never
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (message?: unknown) => stdout.push(String(message ?? ''));
    console.error = (message?: unknown) => stderr.push(String(message ?? ''));
    try {
      await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        { path: './ot-demo/img.jpg' },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          raw: true,
          verbose: true,
        }
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(stdout).toHaveLength(1);
    expect(() => JSON.parse(stdout[0]!)).not.toThrow();
    expect(stderr.join('\n')).toContain('Connecting to');
    expect(stderr.join('\n')).toContain('Calling tool: read_media_file');
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('returns a non-zero status for MCP tool error results after rendering them', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Unknown model' }],
      isError: true,
    });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: { callTool },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const output = await captureConsoleOutputAsync(async () => {
      exitCode = await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'chat.complete',
        { model: 'missing' },
        { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
      );
    });

    expect(output).toContain('Unknown model');
    expect(exitCode).toBe(1);
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('prints CEP-41 chunks and returns the terminal tool result', async () => {
    const dispose = vi.fn();
    const abort = vi.fn().mockResolvedValue(undefined);
    const terminalResult = {
      content: [],
      structuredContent: { finish_reason: 'stop' },
    };
    let resolveResult!: (value: typeof terminalResult) => void;
    const resultPromise = new Promise<typeof terminalResult>((resolve) => {
      resolveResult = resolve;
    });
    const stream = {
      isActive: true,
      abort,
      dispose,
      async *[Symbol.asyncIterator]() {
        yield {
          chunkIndex: 0,
          value: '{"object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}',
        };
        yield {
          chunkIndex: 1,
          value: '{"object":"chat.completion.chunk","choices":[{"delta":{"content":"hello"}}]}',
        };
        resolveResult(terminalResult);
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield {
          chunkIndex: 2,
          value: '{"object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}',
        };
        yield {
          chunkIndex: 3,
          value:
            '{"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":7}}',
        };
      },
    };
    const prepareOutboundOpenStreamSession = vi.fn().mockResolvedValue({
      progressToken: 'stream-token',
      stream,
    });
    const callTool = vi.fn().mockReturnValue(resultPromise);
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: { callTool },
        transport: { prepareOutboundOpenStreamSession },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const streamedOutput: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      streamedOutput.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    let output: string[] = [];
    try {
      output = await captureConsoleOutputAsync(async () => {
        exitCode = await call(
          '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
          'chat.complete',
          { model: 'faux-1', stream: true },
          { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
        );
      });
    } finally {
      writeSpy.mockRestore();
    }

    expect(streamedOutput.join('')).toBe('hello world\n');
    expect(output.join('\n')).not.toContain('chat.completion.chunk');
    expect(output.join('\n')).toContain('finish_reason: stop');
    expect(exitCode).toBe(0);
    expect(dispose).toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'chat.complete',
        arguments: { model: 'faux-1', stream: true },
      },
      undefined,
      expect.objectContaining({
        timeout: 60000,
        maxTotalTimeout: 300000,
      })
    );

    resetCreateRemoteClientFactoryForTests();
  });

  it('does not hang when a streaming call fails before the first chunk', async () => {
    const dispose = vi.fn();
    const stream = {
      dispose,
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<{ chunkIndex: number; value: string }>>(() => {}),
        };
      },
    };
    const prepareOutboundOpenStreamSession = vi.fn().mockResolvedValue({
      progressToken: 'stream-token',
      stream,
    });
    const rejection = new Error('Payment Required') as Error & { code: number };
    rejection.code = PAYMENT_REQUIRED_ERROR_CODE;
    const callTool = vi.fn().mockRejectedValue(rejection);
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: { callTool },
        transport: { prepareOutboundOpenStreamSession },
        metadata: {},
        close,
      }) as never
    );

    await expect(
      call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'chat.complete',
        { model: 'faux-1', stream: true },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          paymentMode: 'explicit_gating',
        }
      )
    ).rejects.toMatchObject({ name: 'ExplicitGatingError' });
    expect(dispose).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('aborts the producer when a call fails after streaming starts', async () => {
    const dispose = vi.fn();
    const abort = vi.fn().mockResolvedValue(undefined);
    let rejectResult!: (error: Error) => void;
    const resultPromise = new Promise<never>((_resolve, reject) => {
      rejectResult = reject;
    });
    const stream = {
      isActive: true,
      abort,
      dispose,
      async *[Symbol.asyncIterator]() {
        yield { chunkIndex: 0, value: '{"delta":"partial"}' };
        rejectResult(new Error('request timed out'));
        await new Promise(() => {});
      },
    };
    const prepareOutboundOpenStreamSession = vi.fn().mockResolvedValue({
      progressToken: 'stream-token',
      stream,
    });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: { callTool: vi.fn().mockReturnValue(resultPromise) },
        transport: { prepareOutboundOpenStreamSession },
        metadata: {},
        close,
      }) as never
    );

    await captureConsoleOutputAsync(async () => {
      await expect(
        call(
          '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
          'chat.complete',
          { model: 'faux-1', stream: true },
          {
            privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
            raw: true,
          }
        )
      ).rejects.toThrow('request timed out');
    });

    expect(abort).toHaveBeenCalledWith('request timed out');
    expect(dispose).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('disposes a pending stream when the terminal result is a tool error', async () => {
    const dispose = vi.fn();
    const prepareOutboundOpenStreamSession = vi.fn().mockResolvedValue({
      progressToken: 'stream-token',
      stream: {
        dispose,
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<{ chunkIndex: number; value: string }>>(() => {}),
          };
        },
      },
    });
    const close = vi.fn().mockResolvedValue(undefined);
    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Unknown model' }],
            isError: true,
          }),
        },
        transport: { prepareOutboundOpenStreamSession },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const output = await captureConsoleOutputAsync(async () => {
      exitCode = await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'chat.complete',
        { model: 'missing', stream: true },
        { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
      );
    });

    expect(output).toContain('Unknown model');
    expect(exitCode).toBe(1);
    expect(dispose).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('falls back to the terminal result when no stream frames arrive', async () => {
    const dispose = vi.fn();
    const prepareOutboundOpenStreamSession = vi.fn().mockResolvedValue({
      progressToken: 'stream-token',
      stream: {
        dispose,
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<{ chunkIndex: number; value: string }>>(() => {}),
          };
        },
      },
    });
    const close = vi.fn().mockResolvedValue(undefined);
    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'ordinary result' }],
          }),
        },
        transport: { prepareOutboundOpenStreamSession },
        metadata: {},
        close,
      }) as never
    );

    let exitCode: number | undefined;
    const output = await captureConsoleOutputAsync(async () => {
      exitCode = await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'chat.complete',
        { model: 'faux-1', stream: true },
        { privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h' }
      );
    });

    expect(output).toContain('ordinary result');
    expect(exitCode).toBe(0);
    expect(dispose).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('prints pretty raw JSON when requested', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_media_file',
          description: 'Read media',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue({ content: [{ data: 'abc' }] });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        metadata: {},
        close,
      }) as never
    );

    const output = await captureConsoleOutputAsync(async () => {
      await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        { path: './ot-demo/img.jpg' },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          raw: true,
          prettyRaw: true,
        }
      );
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('  "content": [');

    resetCreateRemoteClientFactoryForTests();
  });

  it('throws ExplicitGatingError for -32042 in explicit_gating mode', async () => {
    const listTools = vi.fn().mockResolvedValue({ tools: [] });
    const mockError = new Error('Payment Required') as any;
    mockError.code = PAYMENT_REQUIRED_ERROR_CODE;
    mockError.data = { foo: 'bar' };
    const callTool = vi.fn().mockRejectedValue(mockError);
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: { listTools, callTool },
        metadata: {},
        close,
      }) as never
    );

    let error: any;
    try {
      await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        {},
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          paymentMode: 'explicit_gating',
        }
      );
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.name).toBe('ExplicitGatingError');
    expect(error.data).toEqual({ foo: 'bar' });
    expect(close).toHaveBeenCalled();

    resetCreateRemoteClientFactoryForTests();
  });

  it('prints extracted string values without JSON encoding', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_media_file',
          description: 'Read media',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue({
      content: [{ data: 'aGVsbG8=' }],
    });
    const close = vi.fn().mockResolvedValue(undefined);

    setCreateRemoteClientFactoryForTests(
      vi.fn().mockResolvedValue({
        client: {
          listTools,
          callTool,
        },
        metadata: {},
        close,
      }) as never
    );

    const output = await captureConsoleOutputAsync(async () => {
      await call(
        '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3',
        'read_media_file',
        { path: './ot-demo/img.jpg' },
        {
          privateKey: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj4xw9h',
          extract: 'content[0].data',
        }
      );
    });

    expect(listTools).not.toHaveBeenCalled();
    expect(output).toContain('aGVsbG8=');

    resetCreateRemoteClientFactoryForTests();
  });

  describe('isPaymentRequiredError', () => {
    it('returns true for an error with code -32042', () => {
      const error = new Error('Payment Required') as any;
      error.code = PAYMENT_REQUIRED_ERROR_CODE;
      expect(__test__.isPaymentRequiredError(error)).toBe(true);
    });

    it('returns false for non-error objects', () => {
      expect(__test__.isPaymentRequiredError({ code: PAYMENT_REQUIRED_ERROR_CODE })).toBe(false);
      expect(__test__.isPaymentRequiredError(null)).toBe(false);
    });

    it('returns false for other error codes', () => {
      const error = new Error('Other Error') as any;
      error.code = -32601;
      expect(__test__.isPaymentRequiredError(error)).toBe(false);
    });
  });
});
