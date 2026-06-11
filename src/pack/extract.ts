import extractZip from 'extract-zip';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { validateManifest, type McpbManifest } from './cvm-manifest.ts';
import { randomBytes } from 'crypto';

export async function extractBundle(
  mcpbPath: string
): Promise<{ dir: string; manifest: McpbManifest }> {
  // Use a unique temp directory for extraction
  const extractDir = join(os.tmpdir(), `cvmi-bundle-${randomBytes(8).toString('hex')}`);

  try {
    await extractZip(mcpbPath, { dir: extractDir });
  } catch (err) {
    throw new Error(
      `Failed to extract bundle: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const manifestPath = join(extractDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Invalid bundle: manifest.json not found inside the archive.');
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const manifest = validateManifest(raw);
    return { dir: extractDir, manifest };
  } catch (error) {
    throw new Error(
      `Invalid manifest in bundle: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
