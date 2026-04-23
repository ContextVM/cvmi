import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CN_CONFIG_FILENAME } from './config.ts';

const askQuestion = vi.fn();
const askYesNo = vi.fn();
const closeReadlineInterface = vi.fn();
const createCvmConnection = vi.fn();
const generateClientCode = vi.fn();

vi.mock('./cli-prompts.js', () => ({
  askQuestion,
  askYesNo,
  closeReadlineInterface,
}));

vi.mock('./cvm-client.js', () => ({
  createCvmConnection,
}));

vi.mock('./schema.js', () => ({
  generateClientCode,
}));

describe('cn command handlers', () => {
  const originalCwd = process.cwd();
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `cvmi-cn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`EXIT:${code}`);
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('handleInit rejects when package.json is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handleInit } = await import('./commands/init.ts');

    await expect(handleInit(testDir)).rejects.toThrow('EXIT:1');

    expect(errorSpy).toHaveBeenCalled();
  });

  it('handleInit creates config and source directory', async () => {
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({ dependencies: { '@contextvm/sdk': '^0.8.0' } })
    );
    askQuestion
      .mockResolvedValueOnce('src/generated')
      .mockResolvedValueOnce('wss://relay.one, wss://relay.two');
    const { handleInit } = await import('./commands/init.ts');

    await handleInit(testDir);

    const config = JSON.parse(readFileSync(join(testDir, CN_CONFIG_FILENAME), 'utf-8'));
    expect(config).toEqual({
      source: 'src/generated',
      relays: ['wss://relay.one', 'wss://relay.two'],
    });
    expect(existsSync(join(testDir, 'src/generated'))).toBe(true);
  });

  it('handleAdd print-only path does not mutate config', async () => {
    writeConfig({ source: 'src/generated', relays: ['wss://relay.example'], addedClients: [] });
    askQuestion.mockResolvedValueOnce('').mockResolvedValueOnce('2');
    createCvmConnection.mockResolvedValue({
      serverDetails: { name: 'weather-server', version: '1.0.0' },
      toolListResult: { tools: [{ name: 'forecast', description: 'Get forecast' }] },
    });
    generateClientCode.mockResolvedValue('// generated client');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { handleAdd } = await import('./commands/add.ts');

    await expect(handleAdd('pubkey-1', testDir)).rejects.toThrow('EXIT:0');

    const config = JSON.parse(readFileSync(join(testDir, CN_CONFIG_FILENAME), 'utf-8'));
    expect(config.addedClients).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('// generated client');
  });

  it('handleAdd saves generated client and appends pubkey only once', async () => {
    writeConfig({ source: 'src/generated', relays: ['wss://relay.example'], addedClients: [] });
    askQuestion
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('1');
    createCvmConnection.mockResolvedValue({
      serverDetails: { name: 'weather-server', version: '1.0.0' },
      toolListResult: { tools: [{ name: 'forecast', description: 'Get forecast' }] },
    });
    generateClientCode.mockResolvedValue(
      'export class WeatherServerClient { static readonly SERVER_PUBKEY = "pubkey-1"; }'
    );
    const { handleAdd } = await import('./commands/add.ts');

    await expect(handleAdd('pubkey-1', testDir)).rejects.toThrow('EXIT:0');
    await expect(handleAdd('pubkey-1', testDir)).rejects.toThrow('EXIT:0');

    const config = JSON.parse(readFileSync(join(testDir, CN_CONFIG_FILENAME), 'utf-8'));
    expect(config.addedClients).toEqual(['pubkey-1']);
  });

  it('handleUpdate exits cleanly when there are no added clients', async () => {
    writeConfig({ source: 'src/generated', relays: ['wss://relay.example'], addedClients: [] });
    const { handleUpdate } = await import('./commands/update.ts');

    await expect(handleUpdate(testDir)).rejects.toThrow('EXIT:0');
  });

  it('handleUpdate rejects unknown pubkey', async () => {
    writeConfig({
      source: 'src/generated',
      relays: ['wss://relay.example'],
      addedClients: ['pubkey-1'],
    });
    const { handleUpdate } = await import('./commands/update.ts');

    await expect(handleUpdate(testDir, 'pubkey-2')).rejects.toThrow('EXIT:1');
  });

  it('handleUpdate supports updating all clients', async () => {
    writeConfig({
      source: 'src/generated',
      relays: ['wss://relay.example'],
      addedClients: ['pubkey-1', 'pubkey-2'],
    });
    askQuestion.mockResolvedValueOnce('all');
    askYesNo.mockResolvedValue(true);
    createCvmConnection
      .mockResolvedValueOnce({
        serverDetails: { name: 'alpha', version: '1.0.0' },
        toolListResult: { tools: [] },
      })
      .mockResolvedValueOnce({
        serverDetails: { name: 'beta', version: '1.0.0' },
        toolListResult: { tools: [] },
      });
    generateClientCode.mockResolvedValue('// updated client');
    const { handleUpdate } = await import('./commands/update.ts');

    await expect(handleUpdate(testDir)).rejects.toThrow('EXIT:0');

    expect(createCvmConnection).toHaveBeenCalledTimes(2);
    expect(generateClientCode).toHaveBeenNthCalledWith(
      1,
      'pubkey-1',
      { tools: [] },
      'Alpha',
      undefined,
      ['wss://relay.example']
    );
    expect(generateClientCode).toHaveBeenNthCalledWith(
      2,
      'pubkey-2',
      { tools: [] },
      'Beta',
      undefined,
      ['wss://relay.example']
    );
  });

  it('handleUpdate can retain the matched existing client name for a specific pubkey', async () => {
    writeConfig({
      source: 'src/generated',
      relays: ['wss://relay.example'],
      addedClients: ['pubkey-1', 'pubkey-2'],
    });
    mkdirSync(join(testDir, 'src/generated'), { recursive: true });
    writeFileSync(
      join(testDir, 'src/generated', 'LegacyAlphaClient.ts'),
      'export class LegacyAlphaClient { static readonly SERVER_PUBKEY = "pubkey-1"; }'
    );
    writeFileSync(
      join(testDir, 'src/generated', 'ModernBetaClient.ts'),
      'export class ModernBetaClient { static readonly SERVER_PUBKEY = "pubkey-2"; }'
    );
    createCvmConnection.mockResolvedValue({
      serverDetails: { name: 'new-alpha', version: '2.0.0' },
      toolListResult: { tools: [] },
    });
    askYesNo.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    generateClientCode.mockResolvedValue('// updated legacy client');
    const { handleUpdate } = await import('./commands/update.ts');

    await expect(handleUpdate(testDir, 'pubkey-1')).rejects.toThrow('EXIT:0');

    expect(generateClientCode).toHaveBeenCalledWith(
      'pubkey-1',
      { tools: [] },
      'LegacyAlpha',
      undefined,
      ['wss://relay.example']
    );
  });

  it('handleUpdate cancels cleanly when user declines update', async () => {
    writeConfig({
      source: 'src/generated',
      relays: ['wss://relay.example'],
      addedClients: ['pubkey-1'],
    });
    createCvmConnection.mockResolvedValue({
      serverDetails: { name: 'weather-server', version: '1.0.0' },
      toolListResult: { tools: [] },
    });
    askYesNo.mockResolvedValue(false);
    const { handleUpdate } = await import('./commands/update.ts');

    await expect(handleUpdate(testDir, 'pubkey-1')).rejects.toThrow('EXIT:0');

    expect(generateClientCode).not.toHaveBeenCalled();
  });

  function writeConfig(config: object) {
    writeFileSync(join(testDir, CN_CONFIG_FILENAME), JSON.stringify(config, null, 2));
  }
});
