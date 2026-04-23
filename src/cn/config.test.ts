import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { CN_CONFIG_FILENAME, DEFAULT_CN_CONFIG, loadCnConfig, saveCnConfig } from './config.ts';

describe('cn config', () => {
  let testDir: string;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('loads private key from CVMI_CN_PRIVATE_KEY when not persisted in config', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'cvmi-cn-config-'));
    vi.stubEnv('CVMI_CN_PRIVATE_KEY', 'env-secret');

    await writeFile(
      join(testDir, CN_CONFIG_FILENAME),
      JSON.stringify({ source: 'generated', relays: ['wss://relay.example'] }, null, 2)
    );

    const config = await loadCnConfig(testDir);

    expect(config).toEqual({
      ...DEFAULT_CN_CONFIG,
      source: 'generated',
      relays: ['wss://relay.example'],
      privateKey: 'env-secret',
    });
  });

  it('never persists privateKey when saving config', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'cvmi-cn-config-'));

    await saveCnConfig(testDir, {
      source: 'src/clients',
      relays: ['wss://relay.example'],
      privateKey: 'top-secret',
      addedClients: ['pubkey-1'],
    });

    const persisted = JSON.parse(await readFile(join(testDir, CN_CONFIG_FILENAME), 'utf-8'));

    expect(persisted).toEqual({
      source: 'src/clients',
      relays: ['wss://relay.example'],
      addedClients: ['pubkey-1'],
    });
    expect(persisted.privateKey).toBeUndefined();
  });
});
