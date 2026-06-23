import canonicalize from 'canonicalize';
import { createHash } from 'crypto';
import { finalizeEvent, verifyEvent } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { CvmbManifest } from './cvm-manifest.ts';
import { CONTENT_HASH_IGNORE_PATTERNS, MANIFEST_SIGNATURE_KIND } from './constants.ts';

/**
 * Canonicalizes a manifest object according to RFC 8785.
 * The `_sig` field is removed before canonicalization so the digest is stable
 * across signing and verification.
 */
export function canonicalizeManifest(manifest: CvmbManifest): string {
  const { _sig, ...manifestWithoutSig } = manifest;
  const canonical = canonicalize(manifestWithoutSig);
  if (!canonical) {
    throw new Error('Failed to canonicalize manifest');
  }
  return canonical;
}

/**
 * Signs a manifest using the author's Nostr private key (64-char hex).
 *
 * The canonical manifest becomes the `content` of a Nostr signing event, which
 * is signed with nostr-tools' `finalizeEvent`. This binds the author's Nostr
 * identity to the exact manifest bytes while delegating all curve math to
 * nostr-tools (no direct use of @noble/curves).
 *
 * Returns the complete `_sig` object to be injected into the manifest.
 */
export function signManifest(manifest: CvmbManifest, privateKeyHex: string) {
  const content = canonicalizeManifest(manifest);
  const event = finalizeEvent(
    {
      kind: MANIFEST_SIGNATURE_KIND,
      tags: [],
      content,
      created_at: Math.floor(Date.now() / 1000),
    },
    hexToBytes(privateKeyHex)
  );

  return {
    pubkey: event.pubkey,
    id: event.id,
    signature: event.sig,
    created_at: event.created_at,
  };
}

/**
 * Verifies the `_sig` block of a manifest.
 *
 * Reconstructs the signing event from the canonical manifest plus the `_sig`
 * fields and delegates to nostr-tools' `verifyEvent`, which checks both the
 * NIP-01 event id and the Schnorr signature.
 *
 * Throws an error if the manifest is unsigned or the signature is invalid.
 */
export function verifyManifestSignature(manifest: CvmbManifest): boolean {
  const sig = manifest._sig;
  if (!sig) {
    throw new Error('Manifest is not signed');
  }

  const content = canonicalizeManifest(manifest);
  const event = {
    kind: MANIFEST_SIGNATURE_KIND,
    tags: [],
    content,
    pubkey: sig.pubkey,
    id: sig.id,
    sig: sig.signature,
    created_at: sig.created_at,
  };

  if (!verifyEvent(event)) {
    throw new Error(
      'Invalid manifest signature: the manifest was modified after signing or the signature is corrupt.'
    );
  }

  return true;
}

/**
 * Computes a Merkle-style hash over a directory's contents.
 * 1. Hashes each file's contents (excluding manifest.json and ignored patterns).
 * 2. Sorts paths alphabetically.
 * 3. Concatenates path:hash\n and hashes the result.
 *
 * Note: node_modules is ignored to avoid hashing hundreds of megabytes of dependencies.
 * Therefore, node_modules integrity relies on lockfiles (package-lock.json, etc.) being in the hash.
 */
export async function computeDirectoryContentHash(
  dir: string,
  ignoreList: string[] = CONTENT_HASH_IGNORE_PATTERNS
): Promise<string> {
  const allFiles = await getFilesRecursive(dir);

  // Filter out manifest and ignored patterns
  const filteredFiles = allFiles.filter((file) => {
    const relPath = relative(dir, file).replace(/\\/g, '/');
    if (relPath === 'manifest.json') return false;
    if (relPath.endsWith('.cvmb') || relPath.endsWith('.mcpb')) return false;

    // Path-segment-aware ignore logic
    const segments = relPath.split(/[/\\]/);
    for (const ignore of ignoreList) {
      if (segments.includes(ignore)) return false;
    }
    return true;
  });

  const fileHashes: Array<{ path: string; hash: string }> = [];

  for (const file of filteredFiles) {
    const content = await readFile(file);
    const hash = createHash('sha256').update(content).digest('hex');
    const relPath = relative(dir, file).replace(/\\/g, '/'); // Normalize path separators
    fileHashes.push({ path: relPath, hash });
  }

  // Sort alphabetically by path
  fileHashes.sort((a, b) => a.path.localeCompare(b.path));

  // Concatenate path:hash\n
  const manifestContent = fileHashes.map((f) => `${f.path}:${f.hash}`).join('\n');

  return 'sha256:' + createHash('sha256').update(manifestContent).digest('hex');
}

/**
 * Helper to recursively get all files in a directory.
 */
async function getFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFilesRecursive(res)));
    } else {
      files.push(res);
    }
  }

  return files;
}
