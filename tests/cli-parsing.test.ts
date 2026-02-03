/**
 * Unit tests for CLI parsing of serve and use commands
 *
 * These tests import the real parsing logic from src/cli.ts via __test__ exports,
 * to avoid drift between CLI behavior and tests.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/cli.ts';

// Minimal helper to mirror serve's help-gating behavior in src/cli.ts.
function serveShouldShowHelp(restArgs: string[]): boolean {
  const separatorIndex = restArgs.indexOf('--');
  const beforeSeparator = separatorIndex === -1 ? restArgs : restArgs.slice(0, separatorIndex);
  return beforeSeparator.includes('--help') || beforeSeparator.includes('-h');
}

describe('CLI Argument Parsing', () => {
  describe('parseServeArgs', () => {
    it('collects command+args tokens (no flags)', () => {
      const result = __test__.parseServeArgs([
        'npx',
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ]);
      expect(result.serverArgs).toEqual([
        'npx',
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ]);
      expect(result.verbose).toBe(false);
      expect(result.unknownFlags).toEqual([]);
    });

    it('supports flags before command tokens', () => {
      const result = __test__.parseServeArgs([
        '--verbose',
        '--relays',
        'wss://relay1.com,wss://relay2.com',
        'npx',
        '-y',
        'server',
      ]);
      expect(result.verbose).toBe(true);
      expect(result.relays).toEqual(['wss://relay1.com', 'wss://relay2.com']);
      expect(result.serverArgs).toEqual(['npx', '-y', 'server']);
      expect(result.unknownFlags).toEqual([]);
    });

    it('supports flags after command tokens', () => {
      const result = __test__.parseServeArgs([
        'python',
        '/path/to/server.py',
        '--verbose',
        '--public',
      ]);
      expect(result.serverArgs).toEqual(['python', '/path/to/server.py']);
      expect(result.verbose).toBe(true);
      expect(result.public).toBe(true);
      expect(result.unknownFlags).toEqual([]);
    });

    it('allows http(s) URL as the first positional target (remote Streamable HTTP)', () => {
      const result = __test__.parseServeArgs(['https://my.mcp.com/mcp/', '--verbose']);
      expect(result.serverArgs).toEqual(['https://my.mcp.com/mcp/']);
      expect(result.verbose).toBe(true);
      expect(result.unknownFlags).toEqual([]);
    });

    it('collects unknown flags for strict handling', () => {
      const result = __test__.parseServeArgs(['--encrpytion-mode', 'required', 'npx', 'server']);
      expect(result.unknownFlags).toEqual(['--encrpytion-mode']);
      // non-flag tokens are still collected
      expect(result.serverArgs).toEqual(['required', 'npx', 'server']);
    });

    it('supports `--` to separate cvmi flags from server args', () => {
      const result = __test__.parseServeArgs(['--verbose', '--', 'npx', '-y', 'server', '--help']);
      expect(result.verbose).toBe(true);
      expect(result.serverArgs).toEqual(['npx', '-y', 'server', '--help']);
      expect(result.unknownFlags).toEqual([]);

      // `--help` after separator should NOT trigger cvmi help
      expect(serveShouldShowHelp(['--verbose', '--', 'npx', '--help'])).toBe(false);
    });

    it('errors if non-flag tokens appear before `--`', () => {
      const result = __test__.parseServeArgs(['npx', '--', 'server']);
      expect(result.unknownFlags).toEqual(['npx']);
      expect(result.serverArgs).toEqual(['server']);
    });
  });

  describe('parseUseArgs', () => {
    it('parses server pubkey as positional', () => {
      const result = __test__.parseUseArgs(['npub1abcdef123456']);
      expect(result.serverPubkey).toBe('npub1abcdef123456');
      expect(result.unknownFlags).toEqual([]);
    });

    it('prefers --server-pubkey flag over positional', () => {
      const result = __test__.parseUseArgs([
        '--server-pubkey',
        'npub1fromflag',
        'npub1frompositional',
      ]);
      expect(result.serverPubkey).toBe('npub1fromflag');
      expect(result.unknownFlags).toEqual([]);
    });

    it('collects unknown flags for strict handling', () => {
      const result = __test__.parseUseArgs(['--server-pubkye', 'npub1oops']);
      expect(result.unknownFlags).toEqual(['--server-pubkye']);
    });

    it('reports missing value for flags that require them', () => {
      const result = __test__.parseUseArgs(['--private-key']);
      expect(result.unknownFlags).toEqual(['--private-key (missing value)']);
      expect(result.privateKey).toBeUndefined();
    });

    it('reports missing value when another flag follows', () => {
      const result = __test__.parseUseArgs(['--private-key', '--verbose']);
      expect(result.unknownFlags).toEqual(['--private-key (missing value)']);
      // The --verbose should still be processed
      expect(result.verbose).toBe(true);
    });
  });

  describe('parseServeArgs missing value handling', () => {
    it('reports missing value for --private-key', () => {
      const result = __test__.parseServeArgs(['--private-key']);
      expect(result.unknownFlags).toEqual(['--private-key (missing value)']);
    });

    it('reports missing value for --relays', () => {
      const result = __test__.parseServeArgs(['--relays']);
      expect(result.unknownFlags).toEqual(['--relays (missing value)']);
    });

    it('reports missing value for --encryption-mode', () => {
      const result = __test__.parseServeArgs(['--encryption-mode']);
      expect(result.unknownFlags).toEqual(['--encryption-mode (missing value)']);
    });

    it('reports missing value for --config', () => {
      const result = __test__.parseServeArgs(['--config']);
      expect(result.unknownFlags).toEqual(['--config (missing value)']);
    });

    it('reports missing value with -- separator', () => {
      const result = __test__.parseServeArgs(['--private-key', '--', 'server']);
      expect(result.unknownFlags).toEqual(['--private-key (missing value)']);
      expect(result.serverArgs).toEqual(['server']);
    });
  });
});
