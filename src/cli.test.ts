import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliOutput, stripLogo, hasLogo } from './test-utils.ts';

describe('skills CLI', () => {
  const originalCwd = process.cwd();
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cvmi-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: cvmi <command> [options]');
      expect(output).toContain(
        'call                   Inspect or call a remote ContextVM capability'
      );
      expect(output).toContain('config                 Manage saved server aliases');
      expect(output).not.toContain('Add Options:');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['--help']);
      const hOutput = runCliOutput(['-h']);
      expect(hOutput).toBe(helpOutput);
    });
  });

  describe('--version', () => {
    it('should display version number', () => {
      const output = runCliOutput(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should match package.json version', () => {
      const output = runCliOutput(['--version']);
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
      );
      expect(output.trim()).toBe(pkg.version);
    });
  });

  describe('call gift-wrap option', () => {
    it.each(['optional', 'persistent', 'ephemeral'])(
      'accepts %s and documents the option',
      (mode) => {
        const result = runCli(['call', '--gift-wrap-mode', mode, '--help']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('--gift-wrap-mode <mode>');
        expect(result.stdout).toContain('optional, persistent, ephemeral (default: SDK policy)');
      }
    );

    it('rejects an unsupported policy before connecting', () => {
      const result = runCli(['call', 'a'.repeat(64), '--gift-wrap-mode', 'invalid']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        '--gift-wrap-mode (invalid; expected optional, persistent, or ephemeral)'
      );
    });

    it('rejects a missing policy value', () => {
      const result = runCli(['call', '--gift-wrap-mode']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--gift-wrap-mode (missing value)');
    });
  });

  describe('no arguments', () => {
    it('should display banner', () => {
      const output = stripLogo(runCliOutput([]));
      expect(output).toBeDefined();
      expect(output).toContain('npx cvmi config <command>');
    });
  });

  describe('unknown command', () => {
    it('should show error for unknown command', () => {
      const output = runCliOutput(['unknown-command']);
      expect(output).toMatchInlineSnapshot(`
        "Unknown command: unknown-command
        Run cvmi --help for usage.
        "
      `);
    });
  });

  describe('config command', () => {
    it('should show config help for invalid config command without stack trace', () => {
      const output = runCliOutput(['config', 'relatr', 'abc']);
      expect(output).toContain('Error: Unknown config command: relatr.');
      expect(output).not.toContain('at runConfigCommand');
    });

    it('should accept shorthand config add syntax', () => {
      const output = runCliOutput(['config', 'add']);
      expect(output).toContain('Usage: cvmi config <command> [...args] [options]');
      expect(output).not.toContain('Unknown config section: add');
    });

    it('should accept nprofile server aliases without validation errors', () => {
      const output = runCliOutput(['config', 'add', 'weather', 'nprofile1example']);
      expect(output).not.toContain('Invalid public key format');
    });
  });

  describe('logo display', () => {
    it('should not display logo for list command', () => {
      const output = runCliOutput(['list']);
      expect(hasLogo(output)).toBe(false);
    });

    it('should not display logo for check command', () => {
      const output = runCliOutput(['check']);
      expect(hasLogo(output)).toBe(false);
    });

    it('should not display logo for update command', { timeout: 30000 }, () => {
      const output = runCliOutput(['update']);
      expect(hasLogo(output)).toBe(false);
    });
  });
});
