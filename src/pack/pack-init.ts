import * as p from '@clack/prompts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { DEFAULT_RELAYS } from '../config/index.ts';

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
            { value: 'uv', label: 'Python (UV)' },
            { value: 'binary', label: 'Binary' },
            { value: 'docker', label: 'Docker' },
          ],
          initialValue: 'node',
        }),
      image: ({ results }) => {
        if (results.type !== 'docker') return Promise.resolve(undefined);
        return p.text({
          message: 'Docker image (e.g., ghcr.io/dev/my-server:1.0.0)',
          validate: (value) => {
            if (!value) return 'Please enter a Docker image reference.';
          },
        });
      },
      entryPoint: ({ results }) => {
        if (results.type === 'docker') return Promise.resolve(undefined);
        let initial = 'index.js';
        if (results.type === 'node') initial = 'build/index.js';
        if (results.type === 'python' || results.type === 'uv') initial = 'src/server.py';
        if (results.type === 'binary') initial = 'bin/server';
        return p.text({
          message: 'Entry point path',
          initialValue: initial,
        });
      },
      transport: () =>
        p.select({
          message: 'Transport mode',
          options: [
            {
              value: 'stdio',
              label: 'stdio (Gateway wraps the server, simplest)',
            },
            {
              value: 'cvm',
              label: 'cvm (Server uses CVM SDK directly, advanced)',
            },
          ],
          initialValue: 'stdio',
        }),
      isPublic: () =>
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
            { value: 'required', label: 'Required (NIP-44 encryption)' },
            { value: 'optional', label: 'Optional (Fallback to unencrypted)' },
            { value: 'disabled', label: 'Disabled (Unencrypted)' },
          ],
          initialValue: 'optional',
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

  // Build mcp_config based on server type
  let mcpConfig: { command: string; args: string[] };
  if (result.type === 'docker') {
    mcpConfig = {
      command: 'docker',
      args: ['run', '--rm', '-i', result.image as string],
    };
  } else if (result.type === 'uv') {
    mcpConfig = {
      command: 'uv',
      args: ['run', `\${__dirname}/${result.entryPoint}`],
    };
  } else if (result.type === 'binary') {
    mcpConfig = {
      command: `\${__dirname}/${result.entryPoint}`,
      args: [],
    };
  } else {
    const cmd = result.type === 'python' ? 'python' : 'node';
    mcpConfig = {
      command: cmd,
      args: [`\${__dirname}/${result.entryPoint}`],
    };
  }

  // Build server section
  const server: Record<string, unknown> = {
    type: result.type,
    mcp_config: mcpConfig,
  };
  if (result.type === 'docker') {
    server.image = result.image;
  } else {
    server.entry_point = result.entryPoint;
  }

  // Build CVM meta
  const cvmMeta: Record<string, unknown> = {
    transport: result.transport,
    defaults: {
      relays: relaysList,
      encryption: result.encryption,
      public: result.isPublic,
    },
  };

  // For native CVM transport, add default env_mapping
  if (result.transport === 'cvm') {
    cvmMeta.env_mapping = {
      relays: 'CVM_RELAYS',
      encryption: 'CVM_ENCRYPTION',
      public: 'CVM_PUBLIC',
      private_key: 'CVM_PRIVATE_KEY',
    };
  }

  const manifest = {
    manifest_version: '0.3',
    name: result.name,
    display_name: result.displayName,
    version: result.version,
    description: result.description,
    author: {
      name: result.author,
    },
    server,
    _meta: {
      'com.contextvm': cvmMeta,
    },
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  p.log.success(`Created manifest.json in ${dir}`);

  return true;
}
