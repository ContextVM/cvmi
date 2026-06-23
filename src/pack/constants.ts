/**
 * Ignored files/directories when calculating the bundle's Merkle content hash.
 * node_modules is ignored to avoid hashing hundreds of megabytes of dependencies,
 * meaning node_modules integrity relies on lockfiles being in the hash.
 *
 * Note: `.cvmb`/`.mcpb` bundle artifacts are excluded separately by extension
 * in `computeDirectoryContentHash`, so they are not listed here.
 */
export const CONTENT_HASH_IGNORE_PATTERNS = ['.git', 'node_modules', '.DS_Store', '.env'];

/**
 * Ignored glob patterns when building the final ZIP archive.
 */
export const BUNDLE_IGNORE_PATTERNS = [
  '.git/**',
  'node_modules/.cache/**',
  '.DS_Store',
  '.env',
  '*.cvmb',
  '*.mcpb',
];

/**
 * Current version of the CVM/MCPB manifest specification.
 */
export const CVM_MANIFEST_VERSION = '0.3';

/**
 * Nostr event kind used as an opaque local signing container for manifest
 * signatures. The signing event is never published to relays — it exists only
 * so we can sign/verify the canonical manifest via nostr-tools (`finalizeEvent`
 * / `verifyEvent`) without performing manual curve operations. The value is
 * arbitrary but MUST be identical at sign and verify time.
 */
export const MANIFEST_SIGNATURE_KIND = 9501;
