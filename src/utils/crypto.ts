import { generateSecretKey, nip19 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

/**
 * Generate a new private key for Nostr operations.
 */
export function generatePrivateKey(): string {
  return bytesToHex(generateSecretKey());
}

/**
 * Normalize a private key input.
 *
 * Accepts:
 * - 64-char hex strings
 * - `0x`-prefixed 64-char hex strings
 * - `nsec...` bech32 private keys
 *
 * Returns a lowercase 64-char hex string.
 */
export function normalizePrivateKey(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Private key is empty');
  }

  // NIP-19 bech32 key
  if (trimmed.startsWith('nsec')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error(`Expected nsec private key, got ${decoded.type}`);
    }
    return bytesToHex(decoded.data).toLowerCase();
  }

  // Hex key (optionally 0x-prefixed)
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'Invalid private key format. Expected 64-char hex (optionally 0x-prefixed) or nsec...'
    );
  }

  return hex.toLowerCase();
}
