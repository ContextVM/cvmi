import { describe, expect, it } from 'vitest';
import { EncryptionMode } from '@contextvm/sdk';
import { __test__, parseCallArgs } from './call.ts';

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
    ]);

    expect(parsed.server).toBe('weather');
    expect(parsed.capability).toBe('weather.get_current');
    expect(parsed.input).toEqual({ city: 'Lisbon', days: 3 });
    expect(parsed.debug).toBe(true);
    expect(parsed.raw).toBe(true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.relays).toEqual(['wss://relay.example.com', 'wss://relay.two']);
    expect(parsed.encryption).toBe(EncryptionMode.REQUIRED);
    expect(parsed.unknownFlags).toEqual([]);
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
});
