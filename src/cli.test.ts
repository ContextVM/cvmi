import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCliOutput, stripLogo, hasLogo } from './test-utils.ts';

describe('skills CLI', () => {
  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: cvmi <command> [options]');
      expect(output).toContain('call              Call a remote ContextVM capability');
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

  describe('no arguments', () => {
    it('should display banner', () => {
      const output = stripLogo(runCliOutput([]));
      expect(output).toBeDefined();
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
