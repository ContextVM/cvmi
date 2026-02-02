/**
 * Tests for config source precedence.
 *
 * Expected priority (highest -> lowest):
 * CLI flags > Custom config > Project config > Global config > Environment
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Helper to import loader AFTER mocks are applied.
async function importLoader() {
  const mod = await import('../src/config/loader.ts');
  return mod;
}

describe('Config Precedence', () => {
  const runId = String(Date.now());
  const baseDir = join(tmpdir(), `cvmi-precedence-${runId}`);
  const projectDir = join(baseDir, 'project');
  const customConfigPath = join(baseDir, 'custom.json');
  const projectConfigPath = join(projectDir, '.cvmi.json');

  const originalCwd = process.cwd();

  beforeEach(async () => {
    vi.resetModules();

    // Extra safety: ensure any code that uses HOME directly is also sandboxed.
    process.env.HOME = join(baseDir, 'home');

    // Mock config home so the loader reads from our temp dir.
    vi.mock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return { ...actual, homedir: () => join(baseDir, 'home') };
    });

    await mkdir(projectDir, { recursive: true });

    // Ensure we load project config from the temp project directory.
    process.chdir(projectDir);

    // Clear env vars that affect the loader.
    delete process.env.CVMI_GATEWAY_PRIVATE_KEY;
    delete process.env.CVMI_SERVE_PRIVATE_KEY;
    delete process.env.CVMI_PROXY_PRIVATE_KEY;
    delete process.env.CVMI_USE_PRIVATE_KEY;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unmock('os');

    // Cleanup test workspace.
    await rm(baseDir, { recursive: true, force: true });
  });

  it('applies precedence: CLI > Custom > Project > Global > Environment', async () => {
    process.env.CVMI_SERVE_PRIVATE_KEY = 'env-key';

    const { loadConfig, getConfigPaths } = await importLoader();
    const paths = getConfigPaths();

    // Guard against writing to real user paths.
    expect(paths.globalConfig).toContain(baseDir);

    await mkdir(paths.globalDir, { recursive: true });
    await writeFile(paths.globalConfig, JSON.stringify({ serve: { privateKey: 'global-key' } }));
    await writeFile(customConfigPath, JSON.stringify({ serve: { privateKey: 'custom-key' } }));
    await writeFile(projectConfigPath, JSON.stringify({ serve: { privateKey: 'project-key' } }));

    const config = await loadConfig({ serve: { privateKey: 'cli-key' } }, customConfigPath);
    expect(config.serve?.privateKey).toBe('cli-key');
  });

  it('custom overrides project, project overrides global, global overrides environment', async () => {
    process.env.CVMI_SERVE_PRIVATE_KEY = 'env-key';

    const { loadConfig, getConfigPaths } = await importLoader();
    const paths = getConfigPaths(customConfigPath);

    // Guard against writing to real user paths.
    expect(paths.globalConfig).toContain(baseDir);

    await mkdir(paths.globalDir, { recursive: true });

    await writeFile(
      paths.globalConfig,
      JSON.stringify({ serve: { privateKey: 'global-key', relays: ['wss://global.relay'] } })
    );
    await writeFile(
      customConfigPath,
      JSON.stringify({ serve: { privateKey: 'custom-key', relays: ['wss://custom.relay'] } })
    );
    await writeFile(projectConfigPath, JSON.stringify({ serve: { privateKey: 'project-key' } }));

    // With no CLI flags, custom should win for privateKey.
    const config = await loadConfig({}, customConfigPath);
    expect(config.serve?.privateKey).toBe('custom-key');
    // Custom did specify relays, so it should win for relays.
    expect(config.serve?.relays).toEqual(['wss://custom.relay']);
  });

  it('custom config overrides project and global', async () => {
    const { loadConfig, getConfigPaths } = await importLoader();

    // Write global config to the exact path the loader will resolve.
    const paths = getConfigPaths();
    await mkdir(paths.globalDir, { recursive: true });
    await writeFile(
      paths.globalConfig,
      JSON.stringify({ serve: { privateKey: 'global-key', relays: ['wss://global.relay'] } })
    );
    await writeFile(customConfigPath, JSON.stringify({ serve: { privateKey: 'custom-key' } }));

    await writeFile(
      projectConfigPath,
      JSON.stringify({ serve: { relays: ['wss://project.relay'] } })
    );

    const config = await loadConfig({}, customConfigPath);
    expect(config.serve?.privateKey).toBe('custom-key');
    // custom didn't specify relays, so project relays should remain (project > global).
    expect(config.serve?.relays).toEqual(['wss://project.relay']);
  });
});
