import * as p from '@clack/prompts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { DEFAULT_RELAYS } from '../config/index.ts';
import type { EncryptionMode } from '@contextvm/sdk';

export async function runPackInit(dir: string): Promise<boolean> {
  const manifestPath = join(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    p.log.info('manifest.json already exists.');
    return true;
  }

  p.log.info("No manifest.json found. Let's create one.");

  let defaultName = basename(dir);
  let defaultVersion = '1.0.0';
  let defaultDescription = '';

  const pkgJsonPath = join(dir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      if (pkg.name) defaultName = pkg.name;
      if (pkg.version) defaultVersion = pkg.version;
      if (pkg.description) defaultDescription = pkg.description;
    } catch {}
  }

  const result = await p.group(
    {
      name: () =>
        p.text({
          message: 'Server name',
          initialValue: defaultName,
          validate: (value) => {
            if (!value) return 'Please enter a name.';
            if (!/^[a-z0-9-]+$/.test(value))
              return 'Name can only contain lowercase letters, numbers, and dashes.';
          },
        }),
      displayName: ({ results }) =>
        p.text({
          message: 'Display name',
          initialValue: results.name,
        }),
      version: () =>
        p.text({
          message: 'Version',
          initialValue: defaultVersion,
        }),
      description: () =>
        p.text({
          message: 'Description',
          initialValue: defaultDescription,
        }),
      author: () =>
        p.text({
          message: 'Author name',
          validate: (value) => {
            if (!value) return 'Please enter an author name.';
          },
        }),
      type: () =>
        p.select({
          message: 'Server type',
          options: [
            { value: 'node', label: 'Node.js' },
            { value: 'python', label: 'Python' },
            { value: 'binary', label: 'Binary' },
          ],
          initialValue: 'node',
        }),
      entryPoint: ({ results }) => {
        let initial = 'index.js';
        if (results.type === 'node') initial = 'build/index.js';
        if (results.type === 'python') initial = 'src/server.py';
        if (results.type === 'binary') initial = 'bin/server';
        return p.text({
          message: 'Entry point path',
          initialValue: initial,
        });
      },
      command: ({ results }) => {
        let initial = 'node';
        if (results.type === 'python') initial = 'python';
        if (results.type === 'binary') initial = `\${__dirname}/${results.entryPoint}`;
        return p.text({
          message: 'Command to run (mcp_config)',
          initialValue: initial,
        });
      },
      public: () =>
        p.confirm({
          message: 'Should this server be public? (accept connections from any pubkey)',
          initialValue: false,
        }),
      relays: () =>
        p.text({
          message: 'Default relays (comma-separated)',
          initialValue: DEFAULT_RELAYS.join(', '),
        }),
      encryption: () =>
        p.select({
          message: 'Encryption mode',
          options: [
            { value: 'nip44', label: 'NIP-44 (Required)' },
            { value: 'optional', label: 'Optional (Fallback to unencrypted)' },
            { value: 'disabled', label: 'Disabled (Unencrypted)' },
          ],
          initialValue: 'optional' as EncryptionMode,
        }),
      announce: () =>
        p.confirm({
          message: 'Announce server on Nostr? (publish kind 11316-11320)',
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Operation cancelled.');
        process.exit(0);
      },
    }
  );

  const relaysList = result.relays
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r);

  const manifest = {
    manifest_version: '0.3',
    name: result.name,
    display_name: result.displayName,
    version: result.version,
    description: result.description,
    author: {
      name: result.author,
    },
    server: {
      type: result.type,
      entry_point: result.entryPoint,
      mcp_config: {
        command: result.command,
        args: result.type === 'binary' ? [] : [`\${__dirname}/${result.entryPoint}`],
      },
    },
    _meta: {
      'com.contextvm': {
        public: result.public,
        default_relays: relaysList,
        encryption: result.encryption,
        announce: result.announce,
        pricing: null,
      },
    },
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  p.log.success(`Created manifest.json in ${dir}`);

  return true;
}
