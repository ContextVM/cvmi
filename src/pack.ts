import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { createWriteStream, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as p from '@clack/prompts';
import { runPackInit } from './pack/pack-init.ts';
import { validateManifest, type McpbManifest } from './pack/cvm-manifest.ts';
import { BOLD, DIM, RESET } from './constants/ui.ts';

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

  let manifest: McpbManifest;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!options.noValidate) {
      manifest = validateManifest(raw);
    } else {
      manifest = raw as McpbManifest;
    }
  } catch (error) {
    p.log.error(`Invalid manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const outFileName = options.output || `${manifest.name}-${manifest.version}.mcpb`;
  const outPath = resolve(outFileName);

  p.log.info(`Packing ${manifest.name} v${manifest.version}...`);

  if (manifest.server.type === 'node') {
    if (!existsSync(join(dir, 'node_modules'))) {
      p.log.warn(
        'No node_modules directory found. Node.js servers usually require bundled dependencies.'
      );
    }
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', {
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

    // Add all files from directory, excluding some common things we don't want
    archive.glob('**/*', {
      cwd: dir,
      dot: true,
      ignore: ['.git/**', 'node_modules/.cache/**', '.DS_Store', '.env', '*.mcpb', outFileName],
    });

    archive.finalize();
  });
}

export function showPackHelp(): void {
  console.log(`
${BOLD}Usage:${RESET}
  cvmi pack [directory] [options]

${BOLD}Description:${RESET}
  Package a local MCP server into a distributable MCPB bundle (.mcpb).
  If no manifest.json exists, an interactive wizard will help you create one
  with ContextVM-specific extensions (relays, public mode, encryption).

${BOLD}Options:${RESET}
  --output, -o <path>      Custom output file name
  --manifest, -m <path>    Custom manifest path (default: manifest.json)
  --no-validate            Skip manifest validation
  --verbose                Enable verbose logging
  --help, -h               Show this help message

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} cvmi pack                       ${DIM}# package current directory${RESET}
  ${DIM}$${RESET} cvmi pack ./my-server           ${DIM}# package specific directory${RESET}
  ${DIM}$${RESET} cvmi pack -o custom-name.mcpb   ${DIM}# custom output name${RESET}
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
