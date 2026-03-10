import { describe, expect, it } from 'vitest';
import { parseDiscoverArgs, showDiscoverHelp } from './discover.ts';
import { stripAnsi } from './test-utils.ts';

describe('parseDiscoverArgs', () => {
  it('parses supported flags', () => {
    const parsed = parseDiscoverArgs([
      '--relays',
      'wss://relay.one,wss://relay.two',
      '--limit',
      '10',
      '--raw',
      '--verbose',
    ]);

    expect(parsed.relays).toEqual(['wss://relay.one', 'wss://relay.two']);
    expect(parsed.limit).toBe(10);
    expect(parsed.raw).toBe(true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.unknownFlags).toEqual([]);
  });

  it('marks help without requiring additional arguments', () => {
    const parsed = parseDiscoverArgs(['--help']);

    expect(parsed.help).toBe(true);
    expect(parsed.unknownFlags).toEqual([]);
  });

  it('tracks invalid values and extra positional arguments', () => {
    const parsed = parseDiscoverArgs(['server', '--limit', 'abc', '--wat']);

    expect(parsed.unknownFlags).toEqual(['server', '--limit (abc)', '--wat']);
  });

  it('documents relay-based discovery and raw output in help', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      showDiscoverHelp();
    } finally {
      console.log = log;
    }

    const help = output.map((line) => stripAnsi(line)).join('\n');
    expect(help).toContain('cvmi discover [options]');
    expect(help).toContain('Query relays for public ContextVM server announcements (kind 11316).');
    expect(help).toContain('cvmi discover --raw');
  });

  it('keeps discover output focused on server metadata in help examples', () => {
    const output: string[] = [];
    const log = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));

    try {
      showDiscoverHelp();
    } finally {
      console.log = log;
    }

    const help = output.map((line) => stripAnsi(line)).join('\n');
    expect(help).toContain('Query relays for public ContextVM server announcements (kind 11316).');
    expect(help).toContain('cvmi discover --limit 10');
  });
});
