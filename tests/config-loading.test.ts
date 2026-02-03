/**
 * Unit tests for config loading module
 *
 * These tests verify:
 * - Environment variable loading
 * - Config file paths
 * - Config merging with priorities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadConfigFromEnv,
  getConfigPaths,
  getServeConfig,
  getUseConfig,
  savePrivateKeyToEnv,
  DEFAULT_RELAYS,
  DEFAULT_ENCRYPTION,
} from '../src/config/loader.ts';
import type { CvmiConfig } from '../src/config/types.ts';

describe('Config Paths', () => {
  describe('getConfigPaths', () => {
    it('returns correct global and project paths', () => {
      const paths = getConfigPaths();
      expect(paths.globalDir).toContain('.cvmi');
      expect(paths.globalConfig).toContain('config.json');
      expect(paths.projectConfig).toContain('.cvmi.json');
    });
  });
});

describe('Environment Variable Loading', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear any existing env vars
    delete process.env.CVMI_GATEWAY_PRIVATE_KEY;
    delete process.env.CVMI_GATEWAY_RELAYS;
    delete process.env.CVMI_GATEWAY_PUBLIC;
    delete process.env.CVMI_GATEWAY_ENCRYPTION;
    delete process.env.CVMI_SERVE_PRIVATE_KEY;
    delete process.env.CVMI_SERVE_RELAYS;
    delete process.env.CVMI_SERVE_PUBLIC;
    delete process.env.CVMI_SERVE_ENCRYPTION;
    delete process.env.CVMI_SERVE_URL;
    delete process.env.CVMI_GATEWAY_URL;
    delete process.env.CVMI_PROXY_PRIVATE_KEY;
    delete process.env.CVMI_PROXY_RELAYS;
    delete process.env.CVMI_PROXY_SERVER_PUBKEY;
    delete process.env.CVMI_PROXY_ENCRYPTION;
    delete process.env.CVMI_USE_PRIVATE_KEY;
    delete process.env.CVMI_USE_RELAYS;
    delete process.env.CVMI_USE_SERVER_PUBKEY;
    delete process.env.CVMI_USE_ENCRYPTION;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads serve private key from environment (legacy GATEWAY var)', () => {
    process.env.CVMI_GATEWAY_PRIVATE_KEY = 'test-private-key';
    const config = loadConfigFromEnv();
    expect(config.serve?.privateKey).toBe('test-private-key');
  });

  it('loads serve private key from environment (SERVE var)', () => {
    process.env.CVMI_SERVE_PRIVATE_KEY = 'test-private-key';
    const config = loadConfigFromEnv();
    expect(config.serve?.privateKey).toBe('test-private-key');
  });

  it('loads serve relays from environment as comma-separated', () => {
    process.env.CVMI_GATEWAY_RELAYS = 'wss://relay1.example.com,wss://relay2.example.com';
    const config = loadConfigFromEnv();
    expect(config.serve?.relays).toEqual(['wss://relay1.example.com', 'wss://relay2.example.com']);
  });

  it('loads serve public flag from environment', () => {
    process.env.CVMI_GATEWAY_PUBLIC = 'true';
    const config = loadConfigFromEnv();
    expect(config.serve?.public).toBe(true);
  });

  it('loads serve encryption mode from environment', () => {
    process.env.CVMI_SERVE_ENCRYPTION = 'required';
    const config = loadConfigFromEnv();
    expect(config.serve?.encryption).toBeDefined();
  });

  it('loads serve url from environment', () => {
    process.env.CVMI_SERVE_URL = 'https://example.com/mcp';
    const config = loadConfigFromEnv();
    expect(config.serve?.url).toBe('https://example.com/mcp');
  });

  it('loads use config from environment (legacy PROXY var)', () => {
    process.env.CVMI_PROXY_PRIVATE_KEY = 'proxy-key';
    process.env.CVMI_PROXY_SERVER_PUBKEY = 'proxy-pubkey';
    const config = loadConfigFromEnv();
    expect(config.use?.privateKey).toBe('proxy-key');
    expect(config.use?.serverPubkey).toBe('proxy-pubkey');
  });

  it('loads use config from environment (USE var)', () => {
    process.env.CVMI_USE_PRIVATE_KEY = 'proxy-key';
    process.env.CVMI_USE_SERVER_PUBKEY = 'proxy-pubkey';
    const config = loadConfigFromEnv();
    expect(config.use?.privateKey).toBe('proxy-key');
    expect(config.use?.serverPubkey).toBe('proxy-pubkey');
  });

  it('loads use encryption mode from environment', () => {
    process.env.CVMI_USE_ENCRYPTION = 'disabled';
    const config = loadConfigFromEnv();
    expect(config.use?.encryption).toBeDefined();
  });

  it('returns empty config when no environment variables set', () => {
    const config = loadConfigFromEnv();
    expect(config.serve).toBeUndefined();
    expect(config.use).toBeUndefined();
  });
});

describe('getServeConfig with defaults', () => {
  it('uses provided values', () => {
    const config = getServeConfig({
      privateKey: 'my-key',
      relays: ['wss://custom.relay.com'],
      public: true,
    });
    expect(config.privateKey).toBe('my-key');
    expect(config.relays).toEqual(['wss://custom.relay.com']);
    expect(config.public).toBe(true);
  });

  it('uses default relays when none provided', () => {
    const config = getServeConfig({ privateKey: 'key' });
    expect(config.relays).toEqual(DEFAULT_RELAYS);
  });

  it('uses default encryption mode', () => {
    const config = getServeConfig({ privateKey: 'key' });
    expect(config.encryption).toBe(DEFAULT_ENCRYPTION);
  });

  it('handles command and args from config file', () => {
    const config = getServeConfig({
      privateKey: 'key',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });
    expect(config.command).toBe('npx');
    expect(config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
  });

  it('cliFlags override config file command and args', () => {
    const config = getServeConfig(
      {
        privateKey: 'key',
        command: 'python',
        args: ['server.py'],
      },
      {
        command: 'node',
        args: ['index.js'],
      }
    );
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['index.js']);
  });
});

describe('getUseConfig with defaults', () => {
  it('uses provided values', () => {
    const config = getUseConfig({
      privateKey: 'my-key',
      relays: ['wss://custom.relay.com'],
      serverPubkey: 'server-pubkey',
    });
    expect(config.privateKey).toBe('my-key');
    expect(config.relays).toEqual(['wss://custom.relay.com']);
    expect(config.serverPubkey).toBe('server-pubkey');
  });

  it('uses default relays when none provided', () => {
    const config = getUseConfig({ privateKey: 'key' });
    expect(config.relays).toEqual(DEFAULT_RELAYS);
  });

  it('uses default encryption mode', () => {
    const config = getUseConfig({ privateKey: 'key' });
    expect(config.encryption).toBe(DEFAULT_ENCRYPTION);
  });
});

describe('getConfigPaths with custom config', () => {
  it('uses custom config path when provided', () => {
    const paths = getConfigPaths('/custom/config.json');
    expect(paths.customConfigPath).toBe('/custom/config.json');
  });

  it('uses default paths when no custom config', () => {
    const paths = getConfigPaths();
    expect(paths.globalDir).toContain('cvmi');
    expect(paths.globalConfig).toContain('config.json');
    expect(paths.customConfigPath).toBeUndefined();
  });
});

describe('savePrivateKeyToEnv', () => {
  const originalCwd = process.cwd();
  const testDir = '/tmp/cvmi-test-env';

  beforeEach(async () => {
    // Create test directory
    await import('fs/promises').then((fs) => fs.mkdir(testDir, { recursive: true }));
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    process.chdir(originalCwd);
    await import('fs/promises').then((fs) => fs.rm(testDir, { recursive: true, force: true }));
  });

  it('saves serve private key to .env file', async () => {
    await savePrivateKeyToEnv('serve', 'test-serve-key-123');

    const fs = await import('fs/promises');
    const envContent = await fs.readFile('.env', 'utf-8');
    expect(envContent).toContain('CVMI_SERVE_PRIVATE_KEY=test-serve-key-123');
  });

  it('saves use private key to .env file', async () => {
    await savePrivateKeyToEnv('use', 'test-use-key-456');

    const fs = await import('fs/promises');
    const envContent = await fs.readFile('.env', 'utf-8');
    expect(envContent).toContain('CVMI_USE_PRIVATE_KEY=test-use-key-456');
  });

  it('appends to existing .env file without overwriting', async () => {
    const fs = await import('fs/promises');
    await fs.writeFile('.env', 'EXISTING_VAR=value\n', 'utf-8');

    await savePrivateKeyToEnv('serve', 'new-key');

    const envContent = await fs.readFile('.env', 'utf-8');
    expect(envContent).toContain('EXISTING_VAR=value');
    expect(envContent).toContain('CVMI_SERVE_PRIVATE_KEY=new-key');
  });
});
