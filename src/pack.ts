import { ZipArchive } from 'archiver';
import { createWriteStream, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as p from '@clack/prompts';
import { runPackInit } from './pack/pack-init.ts';
import { validateManifest, type CvmbManifest } from './pack/cvm-manifest.ts';
import { computeDirectoryContentHash, signManifest } from './pack/crypto.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';
import { BUNDLE_IGNORE_PATTERNS, CONTENT_HASH_IGNORE_PATTERNS } from './pack/constants.ts';

export interface PackOptions {
  output?: string;
  manifest?: string;
  noValidate?: boolean;
  verbose?: boolean;
}

export async function pack(targetDir: string = '.', options: PackOptions = {}): Promise<void> {
  const dir = resolve(targetDir);

  if (!existsSync(dir)) {
    p.log.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const manifestPath = options.manifest ? resolve(options.manifest) : join(dir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    p.log.info(`Manifest not found at ${manifestPath}`);
    const initialized = await runPackInit(dir);
    if (!initialized) {
      process.exit(1);
    }
  }

  let manifest: CvmbManifest;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!options.noValidate) {
      manifest = validateManifest(raw, true);
    } else {
      manifest = raw as CvmbManifest;
    }
  } catch (error) {
    p.log.error(`Invalid manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const outFileName = options.output || `${manifest.name}-${manifest.version}.cvmb`;
  const outPath = resolve(outFileName);

  p.log.info(`Packing ${manifest.name} v${manifest.version}...`);

  if (manifest.server.type === 'node') {
    if (!existsSync(join(dir, 'node_modules'))) {
      p.log.warn(
        'No node_modules directory found. Node.js servers usually require bundled dependencies.'
      );
    }
  }

  if (manifest.server.type === 'docker' && !manifest.server.image) {
    p.log.warn(
      'Docker server type detected but no "image" field found in manifest. Bundle may not work.'
    );
  }

  // 1. Cryptography Phase: Hashing
  const sHash = p.spinner();
  sHash.start('Computing Merkle content hash...');
  const contentHash = await computeDirectoryContentHash(dir, CONTENT_HASH_IGNORE_PATTERNS);
  sHash.stop(`Content hash computed: ${contentHash.slice(0, 16)}...`);

  if (!manifest._meta) manifest._meta = {};
  if (!manifest._meta['com.contextvm']) manifest._meta['com.contextvm'] = {};
  manifest._meta['com.contextvm'].content_hash = contentHash;

  // Remove existing signature to prevent invalidation
  delete manifest._sig;

  // 2. Cryptography Phase: Signing
  const shouldSign = await p.confirm({
    message: 'Do you want to cryptographically sign this bundle with a Nostr key?',
    initialValue: true,
  });

  if (p.isCancel(shouldSign)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  if (shouldSign) {
    const privateKeyHex = await p.password({
      message: 'Enter your Nostr private key (hex) to sign the bundle:',
      validate: (value) => {
        if (!value) return 'Private key is required to sign.';
        if (!/^[0-9a-fA-F]{64}$/.test(value)) return 'Must be a 64-character hex string.';
      },
    });

    if (p.isCancel(privateKeyHex)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    try {
      manifest._sig = signManifest(manifest, privateKeyHex as string);
      p.log.success(`Signed bundle successfully (pubkey: ${manifest._sig.pubkey.slice(0, 8)}...)`);
    } catch (err) {
      p.log.error(`Signing failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    p.log.warn(
      'Creating unsigned bundle. This bundle will trigger warnings when users install it.'
    );
  }

  // 3. Archive Phase
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outPath);
    const archive = new ZipArchive({
      zlib: { level: 9 }, // maximum compression
    });

    output.on('close', () => {
      p.log.success(`Created bundle: ${outPath} (${archive.pointer()} bytes)`);
      resolvePromise();
    });

    archive.on('error', (err: Error) => {
      rejectPromise(err);
    });

    archive.pipe(output);

    // Add the signed/hashed manifest directly from memory
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Add all files from directory, excluding some common things we don't want
    archive.glob('**/*', {
      cwd: dir,
      dot: true,
      ignore: [
        ...BUNDLE_IGNORE_PATTERNS,
        'manifest.json', // Excluded so we don't add the unsigned source file
        outFileName,
      ],
    });

    archive.finalize();
  });
}

export function showPackHelp(): void {
  console.log(`
${BOLD}Usage:${RESET}
  cvmi pack [directory] [options]

${BOLD}Description:${RESET}
  Package a local MCP server into a distributable ContextVM bundle (.cvmb).
  If no manifest.json exists, an interactive wizard will help you create one.

${BOLD}Options:${RESET}
  --output, -o <path>      Custom output file name
  --manifest, -m <path>    Custom manifest path (default: manifest.json)
  --no-validate            Skip manifest validation
  --verbose                Enable verbose logging
  --help, -h               Show this help message

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi pack                       ${DIM}# package current directory${RESET}
  ${DIM}$${RESET} cvmi pack ./my-server           ${DIM}# package specific directory${RESET}
  ${DIM}$${RESET} cvmi pack -o custom-name.cvmb   ${DIM}# custom output name${RESET}
  `);
}

export function parsePackArgs(args: string[]): {
  targetDir: string;
  options: PackOptions;
  help: boolean;
  unknownFlags: string[];
} {
  const result = {
    targetDir: '.',
    options: {} as PackOptions,
    help: false,
    unknownFlags: [] as string[],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    const consumeValue = (flagName: string): string | undefined => {
      const nextIndex = ++i;
      const value = args[nextIndex];
      if (value === undefined || value.startsWith('-')) {
        result.unknownFlags.push(`${flagName} (missing value)`);
        if (value?.startsWith('-')) i--;
        return undefined;
      }
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--verbose') {
      result.options.verbose = true;
    } else if (arg === '--no-validate') {
      result.options.noValidate = true;
    } else if (arg === '--output' || arg === '-o') {
      result.options.output = consumeValue(arg);
    } else if (arg === '--manifest' || arg === '-m') {
      result.options.manifest = consumeValue(arg);
    } else if (arg.startsWith('-')) {
      result.unknownFlags.push(arg);
    } else {
      result.targetDir = arg;
    }
  }

  return result;
}
