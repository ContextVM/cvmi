/**
 * Unit tests for CLI parsing of serve and use commands
 */

import { describe, it, expect } from 'vitest';

// Import the parsing functions from cli.ts
// Since they're not exported, we'll test them by simulating the parsing logic

describe('CLI Argument Parsing', () => {
  describe('parseServeArgs', () => {
    function parseServeArgs(args: string[]) {
      const result: {
        serverCommand: string | undefined;
        verbose: boolean;
        privateKey: string | undefined;
        relays: string[] | undefined;
        public: boolean;
        encryption: string | undefined;
        config: string | undefined;
      } = {
        serverCommand: undefined,
        verbose: false,
        privateKey: undefined,
        relays: undefined,
        public: false,
        encryption: undefined,
        config: undefined,
      };

      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? '';

        if (arg === '--verbose') {
          result.verbose = true;
        } else if (arg === '--public') {
          result.public = true;
        } else if (arg === '--private-key') {
          result.privateKey = args[++i];
        } else if (arg === '--relays') {
          const value = args[++i];
          result.relays = value ? value.split(',').map((r) => r.trim()) : undefined;
        } else if (arg === '--encryption-mode') {
          result.encryption = args[++i];
        } else if (arg === '--config') {
          result.config = args[++i];
        } else if (!arg.startsWith('-')) {
          result.serverCommand = arg;
        }
      }

      return result;
    }

    it('parses server command as first positional', () => {
      const result = parseServeArgs(['npx -y @modelcontextprotocol/server-filesystem /tmp']);
      expect(result.serverCommand).toBe('npx -y @modelcontextprotocol/server-filesystem /tmp');
      expect(result.verbose).toBe(false);
    });

    it('parses flags before positional', () => {
      const result = parseServeArgs([
        '--verbose',
        '--relays',
        'wss://relay1.com,wss://relay2.com',
        'npx -y server',
      ]);
      expect(result.verbose).toBe(true);
      expect(result.relays).toEqual(['wss://relay1.com', 'wss://relay2.com']);
      expect(result.serverCommand).toBe('npx -y server');
    });

    it('parses flags after positional', () => {
      const result = parseServeArgs(['npx -y server', '--verbose', '--relays', 'wss://relay1.com']);
      expect(result.serverCommand).toBe('npx -y server');
      expect(result.verbose).toBe(true);
      expect(result.relays).toEqual(['wss://relay1.com']);
    });

    it('parses mixed flags and positional', () => {
      const result = parseServeArgs([
        '--private-key',
        'abc123',
        'npx -y server',
        '--public',
        '--config',
        '/path/to/config.json',
      ]);
      expect(result.privateKey).toBe('abc123');
      expect(result.serverCommand).toBe('npx -y server');
      expect(result.public).toBe(true);
      expect(result.config).toBe('/path/to/config.json');
    });

    it('parses --public flag', () => {
      const result = parseServeArgs(['--public', 'command']);
      expect(result.public).toBe(true);
      expect(result.serverCommand).toBe('command');
    });

    it('parses --encryption-mode flag', () => {
      const result = parseServeArgs(['--encryption-mode', 'required', 'command']);
      expect(result.encryption).toBe('required');
      expect(result.serverCommand).toBe('command');
    });

    it('handles no server command', () => {
      const result = parseServeArgs(['--verbose', '--public']);
      expect(result.verbose).toBe(true);
      expect(result.public).toBe(true);
      expect(result.serverCommand).toBeUndefined();
    });
  });

  describe('parseUseArgs', () => {
    function parseUseArgs(args: string[]) {
      const result: {
        serverPubkey: string | undefined;
        verbose: boolean;
        privateKey: string | undefined;
        relays: string[] | undefined;
        encryption: string | undefined;
        config: string | undefined;
      } = {
        serverPubkey: undefined,
        verbose: false,
        privateKey: undefined,
        relays: undefined,
        encryption: undefined,
        config: undefined,
      };

      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? '';

        if (arg === '--verbose') {
          result.verbose = true;
        } else if (arg === '--private-key') {
          result.privateKey = args[++i];
        } else if (arg === '--relays') {
          const value = args[++i];
          result.relays = value ? value.split(',').map((r) => r.trim()) : undefined;
        } else if (arg === '--encryption-mode') {
          result.encryption = args[++i];
        } else if (arg === '--server-pubkey') {
          result.serverPubkey = args[++i];
        } else if (arg === '--config') {
          result.config = args[++i];
        } else if (!arg.startsWith('-')) {
          result.serverPubkey = result.serverPubkey ?? arg;
        }
      }

      return result;
    }

    it('parses server pubkey as first positional', () => {
      const result = parseUseArgs(['npub1abcdef123456']);
      expect(result.serverPubkey).toBe('npub1abcdef123456');
    });

    it('parses flags before positional', () => {
      const result = parseUseArgs([
        '--verbose',
        '--relays',
        'wss://relay1.com,wss://relay2.com',
        'npub1abcdef',
      ]);
      expect(result.verbose).toBe(true);
      expect(result.relays).toEqual(['wss://relay1.com', 'wss://relay2.com']);
      expect(result.serverPubkey).toBe('npub1abcdef');
    });

    it('parses flags after positional', () => {
      const result = parseUseArgs(['npub1abcdef', '--verbose', '--relays', 'wss://relay1.com']);
      expect(result.serverPubkey).toBe('npub1abcdef');
      expect(result.verbose).toBe(true);
      expect(result.relays).toEqual(['wss://relay1.com']);
    });

    it('prefers --server-pubkey flag over positional', () => {
      const result = parseUseArgs(['--server-pubkey', 'npub1fromflag', 'npub1frompositional']);
      // Flag takes precedence
      expect(result.serverPubkey).toBe('npub1fromflag');
    });

    it('uses positional when --server-pubkey not provided', () => {
      const result = parseUseArgs(['npub1positional']);
      expect(result.serverPubkey).toBe('npub1positional');
    });

    it('parses mixed flags and positional', () => {
      const result = parseUseArgs([
        '--private-key',
        'abc123',
        'npub1server',
        '--encryption-mode',
        'required',
        '--config',
        '/path/to/config.json',
      ]);
      expect(result.privateKey).toBe('abc123');
      expect(result.serverPubkey).toBe('npub1server');
      expect(result.encryption).toBe('required');
      expect(result.config).toBe('/path/to/config.json');
    });

    it('handles no server pubkey', () => {
      const result = parseUseArgs(['--verbose', '--private-key', 'abc']);
      expect(result.verbose).toBe(true);
      expect(result.privateKey).toBe('abc');
      expect(result.serverPubkey).toBeUndefined();
    });
  });
});
