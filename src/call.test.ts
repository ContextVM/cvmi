import { describe, expect, it } from 'vitest';
import { EncryptionMode } from '@contextvm/sdk';
import { __test__, parseCallArgs, showCallHelp } from './call.ts';
import { stripAnsi } from './test-utils.ts';

describe('parseCallArgs', () => {
  it('parses server, capability, flags, and key=value input', () => {
    const parsed = parseCallArgs([
      'weather',
      'weather.get_current',
      'city=Lisbon',
      'days=3',
      '--raw',
      '--debug',
      '--verbose',
      '--relays',
      'wss://relay.example.com,wss://relay.two',
      '--encryption-mode',
      'required',
      '--stateful',
    ]);

    expect(parsed.server).toBe('weather');
    expect(parsed.capability).toBe('weather.get_current');
    expect(parsed.input).toEqual({ city: 'Lisbon', days: 3 });
    expect(parsed.debug).toBe(true);
    expect(parsed.raw).toBe(true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.relays).toEqual(['wss://relay.example.com', 'wss://relay.two']);
    expect(parsed.encryption).toBe(EncryptionMode.REQUIRED);
    expect(parsed.isStateless).toBe(false);
    expect(parsed.unknownFlags).toEqual([]);
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
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      const target = __test__.resolveServerTarget(
        {
          use: {},
        },
        'nprofile1qqs82p5zxq7f7rw66av5rdy7mjw5dcldxp4eacen2vu2yx37gpx9lgcpr9mhxue69uhhyetvv9ujucm0de6x27r5wekjummjvu4speke',
        {}
      );

      __test__.printServerSummary(target, [] as any);
    } finally {
      console.log = log;
    }

    expect(output.map((line) => stripAnsi(line))).toEqual([
      'Server',
      '  Identity: nprofile1qqs82p5zxq7f7rw66av5rdy7mjw5dcldxp4eacen2vu2yx37gpx9lgcpr9mhxue69uhhyetvv9ujucm0de6x27r5wekjummjvu4speke',
      '  Relays: wss://relay.contextvm.org',
      '  Tools: 0',
      '',
      '  (no tools exposed)',
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

  it('renders server help summary with a single server pubkey line', () => {
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

      __test__.renderDefaultResult({ content: [], structuredContent: null });
      output.length = 0;

      const tools = [
        {
          name: 'search_profiles',
          description: 'Search profiles',
          inputSchema: { type: 'object' },
        },
      ] as any;

      __test__.printServerSummary(target, tools);
    } finally {
      console.log = log;
    }

    expect(output.map((line) => stripAnsi(line))).toEqual([
      'Server',
      '  Identity: npub1w5rgyvpunuxa446egx6fahyagm376vrtnm3nx5ec5gdruszvt73spqeu4t (relatr)',
      '  Relays: wss://relay.contextvm.org',
      '  Tools: 1',
      '',
      '  • search_profiles — Search profiles',
    ]);
  });

  it('renders nprofile server identities without forcing npub normalization', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      __test__.printServerSummary(
        {
          input: 'nprofile1example',
          server: 'nprofile1example',
          relays: ['wss://relay.contextvm.org'],
          encryption: EncryptionMode.OPTIONAL,
          isStateless: true,
        },
        [] as any
      );
    } finally {
      console.log = log;
    }

    expect(output.map((line) => stripAnsi(line))).toEqual([
      'Server',
      '  Identity: nprofile1example',
      '  Relays: wss://relay.contextvm.org',
      '  Tools: 0',
      '',
      '  (no tools exposed)',
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
      '',
      'Capability',
      '  Name: search_profiles',
      '  Kind: tool',
      '  Description: Search profiles',
      '',
      'Input',
      '  - query: string',
      'Output',
      '  - results: object[]',
      '    - pubkey: string',
      '    - trustScore: number',
      '  - totalFound: integer',
      '  - searchTimeMs: integer',
    ]);
  });

  it('documents config-backed aliases in call help', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      showCallHelp();
    } finally {
      console.log = log;
    }

    const help = output.map((line) => stripAnsi(line)).join('\n');
    expect(help).toContain(
      'Configuration Sources (priority: CLI > custom config (--config) > project .cvmi.json > global ~/.cvmi/config.json > env vars):'
    );
    expect(help).toContain('cvmi config add <alias> <pubkey>');
    expect(help).toContain('cvmi call <alias> <tool>');
  });
});
